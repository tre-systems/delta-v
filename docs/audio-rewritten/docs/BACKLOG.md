# Delta-V Backlog

A prioritised list of outstanding tasks that deserve a named home between pull requests — design gaps, tuning work, hardening items, and doc-versus-reality drift. Each entry is either actionable in the next few weeks or explicitly gated on a trigger.

Sections are grouped by theme and ordered by priority within each group. Gameplay-feel items translate most directly into a better player experience; architecture-solidity items unblock confident iteration on them. Shipped work lives in the repository's commit log rather than here; recurring review procedures live in the review plan document; architecture rationale lives in the architecture document; exploratory-pass technique lives in the exploratory testing document.

## Recently shipped

As of mid-April 2026, a large batch of quality, accessibility, and agent-infrastructure work has landed on the main branch. The hosted Model Context Protocol now lives in its own workspace package, the server-side bot for agent seats defaults to the normal difficulty level used everywhere else, and the scenario tiles, focus rings, and phase banner have all been polished. A notification policy module now orders toasts, phase alerts, and the heads-up display status line by precedence and dedupes repeat toasts. Prefer-more-contrast and forced-colors passes landed across the menu shell, heads-up display, overlays, and game-over screen. The help overlay accessibility bugs around aria-hidden and the fleet-status label are fixed, and the waiting-screen game code gets read by assistive tech when it updates.

Security hardening: the hosted Model Context Protocol endpoint now enforces a sixteen-kilobyte JSON body cap and a per-agent-token rate limit, the agent-token secret fails closed in production instead of falling back to a placeholder, match-token redemption requires a bearer header, and quick-match enqueues with an agent-prefixed player key require a verified agent bearer so the "is agent" leaderboard flag cannot be spoofed by prefix alone. The public leaderboard itself — Glicko-2, no login, humans and agents on one ladder — is live, with claim endpoints, a provisional-hiding rule, and idempotent per-match rating writes.

---

## Gameplay UX and matchmaking integrity

A handful of open UX items remain after the April 2026 batch.

Form controls still need a finer-grained split between mouse-focus and keyboard-focus styling. A quantified contrast audit — executed each release and then tuning the stylesheets from the measured results — is still outstanding. Stronger high-contrast mode coverage is partial: the help overlay's reused menu-content selectors on screens beyond the main menu still need a spot-check, and any game-over chrome outside the hero title may still read as flat in the strictest forced-colors themes.

The tutorial still needs a deeper task-first flow with spotlight-driven steps and a repeatable "what do I do now" affordance; the help overlay could optionally highlight the section in view on scroll, or collapse long groups into expandable blocks. Notification precedence is partly enforced in code via helpers, but call-site audits for duplicate copy between the heads-up display status line, the game log, and toasts are still open.

Core map interactions remain pointer-first: keyboard-first targeting and selection flows still need design and implementation so that gamepad support can reuse the same command path. Burn-arrow tap targets resolve per hex cell rather than only the painted circle, which usually gives at least forty-eight pixels at default zoom but can shrink on very small viewports — worth revisiting only if playtesting reports missed taps.

---

## Artificial intelligence behavior and rules conformance

Findings from a deep-research pass against the 2018 Triplanetary rulebook, combined with observations of the artificial intelligence's ordnance behavior.

The ordnance artificial intelligence currently gates launches on distance buckets but never verifies that the launch vector will actually intersect a target hex within the five-turn ordnance lifetime, accounting for gravity. A short forward simulation that scores candidate launch burns by intersection probability is needed before a launch commits.

The recommended-index output can over-suggest consecutive ordnance launches. After a torpedo on turn two, the ordnance-phase recommendation on turn three may point at a nuke without the enemy being in range or being a credible threat. The hard-difficulty nuke gate also misses three factors — the three-hundred-MegaCredit cost of a nuke, the fact that it can be shot down at two-to-one odds with full range and velocity modifiers, and its tendency to detonate on any friendly ship, base, asteroid, mine, or torpedo in the path. An expected-damage estimate netted out against anti-nuke intercept odds, plus exclusion of friendly-lane vectors, should gate hard-difficulty launches.

Four subtle rules should be audited against the rulebook for drift: range is the attacker's closest approach rather than range to final position alone; the velocity penalty applies only when the difference exceeds two hexes; each ship may release only one ordnance item per turn; and only warships may launch torpedoes.

The mine-launcher gate should verify that the resulting course actually leaves the mine's own hex, not just that a burn was declared, to avoid self-destruction. Finally, the research pass produced concrete geometries where the hard-difficulty artificial intelligence still launches despite no credible five-turn intercept window — these should be encoded as deterministic test fixtures before any further heuristic tuning.

---

## Agent and Model Context Protocol ergonomics

The agent contract is strong, with a pre-computed candidates array, labelled observations, two-token authentication, and action-guards forgiveness, but the Model Context Protocol surface has grown in two places and some per-turn affordances still cost extra round-trips.

Parallel stdio tool calls currently serialize: two quick-match connect calls sent in a single message do not run in parallel because the blocking long-poll runs to timeout before the second call queues. The fix is to keep long-poll waits off the stdio critical path.

First-touch errors on quick-match connect are rough. Passing a WebSocket URL throws a bare fetch-failed error from the underlying HTTP library; the normalization helper should either map WebSocket schemes to HTTP or reject with a clear message. Quick-match timeouts give no hint about the underlying cause — under development mode especially, a "no opponent queued" hint would be actionable.

The send-action tool's wait-for-result mode should treat protocol error events as rejections consistently. Today, sending an unknown action type resolves only after a separate event poll; the two paths should collapse to a single resolved rejection in both cases.

