# Rate Limiting

## Category

Validation & Error Handling

## Intent

Protect the Durable Object from abuse by throttling WebSocket messages per socket and chat messages per player. Rate limiting runs before any parsing or validation, ensuring that even malformed floods cannot consume engine resources.

## How It Works in Delta-V

Two rate limiting mechanisms are implemented:

### 1. Socket message rate limiting (`applySocketRateLimit`)

Every incoming WebSocket message passes through `applySocketRateLimit` before JSON parsing. The function uses a `WeakMap<WebSocket, { count: number; windowStart: number }>` to track per-socket message counts within a sliding time window.

Constants:
- `WS_MSG_RATE_LIMIT = 10` -- max messages per window
- `WS_MSG_RATE_WINDOW_MS = 1_000` -- 1-second window

If a socket exceeds the limit, the function closes the socket with WebSocket close code `1008` ("Policy Violation") and returns `false`, causing the message handler to exit immediately. If the window has expired, the counter resets.

The `WeakMap` is keyed on `WebSocket` objects, which means:
- No memory leak: entries are garbage-collected when the socket is closed
- Survives DO hibernation wake cycles (the runtime preserves WebSocket objects)
- Does not survive full DO eviction (acceptable -- the rate window is 1 second)

### 2. Chat rate limiting

Chat messages have an additional throttle in the aux message handler:

```
CHAT_RATE_LIMIT_MS = 500
```

A `Map<number, number>` tracks the last chat timestamp per player ID. Messages arriving within 500ms of the previous chat are silently dropped (no error sent).

## Key Locations

- `src/server/game-do/socket.ts` (lines 12-45) -- `applySocketRateLimit`, constants
- `src/server/game-do/socket.ts` (lines 80-94) -- chat rate limiting in `AUX_MESSAGE_HANDLERS`
- `src/server/game-do/ws.ts` (lines 93-95) -- rate limit check before parsing
- `src/server/game-do/socket.test.ts` -- rate limit tests

## Code Examples

Socket rate limiter:

```typescript
export const WS_MSG_RATE_LIMIT = 10;
export const WS_MSG_RATE_WINDOW_MS = 1_000;

export const applySocketRateLimit = (
  ws: WebSocket,
  now: number,
  msgRates: WeakMap<WebSocket, RateWindow>,
): boolean => {
  const rate = msgRates.get(ws);

  if (rate && now - rate.windowStart < WS_MSG_RATE_WINDOW_MS) {
    rate.count++;
    if (rate.count > WS_MSG_RATE_LIMIT) {
      try {
        ws.close(1008, 'Rate limit exceeded');
      } catch {}
      return false;
    }
    return true;
  }

  msgRates.set(ws, { count: 1, windowStart: now });
  return true;
};
```

Chat rate limiting:

```typescript
chat: (deps) => {
  const chatTime = Date.now();
  const last = deps.lastChatAt.get(deps.playerId) ?? 0;

  if (chatTime - last < CHAT_RATE_LIMIT_MS) {
    return;
  }

  deps.lastChatAt.set(deps.playerId, chatTime);
  deps.broadcast({
    type: 'chat',
    playerId: deps.playerId,
    text: deps.msg.text,
  });
},
```

Usage in the message handler (runs before parsing):

```typescript
export const handleGameDoWebSocketMessage = async (deps, ws, message) => {
  if (typeof message !== 'string') return;

  if (!applySocketRateLimit(ws, Date.now(), deps.msgRates)) {
    return;
  }

  const parsed = parseClientSocketMessage(message);
  // ...
};
```

## Consistency Analysis

Rate limiting is consistently applied as the first check in the WebSocket message handler. No code path bypasses it. The `applySocketRateLimit` function is pure (takes `now` as a parameter rather than calling `Date.now()` internally), making it easy to test with deterministic timestamps.

Chat rate limiting is applied at the aux message dispatch level, which means it only affects chat messages and not other aux messages (ping, rematch). This is correct since ping and rematch do not produce user-visible output.

The socket rate limiter closes the socket on violation (hard enforcement), while the chat rate limiter silently drops messages (soft enforcement). This asymmetry is intentional: socket flooding is malicious, while rapid chatting is merely annoying.

## Completeness Check

- **No per-action rate limiting**: Game state actions are not individually rate-limited beyond the socket-wide 10/sec cap. A player could theoretically send 10 combat actions per second, though the engine's phase checks would reject most of them.
- **No IP-level rate limiting**: Rate limiting is per-socket, not per-IP. A malicious client could open multiple connections. The Worker router (not the DO) would need to add IP-level throttling.
- **No backoff**: The socket is immediately closed on violation with no warning or backoff. This is aggressive but appropriate for a game server where legitimate clients never approach the limit.
- **Test coverage**: `socket.test.ts` tests both the rate limit triggering and the socket close behaviour.

## Related Patterns

- **58 -- Multi-Stage Validation**: Rate limiting is Stage 0, running before even JSON parsing.
- **50 -- Hibernatable WebSocket**: The `WeakMap` rate state survives hibernation wake cycles.
- **59 -- Error Code Enum**: Rate limit violations bypass the error code system entirely (socket close, not error message).
