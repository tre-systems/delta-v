# Delta-V Simulation Testing Strategy

Delta-V now has two established simulation layers:

- **Headless Engine Simulation (AI vs AI)** is implemented and runs in CI.
- **Network Integration Simulation (PvP Bot Stress Testing)** is implemented as a usable load/chaos harness.
- **LLM/Agent WebSocket Player Bridge** is implemented for one-seat automation against browser or another agent.

Since the core `engine/game-engine.ts` is purely functional and deterministic apart from injected RNG, high-speed simulation is practical.

Related docs: [MANUAL_TEST_PLAN](./MANUAL_TEST_PLAN.md), [SPEC](./SPEC.md), [ARCHITECTURE](./ARCHITECTURE.md).

---

## 1. Headless Engine Simulation (AI vs AI)

**Goal:** Run large batches of AI-vs-AI games quickly to test scenario balance, AI effectiveness, and find crash-inducing edge cases deep in the game tree. This is implemented in `scripts/simulate-ai.ts`.

**Approach:**
The current runner executes entirely in Node.js, outside the browser and Cloudflare Worker runtime.

1. **Setup:** Initialize `GameState` using `createGame(SCENARIOS[name], map, ...)`.
2. **Starting player:** By default the runner respects the scenario's authored `startingPlayer`. Pass `--randomize-start` to override that per game when you explicitly want an alternate balance sweep.
3. **Game Loop:** Put the engine in a `while (state.phase !== 'gameOver')` loop.
4. **Turn Execution:**
   - **Astrogation:** If it's Player 0's turn, call `aiAstrogation(state, 0, map, 'hard')`. Same for Player 1. Pass the orders into `processAstrogation()`.
   - **Ordnance:** Call `aiOrdnance()` and pass to `processOrdnance()` (or call `skipOrdnance()`).
   - **Combat:** Call `aiCombat()` and pass to `processCombat()` (or `skipCombat()`).
5. **Data Collection:** Track metrics like win rates (Player 0 vs Player 1), draws/timeouts, average turns, crash count, and win reasons.

**Implementation Details:**

- Because `game-engine.ts` has no DOM or Canvas dependencies, this runs quickly in practice.
- You can run Monte Carlo-style sweeps (for example many runs of `escape`) to quantify directional balance trends.
- **Randomness:** All engine entry points (`processAstrogation`, `processCombat`, `processOrdnance`, etc.) require a mandatory `rng: () => number` parameter — there are no `Math.random` fallbacks in the turn-resolution path. Passing a seeded RNG allows completely reproducible replays when a simulation encounters a crash or an infinite loop.
- CI balance warnings use per-scenario decided-game win-rate bands rather than one global threshold. Cooperative or race scenarios (e.g. Grand Tour) are excluded from balance checks.

**Current usage:**

- `npm run simulate` runs 100 headless games of the default scenario.
- `npm run simulate -- all 25 -- --ci` runs 25 games per scenario across the current scenario roster (pre-commit hook / CI path).
- The CI workflow uses `npm run simulate all 100 -- --ci` for the broader balance sweep.
- `--ci` fails the process on engine crashes and prints balance warnings without making them fatal.
- `--randomize-start` is opt-in; use it for exploratory start-order analysis, not for the default shipped-scenario baseline.
- When using npm scripts, pass simulation arguments after `--`.

---

## 2. Network Integration Simulation (PvP Stress Testing)

**Goal:** Validate the Cloudflare Durable Object lifecycle, WebSocket handling, reconnection logic, and server scaling.

**Approach (implemented as a usable harness):**
Use `scripts/load-test.ts` to create real rooms over HTTP,
join both seats over WebSockets, and drive valid turns with
the existing AI helpers.

1. **Lobby Creation:** The script makes an HTTP POST request to `/create` to get a 5-letter game code.
2. **Seat-aware Connections:** The host joins with the creator token returned by `/create`; the guest joins tokenless, receives its `welcome.playerToken`, and reuses that token on reconnect.
3. **Bot Logic:** Each seat is a `createBotClient()` instance (closure state, `connect` / `disconnect`). On each state-bearing `S2C` message, the active player waits a short randomized think delay and sends a valid `C2S` action:
   - `fleetReady` purchases for fleet-building scenarios
   - `astrogation` orders from `aiAstrogation()`
   - `ordnance` launches from `aiOrdnance()` or `skipOrdnance`
   - `beginCombat` for owned asteroid hazards, then `combat` attacks from `aiCombat()` or `skipCombat`
   - `skipLogistics` for logistics
4. **Stress Testing:** Run many concurrent matches with `--games` and `--concurrency` to exercise room creation, seat assignment, turn flow, reconnect handling, and completion under load.
5. **Chaos Testing:** Use `--disconnect-rate` and `--reconnect-delay-ms` to force a percentage of bots to drop once and reconnect with their stored token during live play.

**Current usage:**

- `npm run load:test -- --games 20 --concurrency 5`
- `npm run load:test -- --games 10 --concurrency 3 --scenario duel`
- `npm run load:test -- --games 12 --concurrency 4 --disconnect-rate 0.25`

**Local setup note:**

- If your local Wrangler D1 state predates the latest schema, apply migrations before long stress runs:
  `npx wrangler d1 migrations apply delta-v-telemetry --local`

**Current reporting:**

- Per-match summary with room code, winner, turns, duration, actions sent, and reconnect count
- Aggregate summary for completed/failed matches, reconnect success, server/socket errors, total actions sent, and win reasons

---

## 3. LLM / Agent WebSocket Player Bridge

**Goal:** Let external model-driven agents (LLMs, custom planners, tool-using bots) play real online matches using the same room protocol as browser clients.

**Implementation:** `scripts/llm-player.ts`

The bridge can either:

1. **Create** a game and play one seat while another player joins from browser automation or manual browser play.
2. **Join** an existing room code and play that seat.

Run two bridge processes (one create, one join) for **LLM-vs-LLM**.

### Usage examples

- Host with external command agent and share code with browser opponent:
  - `npm run llm:player -- --mode create --scenario duel --agent command --agent-command "python ./tools/my_agent.py"`
- Join existing code with HTTP agent:
  - `npm run llm:player -- --mode join --code ABCDE --agent http --agent-url http://127.0.0.1:8080/turn`
- Baseline fallback policy (no external agent):
  - `npm run llm:player -- --mode create --agent builtin`

### Agent interface contract

The bridge sends a per-turn JSON payload to your agent (`stdin` for command mode, `POST` body for HTTP mode):

- `version`
- `gameCode`
- `playerId`
- `state` (authoritative `GameState`)
- `candidates` (`C2S[]` actions generated from built-in strategies)
- `recommendedIndex` (index into `candidates`)

Agent should return JSON:

- `{ "candidateIndex": 0 }` to select one candidate, **or**
- `{ "action": { ...C2S... } }` to provide a custom action.

If agent output is invalid, times out, or mismatched for the current phase, the bridge falls back to built-in policy (`--difficulty`).

---

## Summary of Progress

1. **RNG Injection**: Completed. All engine entry points require mandatory `rng` parameter for deterministic simulations.
2. **AI Runner**: Implemented. `npm run simulate` executes headless matches, and CI/verification runs the multi-scenario `--ci` pass.
3. **Load Tester**: Implemented as a first usable websocket load / chaos harness. Future work can extend it with invalid-payload fuzzing, larger soak runs, and CI/staging automation.
4. **LLM Bridge**: Implemented as a practical one-seat websocket bridge for browser-vs-agent and agent-vs-agent workflows.
