# Delta-V Simulation Testing Strategy

Delta-V now has one established simulation layer and one still-planned layer:

- **Headless Engine Simulation (AI vs AI)** is implemented and runs in CI.
- **Network Integration Simulation (PvP Bot Stress Testing)** is still future work.

Since the core `engine/game-engine.ts` is purely functional and deterministic apart from injected RNG, high-speed simulation is practical.

---

## 1. Headless Engine Simulation (AI vs AI)

**Goal:** Run large batches of AI-vs-AI games quickly to test scenario balance, AI effectiveness, and find crash-inducing edge cases deep in the game tree. This is implemented in `scripts/simulate-ai.ts`.

**Approach:**
The current runner executes entirely in Node.js, outside the browser and Cloudflare Worker runtime.

1. **Setup:** Initialize `GameState` using `createGame(SCENARIOS[name], map, ...)`.
2. **Game Loop:** Put the engine in a `while (state.phase !== 'gameOver')` loop.
3. **Turn Execution:**
   - **Astrogation:** If it's Player 0's turn, call `aiAstrogation(state, 0, map, 'hard')`. Same for Player 1. Pass the orders into `processAstrogation()`.
   - **Ordnance:** Call `aiOrdnance()` and pass to `processOrdnance()` (or call `skipOrdnance()`).
   - **Combat:** Call `aiCombat()` and pass to `processCombat()` (or `skipCombat()`).
4. **Data Collection:** Track metrics like win rates (Player 0 vs Player 1), average turns to win, fuel consumed, and most common causes of death (combat vs crashes).

**Implementation Details:**
- Because the `game-engine.ts` has no DOM or Canvas dependencies, this runs very quickly in practice.
- You can run Monte Carlo simulations (e.g., 10,000 runs of the 'Escape' scenario) to definitively prove if the scenario favors the escaping player or the blockading player.
- **Randomness:** All engine entry points (`processAstrogation`, `processCombat`, `processOrdnance`, etc.) require a mandatory `rng: () => number` parameter — there are no `Math.random` fallbacks in the turn-resolution path. Passing a seeded RNG allows completely reproducible replays when a simulation encounters a crash or an infinite loop.

**Current usage:**
- `npm run simulate` runs 100 headless games of the default scenario.
- `npm run simulate all 25 -- --ci` runs 25 games per scenario across all 8 scenarios (pre-commit hook).
- `--ci` fails the process on engine crashes and prints balance warnings without making them fatal.

---

## 2. Network Integration Simulation (PvP Stress Testing)

**Goal:** Validate the Cloudflare Durable Object lifecycle, WebSocket handling, reconnection logic, and server scaling.

**Approach (planned):**
Create a headless WebSocket bot client using a library like `ws` in Node.js (e.g., `scripts/load-test.ts`).

1. **Lobby Creation:** The script makes an HTTP POST request to `/create` to get a 5-letter game code.
2. **Client Connections:** Spawn two separate WebSocket connections to the local Wrangler server (or the deployed Cloudflare staging environment) using that code.
3. **Bot Logic:** Instead of complex AI, these headless clients run a state machine listening to `S2C` messages:
   - On `gameStart` / `stateUpdate`: Automatically wait a random delay (50ms - 2000ms to simulate human think time) and then fire back a `C2S` message (astrogation, ordnance, combat).
   - Use the existing `aiAstrogation()` etc. functions to generate valid payloads, or intentionally generate invalid payloads to test server validation rejection.
4. **Stress Testing:** Spawn 100+ concurrent pairs of these bots to simulate 100 simultaneous active games, pushing the Durable Objects to their limits.
5. **Chaos Testing:** Intentionally drop WebSocket connections mid-turn on 10% of the bots and attempt to reconnect 15 seconds later, validating the grace-period disconnect logic.

---

## Summary of Progress

1. **RNG Injection**: Completed. All engine entry points require mandatory `rng` parameter for deterministic simulations.
2. **AI Runner**: Implemented. `npm run simulate` executes headless matches, and CI runs the multi-scenario `--ci` pass.
3. **Load Tester**: Planned for future infrastructure stress testing.
