# Delta-V MCP Reference

This document is the MCP server/tool reference only.

For onboarding and workflow:

- [`AGENTS.md`](./AGENTS.md) (quick start + tuning workflow)
- [`AGENT_SPEC.md`](../AGENT_SPEC.md) (deep protocol/architecture, lives at repo root)

## Discovery endpoints

- `https://delta-v.tre.systems/agents`
- `https://delta-v.tre.systems/.well-known/agent.json`
- `https://delta-v.tre.systems/agent-playbook.json`

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
| `delta_v_quick_match_connect` | Queue + connect seat | `scenario`, `username`, `playerKey?` | `{ sessionId, code, playerId, playerToken, status }` |
| `delta_v_list_sessions` | List active local sessions | none | `{ sessions[] }` |
| `delta_v_get_state` | Raw authoritative state | `sessionId` | `{ state, latestEventId }` |
| `delta_v_get_observation` | Agent observation payload | `sessionId`, `includeSummary?`, `includeLegalActionInfo?`, `includeTactical?`, `includeSpatialGrid?`, `includeCandidateLabels?` | `AgentTurnInput`-compatible object |
| `delta_v_wait_for_turn` | Block until actionable turn window | `sessionId`, `timeoutMs?`, same include flags as observation | observation payload |
| `delta_v_get_events` | Read buffered event stream | `sessionId`, `afterEventId?`, `limit?`, `clear?` | `{ events[], bufferedRemaining }` |
| `delta_v_send_action` | Submit C2S action | `sessionId`, `action` | `{ actionType }` (or richer action result when enabled) |
| `delta_v_send_chat` | Send chat message | `sessionId`, `text` (alias: `message`) | `{ text }` |
| `delta_v_close_session` | Close local MCP session | `sessionId` | `{ closed }` |

Notes:

- `delta_v_wait_for_turn` throws on timeout and may return/reject when game reaches `gameOver`.
- `delta_v_get_events`, `delta_v_list_sessions`, and `delta_v_close_session` are local-session helpers (stdio MCP ownership model).
- `delta_v_get_observation` is the preferred read surface for most agents; `delta_v_get_state` is lower-level.

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
