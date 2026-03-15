# Delta-V Simulation Testing Strategy

To ensure game balance, test edge cases, and validate the stability of the Durable Objects backend, we can implement two distinct types of simulation testing: **Headless Engine Simulation (AI vs AI)** and **Network Integration Simulation (PvP Bot Stress Testing)**.

Since the core `game-engine.ts` is purely functional and deterministic, creating high-speed simulations is extremely feasible.

---

## 1. Headless Engine Simulation (AI vs AI)

**Goal:** Run thousands of games in seconds to test scenario balance, AI effectiveness, and find crash-inducing edge cases deep in the game tree.

**Approach:**
Create a new Node script (e.g., `scripts/simulate-ai.ts`) that runs outside the browser and the Cloudflare Worker, executing purely in Node.js.

1. **Setup:** Initialize `GameState` using `createGame(SCENARIOS[name], map, ...)`.
2. **Game Loop:** Put the engine in a `while (state.phase !== 'gameOver')` loop.
3. **Turn Execution:**
   - **Astrogation:** If it's Player 0's turn, call `aiAstrogation(state, 0, map, 'hard')`. Same for Player 1. Pass the orders into `processAstrogation()`.
   - **Ordnance:** Call `aiOrdnance()` and pass to `processOrdnance()` (or call `skipOrdnance()`).
   - **Combat:** Call `aiCombat()` and pass to `processCombat()` (or `skipCombat()`).
4. **Data Collection:** Track metrics like win rates (Player 0 vs Player 1), average turns to win, fuel consumed, and most common causes of death (combat vs crashes).

**Implementation Details:**
- Because the `game-engine.ts` has no DOM or Canvas dependencies, this can run extraordinarily fast.
- You can run Monte Carlo simulations (e.g., 10,000 runs of the 'Escape' scenario) to definitively prove if the scenario favors the escaping player or the blockading player.
- **Randomness:** The combat engine relies on `Math.random()`. Passing a seeded random number generator (RNG) into `processCombat` and `processAstrogation` allows for completely reproducible replays when a simulation encounters a crash or an infinite loop.

---

## 2. Network Integration Simulation (PvP Stress Testing)

**Goal:** Validate the Cloudflare Durable Object lifecycle, WebSocket handling, reconnection logic, and server scaling.

**Approach:**
Create a headless WebSocket bot client using a library like `ws` in Node.js (e.g., `scripts/load-test.ts`).

1. **Lobby Creation:** The script makes an HTTP POST request to `/create` to get a 5-letter game code.
2. **Client Connections:** Spawn two separate WebSocket connections to the local Wrangler server (or the deployed Cloudflare staging environment) using that code.
3. **Bot Logic:** Instead of complex AI, these headless clients run a state machine listening to `S2C` messages:
   - On `gameStart` / `stateUpdate`: Automatically wait a random delay (50ms - 2000ms to simulate human think time) and then fire back a `C2S` message (astrogation, ordnance, combat).
   - Use the existing `aiAstrogation()` etc. functions to generate valid payloads, or intentionally generate invalid payloads to test server validation rejection.
4. **Stress Testing:** Spawn 100+ concurrent pairs of these bots to simulate 100 simultaneous active games, pushing the Durable Objects to their limits.
5. **Chaos Testing:** Intentionally drop WebSocket connections mid-turn on 10% of the bots and attempt to reconnect 15 seconds later, validating the grace-period disconnect logic.

---

## Summary of Next Steps for Implementation

1. **Extract RNG:** Ensure all calls to `Math.random()` in `combat.ts` and `movement.ts` can accept a custom seeded RNG function to make the simulation deterministic.
2. **Write the AI Runner:** Write the `simulate-ai.ts` loop, logging the result of the `while` loop to a CSV file.
3. **Write the Load Tester:** Build a simple WebSocket bot wrapper to hit the local `wrangler dev` environment.
