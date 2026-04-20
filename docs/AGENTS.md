# Delta-V Agents: Practical Guide

The fastest path to a working Delta-V agent — integration-path choice, a runnable quick start for each path, the contract your model receives, and a tuning workflow. Start here; read deeper docs only when you need them:

- [AGENT_SPEC.md](../AGENT_SPEC.md) — deep protocol and design reference
- [DELTA_V_MCP.md](./DELTA_V_MCP.md) — MCP tool catalog and host configuration
- [SIMULATION_TESTING.md](./SIMULATION_TESTING.md) — large-scale simulation and load/chaos harness
- [SECURITY.md](./SECURITY.md) — token model, rate limits, abuse controls

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

- `delta_v_quick_match` (`delta_v_quick_match_connect` is a compatibility alias)
- `delta_v_wait_for_turn`
- pick candidate (or custom action)
- `delta_v_send_action`
- if the local session drops, `delta_v_reconnect`
- (hosted MCP) if an observation includes `lastTurnAutoPlayed`, your seat was auto-advanced after a turn timeout — compare `candidates[lastTurnAutoPlayed.index]` and tighten your per-turn budget
- repeat until game over
- `delta_v_close_session`

### Hosted MCP: two-token quick match (leaderboard-eligible)

The local stdio server above uses `delta_v_quick_match_connect` and a WebSocket session. On **production** (`https://delta-v.tre.systems/mcp`), tools use a **matchToken** and never expose raw `code` + `playerToken` to the model if you follow this flow:

1. **Mint an agent token** — `POST https://delta-v.tre.systems/api/agent-token` with JSON `{ "playerKey": "agent_yourStableId" }`. Response includes `token` (JWT-like opaque string).
   Rate limit: strict Worker-local **5 / 60 s per hashed IP**, with Cloudflare `CREATE_RATE_LIMITER` as an extra best-effort edge layer in production.
2. **Authorize every MCP request** — send `Authorization: Bearer <token>` on each `POST …/mcp` JSON-RPC call, plus `Accept: application/json, text/event-stream`.
3. **Queue a match** — call tool `delta_v_quick_match` (no args). Response includes `matchToken` (opaque per-match credential).
4. **Drive the game** — pass `matchToken` on `delta_v_wait_for_turn`, `delta_v_get_observation`, `delta_v_send_action`, etc., with the **same** Bearer header.

Quick pacing notes:

- Treat `delta_v_send_action(...waitForResult=true)` with `autoSkipLikely: true` as a hint to `delta_v_wait_for_turn`, not to immediately chain the returned `nextPhase`.
- If the first actionable observation is still `fleetBuilding`, you still need to send `fleetReady` explicitly, often with `purchases: []`.

Details, token lifetimes, and failure modes: [SECURITY.md](./SECURITY.md) (remote MCP token model) and [DELTA_V_MCP.md](./DELTA_V_MCP.md). Deep protocol: [AGENT_SPEC.md](../AGENT_SPEC.md).

### Offline benchmark (`scripts/benchmark.ts`)

For repeatable agent evaluation **without** a live Worker, run the in-process harness (same stdin/stdout contract as `scripts/llm-player.ts --agent command`):

```bash
npm run benchmark -- \
  --agent-command "npm run llm:agent:recommended --silent" \
  --opponent hard \
  --scenario duel \
  --games 20
```

Progress prints to **stderr**; a JSON summary prints to **stdout** (or `--output path.json`). Each entry in `matchups[]` includes:

- **`winRate`**, **`elo`** — logistic Elo estimate vs that opponent difficulty, anchored so built-in **easy ≈ 1000**, **normal ≈ 1200**, **hard ≈ 1400** (see `OPPONENT_ANCHOR_ELO` in `scripts/benchmark.ts`). Use the same anchors to compare runs across versions.
- **`actionValidityRate`** — accepted decisions / total; **`timeoutRate`**, **`parseErrorRate`**, **`crashes`** — stability signals.

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
