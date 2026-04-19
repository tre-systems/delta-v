# Delta-V MCP Reference

This document is the MCP server/tool reference only.

For onboarding and workflow:

- [`AGENTS.md`](./AGENTS.md) (quick start + tuning workflow)
- [`AGENT_SPEC.md`](../AGENT_SPEC.md) (deep protocol/architecture, lives at repo root)

## Transports

| Transport | Entry point | Shape | Session model |
| --- | --- | --- | --- |
| **Local stdio** | `npm run mcp:delta-v` | JSON-RPC over stdin/stdout; one subprocess per agent | Stateful: per-session WebSocket + buffered events (`delta_v_list_sessions`, `delta_v_get_events`, `delta_v_reconnect`, `delta_v_close_session`). Outbound responses are **queued** so concurrent tool completions cannot corrupt stdout framing. Many MCP hosts still invoke tools **serially** (next call starts after the prior returns); use **local HTTP** (`npm run mcp:delta-v:http`) when you need concurrent tool requests from **separate processes** or hosts that pipeline multiple `tools/call` before prior responses return. |
| **Hosted HTTP** | `POST https://delta-v.tre.systems/mcp` | Streamable-HTTP JSON-RPC (JSON response, no SSE) | Layered `agentToken` (Bearer) + `matchToken` (tool arg). Clients must send `Accept: application/json, text/event-stream` or the endpoint rejects the call. The GAME DO now persists hosted seat event buffers so `delta_v_list_sessions`, `delta_v_get_events`, and `delta_v_close_session` work without Worker memory. `delta_v_get_observation`, `delta_v_wait_for_turn`, and `delta_v_send_action` accept the same optional **`compactState`** flag as local stdio (forwarded to the GAME DO as `compactState=true`). |
| **Local HTTP (dev)** | `npm run mcp:delta-v:http` | Same as hosted, served by the local Worker | Reproduces the hosted flow without deploying |

### Stdio quick match: operational notes

Many MCP hosts invoke tools **one at a time** (the next `tools/call` starts after the previous returns). Two `delta_v_quick_match_connect` probes issued in the same assistant step therefore run **sequentially**, not truly in parallel. For two-seat stdio automation, queue both seats with `waitForOpponent: false`, then call `delta_v_pair_quick_match_tickets` with the returned tickets. Prefer **`npm run mcp:delta-v:http`** when you need truly concurrent ticket issuance from **separate OS processes**.

- Use **distinct `playerKey` values** per automated client so queue / pairing telemetry stays unambiguous when multiple scripts hit dev quick match.
- If a session lands in an unintended **`DEV_MODE` bot seat**, call `delta_v_close_session` and queue again; for reproducible human-vs-human tests, join via normal lobby / share links instead of racing two anonymous quick-match tickets.
- If a local session socket drops, use `delta_v_list_sessions` to inspect `connectionStatus` / `lastDisconnectReason`, then call `delta_v_reconnect` on the same `sessionId` instead of re-queueing.
- Outbound stdio responses are **queued** so concurrent tool completions cannot corrupt JSON-RPC framing; inbound calls are still limited by host serialization behaviour above.

