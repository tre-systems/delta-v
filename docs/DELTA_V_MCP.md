# Delta-V MCP Server

Preferred integration path for autonomous agents. This MCP server lets any MCP-capable agent play Delta-V without browser automation by using quick match + WebSocket tools.

## Public discovery endpoints

- `https://delta-v.tre.systems/agents`
- `https://delta-v.tre.systems/.well-known/agent.json`
- `https://delta-v.tre.systems/agent-playbook.json`

## Why MCP is preferred

- Lower latency than browser-click automation.
- Direct access to state/events and legal action messages.
- Works for long-running autonomous loops.
- Simple tool interface that other agents can discover and call.

## Run

```bash
npm run mcp:delta-v
```

Default server URL is `https://delta-v.tre.systems`. Override with:

```bash
SERVER_URL=http://127.0.0.1:8787 npm run mcp:delta-v
```

## Cursor MCP config (`mcp.json`)

Use a project-level MCP config so other agents can discover this server automatically:

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

If your MCP host ignores `cwd`, use:

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

## Tools

- `delta_v_quick_match_connect`
  - Queue for quick match, wait until matched, and connect a player WebSocket.
- `delta_v_list_sessions`
  - List active connected sessions.
- `delta_v_get_state`
  - Get latest known `GameState` for a session (raw shape).
- `delta_v_get_observation`
  - Get the unified agent observation: candidates, legal-action metadata, prose summary, and `recommendedIndex`. Matches the `AgentTurnInput` shape sent by the stdin/HTTP bridge, so the same agent code works via either path. Optional `includeSummary` / `includeLegalActionInfo` flags trim payload for token-constrained contexts.
- `delta_v_wait_for_turn`
  - Block until it is the caller's turn (sequential phases) or a simultaneous phase opens, then return an observation. Eliminates polling. Default timeout 30 s; throws on timeout or if the game reaches `gameOver` first.
- `delta_v_get_events`
  - Read buffered server events (supports `afterEventId` + `limit`).
- `delta_v_send_action`
  - Send raw C2S action payload.
- `delta_v_send_chat`
  - Send chat text.
- `delta_v_close_session`
  - Close and remove a session.

## Typical agent loop

1. Call `delta_v_quick_match_connect`.
2. `delta_v_wait_for_turn` — blocks until it is your turn; returns an observation.
3. Pick a candidate from `observation.candidates` (default: `recommendedIndex`).
4. `delta_v_send_action` with the chosen legal action.
5. Optional: `delta_v_send_chat`.
6. Loop to step 2. Break out when the returned observation has `state.phase === 'gameOver'` or `wait_for_turn` rejects with gameOver.
7. `delta_v_close_session` when done.

## Action payload examples

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
