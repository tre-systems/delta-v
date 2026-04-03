# Hibernatable WebSocket

## Category

Protocol & Communication

## Intent

Leverage Cloudflare Durable Object WebSocket Hibernation to avoid paying for wall-clock time when no messages are in flight. The DO can be evicted from memory between messages while keeping WebSocket connections alive, dramatically reducing costs for idle game rooms.

## How It Works in Delta-V

Cloudflare's WebSocket Hibernation API allows a Durable Object to call `ctx.acceptWebSocket(server, tags)` during the WebSocket upgrade, then go to sleep. When a message arrives on any accepted socket, the runtime wakes the DO and invokes the `webSocketMessage(ws, message)` callback. Similarly, `webSocketClose` fires when a socket disconnects.

Delta-V's `GameDO` class extends `DurableObject` and uses the hibernation entrypoints:

1. **WebSocket upgrade** (`fetch.ts`): The HTTP handler upgrades the request, calls `ctx.acceptWebSocket(server, tags)` with tags like `player:0` or `spectator`, then sends a `welcome` or `spectatorWelcome` message.

2. **Message handling** (`ws.ts` / `socket.ts`): `webSocketMessage` delegates to `handleGameDoWebSocketMessage`, which rate-limits, parses, validates, and dispatches the message.

3. **Close handling** (`ws.ts`): `webSocketClose` delegates to `handleGameDoWebSocketClose`, which sets disconnect markers and broadcasts `opponentStatus`.

4. **Socket tags**: The DO uses `ctx.getWebSockets(tag)` to find player and spectator sockets without maintaining in-memory state. Tags like `player:0`, `player:1`, and `spectator` allow targeted broadcast and viewer-aware filtering.

5. **Alarm**: The DO uses `ctx.storage.setAlarm()` for turn timeouts, disconnect grace periods, and inactivity cleanup. The alarm wakes the DO from hibernation to handle time-based events.

The entire WebSocket lifecycle is kept in `ws.ts` (hibernation callbacks), while parsed message helpers live in `socket.ts`. This separation keeps the hibernation surface small and testable.

## Key Locations

- `src/server/game-do/game-do.ts` (lines 71-129) -- `GameDO` class, socket tag methods
- `src/server/game-do/ws.ts` -- `handleGameDoWebSocketMessage`, `handleGameDoWebSocketClose`
- `src/server/game-do/socket.ts` -- `parseClientSocketMessage`, `applySocketRateLimit`
- `src/server/game-do/fetch.ts` -- WebSocket upgrade handler, `ctx.acceptWebSocket`
- `src/server/game-do/session.ts` -- disconnect markers, alarm scheduling
- `src/server/game-do/alarm.ts` -- `runGameDoAlarm`

## Code Examples

Socket tag-based player identification (survives hibernation):

```typescript
private getPlayerId(ws: WebSocket): PlayerId | null {
  const tag = this.getTags(ws).find((t) => t.startsWith('player:'));
  const id = tag ? parseInt(tag.split(':')[1], 10) : null;
  return id === 0 || id === 1 ? id : null;
}

private getSeatOpen(): [boolean, boolean] {
  return [
    this.getWebSockets('player:0').length === 0,
    this.getWebSockets('player:1').length === 0,
  ];
}
```

WebSocket message lifecycle (hibernation-safe):

```typescript
export const handleGameDoWebSocketMessage = async (
  deps: GameDoWebSocketMessageDeps,
  ws: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> => {
  if (typeof message !== 'string') return;

  if (!applySocketRateLimit(ws, Date.now(), deps.msgRates)) {
    return;
  }

  const parsed = parseClientSocketMessage(message);
  if (!parsed.ok) {
    sendInvalidSocketMessageError(deps, ws, parsed.error);
    return;
  }

  const msg: C2S = parsed.value;
  const playerId = deps.getPlayerId(ws);

  if (playerId === null) {
    await handleSpectatorSocketMessage(deps, ws, msg);
    return;
  }

  await dispatchPlayerSocketMessage(deps, ws, playerId, msg);
};
```

## Consistency Analysis

The hibernation pattern is consistently applied:

- No in-memory state is relied upon to survive between messages. Player identity comes from socket tags. Game state comes from DO storage (reconstructed via event-sourced projection). Rate limit state uses a `WeakMap` keyed on WebSocket objects, which the runtime preserves across hibernation.
- The `replacedSockets` WeakSet handles the edge case where a reconnecting player's old socket fires a close event after the new socket is accepted.
- All broadcast functions use `ctx.getWebSockets(tag)` rather than maintaining a socket list in memory.

One subtlety: the `msgRates` WeakMap and `lastChatAt` Map are instance fields on `GameDO`. These survive within a single hibernation wake cycle but are lost if the DO is fully evicted and restarted. This is acceptable because rate limits are short-lived windows (1 second) and chat throttling (500ms) is best-effort.

## Completeness Check

- **No explicit hibernate call**: The DO does not call any explicit hibernate API -- it simply returns from the message handler and the runtime hibernates it automatically. This is the correct pattern for Cloudflare DOs.
- **Alarm interaction**: Alarms wake the DO just like messages do. The alarm handler must also be hibernation-safe, which it is (it reads state from storage).
- **Storage reads on wake**: Every action reads current game state from storage via `getProjectedCurrentStateRaw`, which projects from checkpoint + event tail. This is the cost of hibernation -- state is rebuilt on each wake. Checkpoints amortise this cost.

## Related Patterns

- **49 -- Viewer-Aware Filtering**: Socket tags enable per-viewer message routing.
- **48 -- Single State-Bearing Message**: Full-state messages mean the DO does not need to track what each client has seen.
- **60 -- Rate Limiting**: `applySocketRateLimit` runs on every wake before any message processing.