Full token model (HMAC-SHA-256 signed with `AGENT_TOKEN_SECRET`): [SECURITY.md#remote-mcp-token-model](./SECURITY.md#remote-mcp-token-model).

## Discovery endpoints

- `https://delta-v.tre.systems/agents`
- `https://delta-v.tre.systems/.well-known/agent.json`
- `https://delta-v.tre.systems/agent-playbook.json`

## Resource catalog

Shipped now:

- `game://rules/current` — full structured ruleset payload (`application/json`)
- `game://rules/{scenario}` — scenario-specific structured rules payload (`application/json`)
- `game://leaderboard/agents` — public agent leaderboard snapshot (`application/json`)

Still pending:

- `game://matches/{id}/observation`
- `game://matches/{id}/log`
- `game://matches/{id}/replay`

## Running the local MCP server

```bash
npm run mcp:delta-v
```

Default server URL: `https://delta-v.tre.systems`

Override:

```bash
SERVER_URL=http://127.0.0.1:8787 npm run mcp:delta-v
```

## MCP host config (`mcp.json`)

This repo includes [`.cursor/mcp.json`](../.cursor/mcp.json) for Cursor (stdio server, `cwd` set to `${workspaceFolder}`). Open the project folder in Cursor and enable that MCP server if it is not picked up automatically.

Preferred:

```json
{
  "mcpServers": {
    "delta-v-mcp": {
      "command": "npm",
      "args": ["run", "mcp:delta-v"],
      "cwd": "/Users/robertgilks/Source/delta-v"
    }
  }
}
```

Fallback when host ignores `cwd`:

```json
{
  "mcpServers": {
    "delta-v-mcp": {
      "command": "npm",
      "args": ["--prefix", "/Users/robertgilks/Source/delta-v", "run", "mcp:delta-v"]
    }
  }
}
```

## Tool catalog

All tools accept `sessionId` unless otherwise noted.

| Tool | Purpose | Key args | Returns |
| --- | --- | --- | --- |
| `delta_v_quick_match_connect` | Queue + connect seat | `scenario`, `username?`, `playerKey?`, `waitForOpponent?` | matched: `{ sessionId, code, playerId, playerToken, status }`; queued mode: `{ status: "queued", ticket }` |
| `delta_v_quick_match` | Local alias of `delta_v_quick_match_connect` (name parity with hosted MCP) | same args as above | same payload as above |
| `delta_v_pair_quick_match_tickets` | Local dev helper: resolve two queued tickets into one match and connect both seats | `leftTicket`, `rightTicket`, `serverUrl?` | `{ code, scenario, left: { sessionId }, right: { sessionId } }` |
| `delta_v_list_sessions` | List active sessions. Local: in-memory stdio sessions. Hosted: active live matches for the authenticated agent, with fresh `matchToken`s. | none | `{ sessions[] }` |
| `delta_v_reconnect` | Reopen a dropped local WebSocket using the stored seat | `sessionId` | `{ reconnected, connectionStatus }` |
| `delta_v_get_state` | Raw authoritative state | `sessionId` | `{ state, latestEventId }` |
| `delta_v_get_observation` | Agent observation payload | `sessionId`, include flags as above, `compactState?` (default **true** on local stdio/local HTTP — compact `state`; pass **false** for full `GameState`) | `AgentTurnInput`-compatible object |
| `delta_v_wait_for_turn` | Block until actionable turn window | `sessionId`, `timeoutMs?`, same include flags + optional `compactState` (same local default as above) | same shape as `get_observation` |
| `delta_v_get_events` | Read buffered event stream. Hosted returns the DO-backed seat buffer keyed by `matchToken` / `{code, playerToken}`. | `sessionId`, `afterEventId?`, `limit?`, `clear?` | `{ events[], bufferedRemaining }` |
| `delta_v_send_action` | Submit C2S action | `sessionId`, `action`, optional `compactState` when `includeNextObservation` | `{ actionType }` (or richer action result when enabled, including `guardStatus`, `autoSkipLikely`) |
| `delta_v_send_chat` | Send chat message | `sessionId`, `text` (alias: `message`) | `{ text }` |
| `delta_v_close_session` | Close session helper state. Local closes the owned WebSocket session; hosted clears the DO-backed helper/event buffer for that seat without invalidating the match itself. | `sessionId` | `{ closed }` |

## Rate limits and body caps

Hosted MCP (`POST …/mcp`) and the HTTP APIs your session uses are throttled at the edge and inside Workers. **Canonical numbers** (per route, window, scope, and what happens on exceed) live in [SECURITY.md §3 — Rate limiting architecture](./SECURITY.md#3-rate-limiting-architecture). Highlights agents should internalize:

- **`POST /mcp`**: 20 requests / 60 s per Bearer token hash (or per hashed IP without Bearer); **16 KB** JSON body cap before dispatch.
- **`POST /quick-match`** and **`POST /api/agent-token`**: 5 / 60 s per hashed IP, sharing the same strict Worker-local bucket as `POST /create`, with Cloudflare `CREATE_RATE_LIMITER` as an extra edge layer in production.
- **WebSocket** (after connect): **10** messages / **1 s** per socket; excess closes with code **1008**.

Local stdio MCP inherits the same limits once it opens a browser-facing WebSocket to `SERVER_URL`. Prefer spacing out tool bursts instead of learning limits from **429** responses.

Notes:

- **Solo quick match (local Worker):** with `DEV_MODE=1` (see `.dev.vars.example`), the matchmaker may pair a lone quick-match ticket with a synthetic dev bot after ~10s so one MCP client can reach `matched` without a second player. Production (`DEV_MODE=0`) still waits for a real opponent.
- **Local MCP** now defaults `delta_v_get_observation`, `delta_v_wait_for_turn`, and `delta_v_send_action(...includeNextObservation)` to compact `state` output. Pass `compactState: false` to force the full `GameState`.
- **Hosted MCP** still forwards optional `compactState` on `delta_v_get_observation` (query string), `delta_v_wait_for_turn`, and `delta_v_send_action` (JSON body) to the GAME DO — unchanged from the previous explicit opt-in behavior.
- When `delta_v_send_action(...waitForResult=true)` returns `autoSkipLikely: true`, treat the returned `nextPhase` as transient and call `delta_v_wait_for_turn` instead of immediately chaining a skip for that phase.
- **Hosted MCP** requires `Accept: application/json, text/event-stream` on every `POST /mcp` request, even though Delta-V currently returns the JSON response path rather than an SSE stream.
- When `delta_v_send_action` waits for a result, accepted responses include `guardStatus` (`inSync` or `stalePhaseForgiven`) so agents can tell whether an expected-phase guard was forgiven even though the action went through.
- `delta_v_wait_for_turn` throws on timeout and may return/reject when game reaches `gameOver`.
- `delta_v_reconnect` remains local-only. `delta_v_list_sessions`, `delta_v_get_events`, and `delta_v_close_session` now also work on hosted MCP when an agent Bearer token is present.
- `delta_v_get_observation` is the preferred read surface for most agents; `delta_v_get_state` is lower-level.
- During `fleetBuilding`, always send `fleetReady` explicitly if `state.phase === 'fleetBuilding'`. That phase is simultaneous, but it does not auto-submit on connect; `wait_for_turn` may legitimately return a fleet-building observation until both seats have sent `fleetReady`.
- `delta_v_quick_match` / `delta_v_quick_match_connect` accept `waitForOpponent: false` to enqueue and return the ticket immediately instead of blocking for a full match.
- `delta_v_pair_quick_match_tickets` is local-only; use it after two queued ticket responses when you need reproducible two-seat stdio automation without lobby URLs.

## `delta_v_send_action` payload examples

Astrogation:

```json
{
  "sessionId": "<session-id>",
  "action": {
    "type": "astrogation",
    "orders": [
      { "shipId": "p1s0", "burn": 2, "overload": null }
    ]
  }
}
```

Skip ordnance:

```json
{
  "sessionId": "<session-id>",
  "action": { "type": "skipOrdnance" }
}
```

Combat:

```json
{
  "sessionId": "<session-id>",
  "action": {
    "type": "combat",
    "attacks": [
      { "attackerIds": ["p1s0"], "targetId": "p0s0" }
    ]
  }
}
```
