# Simulation and Load Testing

Delta-V has three complementary simulation layers. Because the shared engine is side-effect-free and deterministic given an injected random-number generator, high-speed simulation is cheap and reproducible.

The three layers are: a headless engine that runs artificial-intelligence-versus-artificial-intelligence games, a network load and chaos harness that validates the server lifecycle and WebSocket handling, and a large-language-model agent bridge that lets external model-driven agents play real online matches.

---

## 1. Headless engine simulation

The goal of this layer is to run large batches of artificial-intelligence-versus-artificial-intelligence games to test balance and find crash edges deep in the game tree. It runs in Node with no browser or Worker runtime.

The loop shape is straightforward: create a game, then loop until the phase reaches game-over, calling the appropriate artificial-intelligence helper for the active phase — covering astrogation, ordnance, logistics, and combat — and passing each result to the matching engine entry point. All engine calls take a mandatory random seed, so a given seed reproduces the game exactly.

The main simulate command runs one hundred games of the default scenario by default. Passing "all" and a count with the continuous-integration flag runs all nine scenarios at that count, failing on engine crashes or rejected built-in actions while treating balance and objective warnings as non-fatal. A randomize-start flag forces per-game starting-player randomization. Bi-Planetary, Duel, Grand Tour, Interplanetary War, and Fleet Action auto-randomize the starting player so turn-order bias does not dominate short batches. Bi-Planetary also auto-swaps scenario sides in the simulator, so scorecards measure fairness under randomized live seat assignment rather than the deterministic route advantage of one named side. A separate duel-sweep command can also run scenario sweeps across many base seeds in one table, showing pacing and seat-balance variance before changing geometry, rules, or artificial-intelligence doctrine. Continuous integration balance warnings use per-scenario win-rate bands for decided games. Cooperative and race scenarios such as Grand Tour skip the normal balance gate, but objective policies can still emit non-fatal seat-skew warnings when a race resolves correctly yet remains grossly one-sided.

Every simulation result now includes a scorecard object in JSON output, with a compact scorecard printed in text mode. Treat the scorecard as the first stop for artificial-intelligence tuning reviews. It tracks objective share — games that resolved through the scenario's intended objective route, including decisive no-colonists-survive outcomes in passenger-rescue scenarios; fleet-elimination share — games that ended by deleting the opposing fleet; timeout share — draws or progress tiebreak timeouts; player-zero decided rate — decided-game seat balance when applicable; passenger delivery share — successful passenger deliveries for convoy- and evacuation-style scenarios; Grand Tour completion share — clean completions rather than attrition or timeout progress wins; invalid action share — built-in artificial-intelligence action rejections per game, where any non-zero value fails continuous integration; fuel stalls per game — active, fueled, stationary ships that coast instead of burning or landing; and average turns — a pacing signal, compared on paired seeds before and after a change. For artificial-intelligence pull requests, compare scorecards on paired seed sets rather than only quoting win rate. If a simulation exposes a bad state, prefer saving that state as a focused decision-class regression — for example "land to refuel", "preserve passenger carrier", or "do not coast while stalled" — over adding another global weight from one trace.

The capture-failures option writes bounded JSON snapshots for invalid built-in actions, fuel stalls, passenger-objective failures, passenger-transfer mistakes, and objective-scenario drift such as fleet-elimination resolutions. The default cap is five files; a separate option overrides it. A failure-kind option can focus the capture run on one symptom or a comma-separated set such as passenger-objective failure plus objective drift. Captures include the seed, scenario, active player, proposed action when relevant, stalled ship identifiers or passenger-transfer diagnostics when relevant, and the full game state. Combat captures include the chosen combat plan when one applies. Astrogation captures include named plan decisions for passenger, escort, interceptor, and refuel plans, including the chosen intent and the strongest rejected alternatives. To promote a capture, copy the JSON into a focused fixtures path and assert the decision class has changed.

Continuous integration, the verify script, and full pre-push all run the all-scenarios sweep at sixty games each. The default pre-push hook only runs a short smoke sweep when artificial-intelligence, agent, engine, scenario, or simulation files changed. The duel-sweep script runs the same duel harness across many base seeds in one table, showing pacing and seat balance variance before changing duel geometry or rules. Its options cover iteration count, a seed range, a comma-separated seed list, a scenario key, and JSON output.

---

## 2. Network load and chaos

The goal of this layer is to validate the Durable Object lifecycle, WebSocket handling, reconnection, and concurrency. It drives real rooms over HTTP with both seats operated by bots.

The loop shape: post to the create endpoint, open WebSocket connections for both seats using a bot-client helper, and on each state-bearing server-to-client message, have the active player think briefly and submit a valid client-to-server message drawn from the existing artificial-intelligence helpers. Chaos mode forces drops and reconnects using the stored player token.

The load-test command accepts a games count and a concurrency level. A disconnect-rate option, expressed as a fraction between zero and one, enables chaos mode. Running twelve games at four concurrent connections with a disconnect rate of one quarter exercises reconnection paths. If a local Wrangler database predates the latest schema, migrations should be applied before long runs.

The harness prints a per-match summary covering the result code, winner, turn count, duration, actions sent, and reconnect count, plus an aggregate summary covering completed and failed matches, reconnect success rate, server and socket errors, totals, and win reasons.

---

## 3. Language-model and agent bridge

The goal of this layer is to let external model-driven agents — large language models, custom planners, tool-using bots — play real online matches using the same room protocol as browser clients.

The bridge can create a new match and wait for an opponent, or join an existing room by code. Running two bridge processes covers model-versus-model end-to-end play. Full agent onboarding — including the choice between the Model Context Protocol and the bridge, the contract, a reliability checklist, and a tuning workflow — lives in the agents document. The per-turn payload shape is defined in the agent specification.

Typical uses: host a match with a standard-input-and-output agent and share the printed room code with a browser opponent; join an existing room code with an HTTP agent that accepts turn requests on a local port; or run a baseline match with the built-in policy and no external agent, which is useful for comparison.

If the agent's output is invalid, times out, or mismatches the current phase, the bridge falls back to the built-in policy, with a configurable difficulty level.
