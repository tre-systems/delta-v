# Simulation and Load Testing

Delta-V has three complementary simulation layers. Because the shared engine is side-effect-free and deterministic given injected RNG, high-speed simulation is cheap and reproducible.

| Layer | Script | Purpose |
| --- | --- | --- |
| Headless engine (AI vs AI) | `scripts/simulate-ai.ts` | Scenario balance, AI effectiveness, crash-finding |
| Network load / chaos | `scripts/load-test.ts` | DO lifecycle, WebSocket, reconnection, concurrency |
| LLM / agent bridge | `scripts/llm-player.ts` | External model-driven agent against browser or another agent |

Related docs: [AI.md](./AI.md) (built-in AI workflow),
[AGENTS.md](./AGENTS.md) (agent workflow),
[MANUAL_TEST_PLAN](./MANUAL_TEST_PLAN.md), [ARCHITECTURE](./ARCHITECTURE.md).

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
npm run simulate:duel-sweep -- --scenario convoy --iterations 30
npm run simulate:duel-sweep -- --scenario convoy --iterations 30 --json > before.json
npm run simulate:duel-sweep -- --scenario convoy --iterations 30 --json --baseline-json before.json
npm run simulate -- grandTour 20 --seed 1 --capture-failures tmp/ai-failures
```

- `--ci` fails on engine crashes or rejected built-in AI actions; balance and objective warnings print but are non-fatal.
- `--randomize-start` forces per-game starting-player randomization.
  Biplanetary, Duel, Grand Tour, interplanetaryWar, and fleetAction auto-randomize the
  starting player so turn-order bias doesn't dominate short batches.
  Biplanetary also auto-swaps scenario sides in the simulator so scorecards
  measure player fairness under randomized live seat assignment rather than the
  deterministic route advantage of one named side.
- CI balance warnings use per-scenario decided-game win-rate bands. Cooperative / race scenarios (like Grand Tour) skip the normal balance gate, but objective policies can still emit non-fatal seat-skew warnings when a race resolves correctly yet remains grossly one-sided.
- Quick-match seat assignment is outside the headless engine harness. Use
  `npm run test -- src/server/matchmaker-do.test.ts` for the server-side
  Duel queue regression that cycles stable player keys through both seat
  assignments and verifies token-to-seat mapping.

**Scenario scorecards.** Every simulation result now includes a `scorecard`
object in JSON output and prints a compact scorecard in text mode. Treat that
scorecard as the first stop for AI tuning reviews:

- `objectiveShare` — games that resolved through the scenario's intended
  objective route. For passenger-rescue scenarios this includes both delivery
  wins and the interceptor's decisive "no colonists survive" objective failure.
- `fleetEliminationShare` — games that ended by deleting the opposing fleet.
- `timeoutShare` — draws or progress-tiebreak timeouts.
- `player0DecidedRate` — decided-game seat balance when applicable.
- `passengerDeliveryShare` — successful passenger deliveries for convoy /
  evacuation-style scenarios; compare this separately from `objectiveShare`
  when tuning escort-side survival.
- `grandTourCompletionShare` — clean Grand Tour completions rather than
  attrition or timeout progress wins.
- `invalidActionShare` — built-in AI action rejections per game; any non-zero
  value fails `--ci`.
- `fuelStallsPerGame` — active, fueled, stationary ships that coast instead of
  burning or landing, excluding pure-combat station keeping within two hexes of
  an enabled enemy. Gated per scenario at 30 stalls/game in
  `OBJECTIVE_WARNING_POLICIES`; the gate fires for an order-of-magnitude
  regression like the 2026-04-24 fleetAction (72.1) and interplanetaryWar
  (110.3) sweeps without flapping on convoy's healthy 19.3 baseline.
- `averageTurns` — pacing signal; compare on paired seeds before/after a
  change.

For AI PRs, compare scorecards on paired seed sets rather than only quoting
win rate. If a simulation exposes a bad state, prefer saving that state as a
focused decision-class regression ("land to refuel", "preserve passenger
carrier", "do not coast while stalled") over adding another global weight from
one trace. Use [AI.md#reporting-template](./AI.md#reporting-template) for the
expected PR or handoff summary shape.

**Intent-first AI plan reporting.** Passenger and refuel doctrine now has named
plans documented in [ARCHITECTURE.md#intent-first-ai-plans](./ARCHITECTURE.md#intent-first-ai-plans).
For behavior changes in those areas, report both:

- the fixture or capture that motivated the change, including the chosen intent
  when available; and
- paired scorecard deltas on the affected scenario(s), especially
  `objectiveShare`, `fleetEliminationShare`, `player0DecidedRate`,
  `invalidActionShare`, and `fuelStallsPerGame`.

For example, the 2026-04-28 passenger-objective-failure change moved the
seed-21 80-game convoy scorecard from 11.25% objective / 83.75% fleet
elimination to 73.75% objective / 26.25% fleet elimination with no invalid
actions or passenger-transfer mistakes. Passenger delivery share stayed 11.25%,
which is why follow-up tuning should target carrier survival rather than
outcome classification.

The 2026-04-28 Grand Tour start-order change made the race randomize its
starting player at game creation. On `grandTour 40 --seed 21`, the scorecard
was 40% P0 decided, 90% Grand Tour completion, 10% fleet elimination, and no
invalid actions or fuel stalls. Across seeds 0-7 at 20 games each, the aggregate
was 52.5% P0 decided, 96.875% Grand Tour completion, 3.125% fleet elimination,
0 timeouts, 0 invalid actions, and 0 fuel stalls.

**Failure captures.** Use `--capture-failures <dir>` to write bounded JSON
snapshots for invalid built-in AI actions, fuel stalls, passenger-objective
failures, passenger-transfer mistakes, and objective-scenario drift such as
fleet-elimination resolutions.
The default cap is 5 files; override it with `--capture-failures-limit N`.
Use `--capture-failure-kind fuelStall` or a comma-separated list such as
`--capture-failure-kind passengerObjectiveFailure,objectiveDrift` when building
a focused fixture corpus for one recurring symptom.
Captures include the seed, scenario, active player, proposed action when
relevant, stalled ship ids or passenger-transfer diagnostics when relevant, and
the full `GameState`. Combat captures include the chosen combat plan when one
applies. Astrogation captures include `planDecisions` for named passenger,
escort, interceptor, and refuel plans, including each chosen intent and the top
rejected candidates. Ordinary scalar-scored astrogation orders also emit a
chosen-order trace with top rejected scalar burn candidates so captures show
why each ship moved even when no named plan overrode the local course score.
Special emergency escort and transfer-formation orders are named too.
Astrogation captures also include `astrogationCrashShipIds` when any submitted
order would crash under the movement engine, which helps separate already
doomed passenger-carrier captures from planner decisions that chose a bad
survivable line. Objective-drift and passenger-objective captures keep a short
`priorActionableCaptures` history so near-terminal failures can be traced back
to the preceding decisions that created the line. The capture directory also gets a
`capture-manifest.json` sidecar with one compact row per file, so reviewers can
scan captured failure kinds without opening full states. To promote a capture,
copy the JSON into a focused `__fixtures__` path and assert the decision class
has changed. For example,
[`src/shared/ai/__fixtures__/grand-tour-fuel-stall.json`](../src/shared/ai/__fixtures__/grand-tour-fuel-stall.json)
backs a regression that checks the AI no longer submits a fueled stationary
coast for that state.

**CI + full verification iteration count.** CI, `npm run verify`, and `DELTAV_FULL_PRE_PUSH=1 git push` run `simulate all 60 -- --ci` (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`package.json`](../package.json), and [`.husky/pre-push`](../.husky/pre-push)). The default pre-push hook only runs `npm run simulate:smoke` when AI, agent, engine, scenario, or simulation files changed.

`npm run simulate:duel-sweep` runs `scripts/duel-seed-sweep.ts` — the same
harness across many base seeds in one table. Despite the historical script
name, `--scenario <key>` makes it the paired-seed baseline tool for any
scenario. The table reports pacing (`avgTurn`), seat balance (`p0/dec%`), and
scorecard signals (`obj%`, `elim%`, `timeout%`, `stall/g`) so AI behavior PRs
can compare objective progress and failure density across identical seed sets.
Use `--json` when the review needs the full scorecard, including passenger
delivery, Grand Tour completion, invalid-action, and transfer-mistake fields.
The JSON payload includes both per-seed `rows` and an aggregate `summary`, which
is the preferred artifact to paste into AI behavior PRs before and after a
planner or role-scoring change. Pass `--baseline-json <path>` with a previous
JSON report to include a `comparison` block in JSON mode and print a concise
delta line in table mode. Options: `--iterations N`, `--from` / `--to`,
`--seeds 0,1,2`, `--scenario <key>`, `--json`, `--baseline-json <path>`.

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
