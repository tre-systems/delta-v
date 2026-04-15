# Delta-V Agents: Practical Guide

This is the fastest way to build and run Delta-V agents.

Use this guide first, then use deeper docs only when needed:

- Deep protocol/design reference: `AGENT_SPEC.md`
- MCP-specific tool reference: `docs/DELTA_V_MCP.md`
- Large-scale simulation/load testing: `docs/SIMULATION_TESTING.md`

## Choose an integration path

- `MCP` (recommended): easiest robust loop, legal candidates included.
- `Bridge` (`scripts/llm-player.ts`): great for custom command/HTTP agents.
- `Raw WebSocket`: maximum control, maximum implementation work.

## Quick start (MCP path)

1) Start the MCP server:

```bash
npm run mcp:delta-v
```

2) Agent loop:

- `delta_v_quick_match_connect`
- `delta_v_wait_for_turn`
- pick candidate (or custom action)
- `delta_v_send_action`
- repeat until game over
- `delta_v_close_session`

## Quick start (bridge path)

Host:

```bash
npm run llm:player -- --mode create --scenario duel --agent command --agent-command "npm run llm:agent:recommended --silent"
```

Join:

```bash
npm run llm:player -- --mode join --code ABCDE --agent command --agent-command "npm run llm:agent:recommended --silent"
```

Useful flags:

- `--decision-timeout-ms 30000`
- `--think-ms 200`
- `--no-auto-chat-replies` (recommended for autonomous test runs)
- `--verbose`

## Agent contract (what your model/process receives)

Bridge agents receive `AgentTurnInput` (`version`, `gameCode`, `playerId`, `state`, `candidates`, `recommendedIndex`, optional summary/legal metadata) and must return:

- `{ "candidateIndex": number }`, or
- `{ "action": { ...C2S } }`

Authoritative code paths:

- Observation builder: `src/shared/agent/observation.ts`
- Protocol types: `src/shared/types/protocol.ts`
- Bridge loop: `scripts/llm-player.ts`

## Reliability checklist (high value)

- Prefer candidate actions unless you need custom tactical logic.
- Always guard against stale turn/phase; do not assume state is unchanged after thinking delay.
- Treat action rejection as normal runtime behavior and re-decide on fresh state.
- Keep chat low-noise during autonomous scrimmage runs.
- Record per-game metrics (`actionRejectedCount`, ordnance mix, turns) for tuning.

## Recommended tuning workflow

1) Run small live batch (2-5 games) with JSON export:

```bash
npm run quickmatch:scrimmage -- --server-url https://delta-v.tre.systems --live --json-out tmp/scrimmage-results.json
```

2) Identify one problem class (for example: stale opening action, over-aggressive ordnance, chat noise).

3) Apply one targeted change.

4) Re-run and compare:

- rejection rate
- win split by seat
- average turns
- ordnance composition

## Common pitfalls

- Matchmaking split in dual-queue scripts: use retry pairing logic.
- Stale first-turn sends: re-check current phase before send.
- Chat echo storms: disable or heavily gate auto replies.
- Hidden-state leaks: only use server-provided seat-scoped observations.

## Where to make changes

- Runner behavior and retries: `scripts/llm-player.ts`, `scripts/quick-match-scrimmage.ts`, `scripts/quick-match-agent.ts`
- Agent policy logic: `scripts/llm-agent-*.ts`
- Shared tactical features and candidates: `src/shared/agent/`
- MCP server behavior: `scripts/delta-v-mcp-server.ts`
