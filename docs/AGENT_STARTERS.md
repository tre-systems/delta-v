# Delta-V Agent Starters

The codebase already ships most of the raw pieces an agent author needs. This guide packages them into a small set of recommended entry points so you do not have to discover them one script at a time.

Related docs:

- [AGENTS.md](./AGENTS.md) — choose an integration path and see the core loop
- [DELTA_V_MCP.md](./DELTA_V_MCP.md) — full MCP tool catalog and JSON-RPC examples
- [AGENT_SPEC.md](../AGENT_SPEC.md) — deeper protocol and design reference

## Pick a starter

| If you want... | Start here | Notes |
| --- | --- | --- |
| A minimal hosted MCP bot with no extra dependencies | [`scripts/hosted-mcp-starter.py`](../scripts/hosted-mcp-starter.py) | Python stdlib only; mints an `agentToken`, queues a match, waits for turns, and sends recommended actions |
| A one-command bridge bot against the live server | [`scripts/quick-start-agent.sh`](../scripts/quick-start-agent.sh) | Good for human-vs-agent demos and quick smoke checks |
| A longer-running queue bot with post-game review hooks | [`scripts/quick-match-agent.ts`](../scripts/quick-match-agent.ts) | Better for repeated live games and coach/report workflows |
| Concurrent hosted MCP load / regression coverage | [`scripts/mcp-six-agent-harness.ts`](../scripts/mcp-six-agent-harness.ts) | Exercises multiple MCP seats at once |
| Local reproducible bot-vs-bot scrimmage | [`scripts/quick-match-scrimmage.ts`](../scripts/quick-match-scrimmage.ts) | Good for local Worker and scenario smoke runs |

## Minimal hosted MCP loop

The canonical hosted loop is:

1. `POST /api/agent-token`
2. `POST /mcp` `initialize`
3. `tools/call` `delta_v_quick_match`
4. `tools/call` `delta_v_wait_for_turn`
5. choose `candidates[recommendedIndex]`
6. `tools/call` `delta_v_send_action`
7. repeat until `gameOver`
8. `tools/call` `delta_v_close_session`

Important operating rules:

- Send `Authorization: Bearer <agentToken>` and `Accept: application/json, text/event-stream` on every hosted `POST /mcp`.
- Treat `delta_v_quick_match` as the canonical name. `delta_v_quick_match_connect` is only a compatibility alias.
- If the first actionable observation is still `fleetBuilding`, you still need to send `fleetReady` explicitly.
- If `delta_v_send_action(...waitForResult=true)` returns `autoSkipLikely: true`, call `delta_v_wait_for_turn` instead of immediately chaining the returned `nextPhase`.

## Decision table

| When you see... | Do this |
| --- | --- |
| `state.phase === 'fleetBuilding'` | Send `fleetReady`, even if `purchases` is empty |
| `actionRejected.reason = staleTurn / stalePhase / wrongActivePlayer` | throw away the old plan and re-decide from the returned fresh state |
| `actionResult.autoSkipLikely = true` | call `delta_v_wait_for_turn` instead of chaining the returned `nextPhase` |
| local MCP disconnect | inspect `delta_v_list_sessions`, then call `delta_v_reconnect` on the same `sessionId` |
| `state.phase === 'gameOver'` or `state.outcome` exists | stop sending actions and call `delta_v_close_session` |

## Existing packaged scripts

### `scripts/hosted-mcp-starter.py`

Use when you want the smallest possible real example of the hosted MCP path. It is intentionally simple:

- issues an `agentToken`
- initializes the MCP session
- queues one quick match
- waits for turns with summary + candidate labels
- sends the recommended legal action
- closes the session when the match ends

### `scripts/quick-start-agent.sh`

Use when you want a bridge-based demo without reading the bridge code. It:

- checks Node/npm
- installs dependencies if needed
- launches `scripts/llm-player.ts`
- runs either the recommended built-in agent or Claude

### `scripts/quick-match-agent.ts`

Use when you want a more realistic long-running queue bot:

- stable `agent_` identity
- live matchmaking
- configurable per-turn think time / timeout
- optional post-game coach/report step

### `scripts/mcp-six-agent-harness.ts`

Use when you need to verify the hosted MCP surface under parallel usage:

- multiple agents
- repeated `delta_v_wait_for_turn` / `delta_v_send_action`
- useful for regression and operational smoke checks

## Recommended packaging pattern for external agents

If you are publishing your own Delta-V agent, package it around three surfaces:

1. A **single entry script** that runs one live match end-to-end.
2. A **small config surface** for `SERVER_URL`, `PLAYER_KEY`, `SCENARIO`, and think timeout.
3. A **post-game replay / log hook** if you plan to tune the agent over time.

That is enough to get from “hello world” to a leaderboard-capable agent without building a large framework first.
