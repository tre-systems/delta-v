# Simulation and Load Testing

Delta-V has three complementary simulation layers. Because the shared engine is side-effect-free and deterministic given injected RNG, high-speed simulation is cheap and reproducible.

| Layer | Script | Purpose |
| --- | --- | --- |
| Headless engine (AI vs AI) | `scripts/simulate-ai.ts` | Scenario balance, AI effectiveness, crash-finding |
| Network load / chaos | `scripts/load-test.ts` | DO lifecycle, WebSocket, reconnection, concurrency |
| LLM / agent bridge | `scripts/llm-player.ts` | External model-driven agent against browser or another agent |

Related docs: [AGENTS.md](./AGENTS.md) (agent workflow), [MANUAL_TEST_PLAN](./MANUAL_TEST_PLAN.md), [ARCHITECTURE](./ARCHITECTURE.md).

---

## 1. Headless engine simulation

**Goal.** Run large batches of AI-vs-AI games to test balance and find crash edges deep in the game tree. Runs in Node, no browser or Worker runtime.

**Loop shape.** `createGame` → `while phase !== 'gameOver'` → call the appropriate AI helper for the active phase (`aiAstrogation` / `aiOrdnance` / `aiLogistics` / `aiCombat`) → pass the result to the matching engine entry point. All engine calls take a mandatory `rng`, so a seed reproduces the game exactly.

**Commands.**

```bash
npm run simulate                             # 100 games of the default scenario
npm run simulate -- all 60 --ci              # CI gate: all 9 scenarios × 60 games
npm run simulate -- duel 30 --randomize-start
npm run simulate:duel-sweep                  # duel pacing/seat-balance across many seeds
npm run simulate -- grandTour 20 --seed 1 --capture-failures tmp/ai-failures
```

- `--ci` fails on engine crashes or rejected built-in AI actions; balance and objective warnings print but are non-fatal.
- `--randomize-start` forces per-game seat randomization. Duel, interplanetaryWar, and fleetAction auto-randomize seat anyway so seat-order bias doesn't dominate short batches.
- CI balance warnings use per-scenario decided-game win-rate bands. Cooperative / race scenarios (like Grand Tour) skip the normal balance gate, but objective policies can still emit non-fatal seat-skew warnings when a race resolves correctly yet remains grossly one-sided.

**Scenario scorecards.** Every simulation result now includes a `scorecard`
object in JSON output and prints a compact scorecard in text mode. Treat that
scorecard as the first stop for AI tuning reviews:

- `objectiveShare` — games that resolved through the scenario's intended
  objective route.
- `fleetEliminationShare` — games that ended by deleting the opposing fleet.
- `timeoutShare` — draws or progress-tiebreak timeouts.
- `player0DecidedRate` — decided-game seat balance when applicable.
- `passengerDeliveryShare` — passenger objective completions for convoy /
  evacuation-style scenarios.
- `grandTourCompletionShare` — clean Grand Tour completions rather than
  attrition or timeout progress wins.
- `invalidActionShare` — built-in AI action rejections per game; any non-zero
  value fails `--ci`.
- `fuelStallsPerGame` — active, fueled, stationary ships that coast instead of
  burning or landing.
- `averageTurns` — pacing signal; compare on paired seeds before/after a
  change.

For AI PRs, compare scorecards on paired seed sets rather than only quoting
win rate. If a simulation exposes a bad state, prefer saving that state as a
focused decision-class regression ("land to refuel", "preserve passenger
carrier", "do not coast while stalled") over adding another global weight from
one trace.

**Failure captures.** Use `--capture-failures <dir>` to write bounded JSON
snapshots for invalid built-in AI actions, fuel stalls, and objective-scenario
drift such as fleet-elimination resolutions. The default cap is 5 files;
override it with `--capture-failures-limit N`. Captures include the seed,
scenario, active player, proposed action when relevant, stalled ship ids when
relevant, and the full `GameState`. To promote a capture, copy the JSON into a
focused `__fixtures__` path and assert the decision class has changed. For example,
[`src/shared/ai/__fixtures__/grand-tour-fuel-stall.json`](../src/shared/ai/__fixtures__/grand-tour-fuel-stall.json)
backs a regression that checks the AI no longer submits a fueled stationary
coast for that state.

**CI + full verification iteration count.** CI, `npm run verify`, and `DELTAV_FULL_PRE_PUSH=1 git push` run `simulate all 60 -- --ci` (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`package.json`](../package.json), and [`.husky/pre-push`](../.husky/pre-push)). The default pre-push hook only runs `npm run simulate:smoke` when AI, agent, engine, scenario, or simulation files changed.

`npm run simulate:duel-sweep` runs `scripts/duel-seed-sweep.ts` — the same duel harness across many base seeds in one table, showing pacing (`avgTurn`) and seat balance (`p0/dec%`) variance before changing duel geometry or rules. Options: `--iterations N`, `--from` / `--to`, `--seeds 0,1,2`, `--scenario <key>`, `--json`.

---

## 2. Network load and chaos

**Goal.** Validate the Durable Object lifecycle, WebSocket handling, reconnection, and concurrency. Drives real rooms over HTTP with both seats as bots.

**Loop shape.** `POST /create` → both seats open WebSockets (`createBotClient()`) → on each state-bearing S2C, the active player thinks briefly and submits a valid C2S from the existing AI helpers. Chaos mode forces drops + reconnects with the stored `playerToken`.

**Commands.**

```bash
npm run load:test -- --games 20 --concurrency 5
npm run load:test -- --games 10 --concurrency 3 --scenario duel
npm run load:test -- --games 12 --concurrency 4 --disconnect-rate 0.25
```

**Local setup.** If your local Wrangler D1 predates the latest schema, apply migrations before long runs: `npx wrangler d1 migrations apply delta-v-telemetry --local`.

**Reporting.** Per-match summary (code, winner, turns, duration, actions sent, reconnect count) plus an aggregate summary (completed/failed matches, reconnect success, server/socket errors, totals, win reasons).

---

## 3. LLM / agent bridge

**Goal.** Let external model-driven agents (LLMs, custom planners, tool-using bots) play real online matches using the same room protocol as browser clients.

**Script.** [`scripts/llm-player.ts`](../scripts/llm-player.ts). The bridge can **create** a new match (and wait for an opponent) or **join** an existing room code. Two bridge processes run LLM-vs-LLM end-to-end.

Full agent onboarding — MCP vs bridge choice, contract, reliability checklist, tuning workflow — lives in [AGENTS.md](./AGENTS.md). The per-turn payload shape (`AgentTurnInput` / `AgentTurnResponse`) is defined in [AGENT_SPEC.md §4](../AGENT_SPEC.md#4-observation-model).

**Quick examples.**

```bash
# Host with a stdin/stdout agent; share the printed code with a browser opponent
npm run llm:player -- --mode create --scenario duel \
  --agent command --agent-command "python ./tools/my_agent.py"

# Join an existing code with an HTTP agent
npm run llm:player -- --mode join --code ABCDE \
  --agent http --agent-url http://127.0.0.1:8080/turn

# Baseline fallback (built-in policy, no external agent)
npm run llm:player -- --mode create --agent builtin
```

If the agent's output is invalid, times out, or mismatches the current phase, the bridge falls back to built-in policy (`--difficulty`).