The disabled bot-fill path in the matchmaker Durable Object could be gated behind the development-mode flag so a single client can drive an end-to-end match locally without a second process.

The bot's nine-hundred-millisecond silence threshold is too aggressive for language-model agents with longer reasoning budgets. A longer default or a per-session configurable budget is needed.

The local and hosted Model Context Protocol tool surfaces diverge — the stdio server exposes list-sessions, get-events, and close-session helpers that the hosted server does not. Picking one name for quick-match and porting session buffering to the hosted side is the higher-value direction.

The wait-for-turn tool should return the full observation payload so a turn collapses to one blocking call plus one action call. The local stdio server's silent compaction of the state field should be gated behind an explicit opt-in.

The astrogation contract is inconsistent across surfaces: some describe it as simultaneous or pre-submittable while others gate on active player. A single model should flow through the engine, wait-for-turn, action guards, playbook JSON, and skill documentation.

The scrimmage script currently uses scrim-prefixed player keys, exercising the human quick-match path rather than the verified-agent flow that production agents use. Switching scrimmage defaults to agent identities and token issuance keeps the evaluation harness representative.

Model Context Protocol resources — universal-resource-identifier-style read-only data for rules and replays — are listed as a near-term resource surface but none are served yet. Serving the rules and replay resources would let hosts cache them and skip repeated HTTP fetches.

Action-rejection reasons should become a structured discriminated union rather than free-form strings. The smart-forgiveness path — where a stale phase is forgiven because the action type is still valid — should surface as its own reason.

When the thirty-second decision timeout fires and the server plays the recommended index on the agent's behalf, the agent is never told. A one-shot last-turn-auto-played field on the next observation would let agents notice missed turns and shrink their thinking budget.

A pre-release agent smoke checklist should land in the manual test plan: queue an agent against each difficulty for a small number of games, confirm at least ninety-five percent action acceptance, zero parse errors, under five percent decision-timeout rate, and that the six-agent harness finishes three concurrent matches without Durable Object instability.

The play skill has no mention of the coach-directive field even though observations surface it; add a short section on reading the directive each turn. The skill should also commit to one Model Context Protocol surface rather than referencing both.

Finally, once all active agents have migrated to match tokens, the legacy code-and-player-token tool-arg path can be retired from the hosted adapter.

---

## Cost and abuse hardening

The current baseline is documented in the security document: hashed-IP GET throttles on the join and replay paths, a WebSocket upgrade cap, per-socket message rate limits, a chat throttle, caps on the telemetry and error POSTs, authoritative room creation, the Model Context Protocol two-token model, fail-closed behavior on the agent-token secret in production, and the thirty-day retention purge for the events table.

The items still on the backlog are trigger-gated: a Web Application Firewall or additional rate-limit namespaces if the baseline throttles prove insufficient; Turnstile on the human name-claim endpoint; proof-of-work on bulk agent name claims; and a spectator delay for serious competition.

---

## Architecture and correctness

Several items remain on the architecture backlog. The initial publication path for new games should route through the same publication pipeline as every other state change so the random-number-generator fallbacks can be removed. Reinforcement and fleet-conversion side effects during turn advancement should become fully replayable by emitting explicit turn-advance events or by sharing one mutation implementation between the live engine and the event projector.

Caching of the current-state projection is partial — the checkpoint cleanup is done, but the live projection still rebuilds current state on every wake or read. An in-memory cache invalidated on every event append would close the gap. Publication and broadcast safety rails could be improved by replacing coarse JSON-string parity failures with structured diffs, converging normalization between production and tests, making lower-level broadcast helpers private, and adding an exhaustive server-to-client builder and broadcast check. Boundary hardening should hide clone-sensitive engine mutators behind non-exported modules, extend import-boundary enforcement, and finish the client-kernel dependency-injection cleanup so WebSocket and fetch are injected rather than reached directly.

---

## Type safety and scenario definitions

Several stringly-typed registries and identifiers still need to be closed off, with type guards for hex keys, tighter scenario and body registries, and branded ship and ordnance identifiers for lookup-heavy paths.

Scenario definitions and map data should be validated at load time and at game-creation time: conflicting rule combinations, unknown bodies, invalid spawn hexes, overlapping bodies, unreachable bases, and bounds that should be derived from body placement rather than from hardcoded constants.

Standardized error surfaces with a single engine-failure helper everywhere, combined with typed rate-limit and validation handling in the client, would allow user-facing error behavior to branch on error code rather than parsed text.

---

## Testing and client consistency

Property tests for ordnance launch duplication, phase gating, and logistics transfer validation have shipped. What remains is positive client-to-server fixtures for the edge combat and combat-single messages, and negative-fixture protocol coverage for malformed payloads.

---

## Future features, not currently planned

These items depend on product decisions or external triggers and are not in the active queue.

Public matchmaking with longer room identifiers would be added if the product moves beyond shared short codes. A trusted HTML sanitizer would be needed if chat, player names, or modded scenarios ever render as HTML. Web Application Firewall or additional rate-limit namespaces on join and replay probes would be added if distributed scans wake Durable Objects or cost too much. Cloudflare Turnstile on the human name-claim endpoint would be added if bulk claim POSTs appear in the logs or if the beta opens to a larger audience. Proof-of-work on the first agent name claim is symmetric in spirit: a few seconds of agent CPU on the first claim, painful at bulk. A spectator delay for organized competitive play would be added if real-time spectator leakage becomes a meaningful competitive risk. Populating the help-overlay screenshots is pending a UI freeze so in-game captures will not go stale in the next release cycle. Finally, an OpenClaw skill document published on the skill hub, gated on the agent-token environment variable, would let any OpenClaw agent auto-acquire Delta-V capability once the hosting platform is ready.
