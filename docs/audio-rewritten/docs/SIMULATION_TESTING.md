# Simulation and Load Testing

Delta-V has three complementary simulation layers. Because the shared engine is side-effect-free and deterministic given an injected random-number generator, high-speed simulation is cheap and reproducible.

The three layers are: a headless engine that runs AI versus AI games, a network load and chaos harness that validates the server lifecycle and WebSocket handling, and a large-language-model agent bridge that lets external model-driven agents play real online matches.

---

## 1. Headless engine simulation

**Goal.** Run large batches of AI-versus-AI games to test balance and find crash edges deep in the game tree. This layer runs in Node with no browser or web-worker runtime.

**Loop shape.** The simulation creates a game, then loops until the phase reaches game-over, calling the appropriate AI helper for the active phase — covering astrogation, ordnance, logistics, and combat — and passing each result to the matching engine entry point. All engine calls take a mandatory random seed, so a given seed reproduces the game exactly.

**Commands.** The main simulate command runs one hundred games of the default scenario by default. Passing "all" and a count with the continuous-integration flag runs all nine scenarios at that count, failing on engine crashes while treating balance warnings as non-fatal. A separate randomize-start flag forces per-game seat randomization; the duel, interplanetary-war, and fleet-action scenarios auto-randomize seats anyway so seat-order bias does not dominate short batches. A duel sweep command runs the duel harness across many base seeds in one table, showing pacing and seat-balance variance — useful before changing duel geometry or rules.

Continuous-integration and pre-commit hooks both run the full scenario suite at sixty games each. The manual verify command uses forty games to stay responsive for local invocation. If the iteration count changes, all three should be updated together.

The duel sweep accepts options for the number of iterations, a seed range, a comma-separated list of specific seeds, a scenario key, and a JSON output flag.

CI balance warnings use per-scenario win-rate bands for decided games. Cooperative and race scenarios such as Grand Tour are excluded from balance checks.

---

## 2. Network load and chaos

**Goal.** Validate the Durable Object lifecycle, WebSocket handling, reconnection, and concurrency. This layer drives real rooms over HTTP with both seats operated by bots.

**Loop shape.** The harness posts to the create endpoint, opens WebSocket connections for both seats using a bot-client helper, and on each state-bearing server-to-client message, the active player thinks briefly and submits a valid client-to-server message drawn from the existing AI helpers. Chaos mode forces drops and reconnects using the stored player token.

**Commands.** The load-test command accepts a games count and a concurrency level. A disconnect rate option, expressed as a fraction between zero and one, enables chaos mode. For example, running twelve games at four concurrent connections with a disconnect rate of twenty-five percent exercises reconnection paths.

**Local setup.** If a local Wrangler D1 database predates the latest schema, migrations should be applied before long runs.

**Reporting.** The harness prints a per-match summary covering the result code, winner, turn count, duration, actions sent, and reconnect count. It also prints an aggregate summary covering completed and failed matches, reconnect success rate, server and socket errors, totals, and win reasons.

---

## 3. LLM / agent bridge

**Goal.** Let external model-driven agents — large language models, custom planners, tool-using bots — play real online matches using the same room protocol as browser clients.

The bridge can create a new match and wait for an opponent, or join an existing room by code. Running two bridge processes covers large-language-model versus large-language-model end-to-end play.

Full agent onboarding — including the choice between the Model Context Protocol (MCP) and the bridge, the contract, a reliability checklist, and a tuning workflow — lives in the agents documentation. The per-turn payload shape is defined in the agent specification.

**Quick examples.** One typical use is hosting a match with a standard-input/standard-output agent and sharing the printed room code with a browser opponent. Another is joining an existing room code with an HTTP agent that accepts turn requests on a local port. A third is running a baseline match with the built-in policy and no external agent, which is useful for comparison.

If the agent's output is invalid, times out, or mismatches the current phase, the bridge falls back to the built-in policy, with a configurable difficulty level.
