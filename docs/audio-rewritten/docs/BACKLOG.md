# Delta-V Backlog

Outstanding tasks that deserve a named home between pull requests. Shipped work lives in the git log rather than here. Recurring review procedures live in the review plan document. Architecture rationale lives in the architecture document. Exploratory-pass technique lives in the exploratory testing document.

Sections are grouped by theme and ordered roughly by player impact. Entries whose history was nothing more than "done for this slice" were removed in the late-April 2026 cleanup.

## Artificial intelligence evaluation and heuristic planning

The current artificial intelligence backlog has repeatedly converged on the same failure mode: a single bad simulation or playtest produces another local weight tweak. That is fragile. The active artificial intelligence work is grouped into three tracks: an evaluation loop covering scenario scorecards, failure captures, and fixture regressions; reusable planning primitives covering bounded movement planning and ship-role assignment; and a scenario-symptom queue of player-facing balance and artificial-intelligence failures that should be validated through the first two tracks rather than through one-off weight changes.

### Build scenario scorecards and a failure-state corpus

Win rate alone is too blunt for asymmetric objective scenarios. Each scenario needs a small scorecard that captures the product behavior we actually care about: objective completion share, fleet-elimination share, average turns, timeouts, invalid candidate count, fuel-stall count, passenger delivery share, and seat balance where relevant. Simulation warnings should compare paired seed sets against those scorecards so a pull request can say whether it improved the scenario rather than only whether one seed got lucky.

Bad simulation states should also become fixtures. When the harness sees a fuel stall, invalid order, passenger transfer mistake, or objective drift, save the game state and add a decision-class regression such as "land to refuel", "keep the viable passenger carrier", "do not coast while stalled", or "screen the carrier instead of chasing attrition". Avoid exact burn assertions unless the rules require them.

The action is to extend the simulation script with additional objective and failure counters as new recurring failure modes appear, and to grow the fixture path into a broader corpus of decision-class regressions as the harness captures new recurring failures.

### Add a bounded engine planner for movement objectives

Grand Tour, evacuation, convoy, and blockade all depend on movement planning under fuel, velocity, gravity, and landing constraints. The current scorer uses many scalar distance and fuel bonuses where a small bounded planner would provide a better signal without replacing the whole artificial intelligence.

The action is to grow the reusable short-horizon planner over the course-computation helper so it can score "can reach safe refuel, objective, or landing line within a few turns" and return a cost-to-go. Feed that cost into checkpoint and refuel ranking more directly, then into passenger-arrival decisions, where it can replace several ad hoc fuel and landing bonuses.

### Separate ship roles before tactical scoring

Generic combat, objective, fuel, and landing scores still fight each other in escort scenarios. A cheap role pass would make the scoring simpler and more stable: assign each ship a turn-local role such as carrier, escort, interceptor, refuel, race, or screen, then let the role choose a smaller set of priorities. Expand the lightweight role-assignment step for artificial-intelligence phases that need coordination, and reuse the same idea for Grand Tour race and refuel decisions if it proves useful.

### Scenario symptoms to validate with the new loop

These are still real player-facing artificial-intelligence issues, but they should be handled through the scorecard, fixture, and planner workflow rather than through one-off weight changes. Convoy and evacuation still resolve too often by elimination, so passenger-carrier doctrine should rank arrival odds and runner survival above generic combat value. The late-April 2026 thirty-game sweep showed convoy objective share at twenty percent with a seventy-six percent player-zero decided rate, and evacuation objective share at fifty percent with average turns of only 3.2 — too short to reach Terra meaningfully. In Biplanetary, that same sweep resolved one hundred percent of thirty hard-versus-hard games by fleet elimination, with the landing objective effectively unreachable under current artificial-intelligence doctrine. In Grand Tour, the late-April refuel-navigation pass improved focused sixty-seed samples from zero-for-sixty player-zero wins to eighteen-for-sixty, but the sample still warns at thirty percent and has too many fleet-elimination resolutions. Evacuation is still too short and too attrition-heavy; the target metric is objective share, not seat balance. Fleet Action and Interplanetary War showed fuel-stall rates per game of seventy-two-point-one and one-hundred-ten-point-three at hard-versus-hard — an order of magnitude worse than convoy at nineteen-point-three or duel at two-point-eight. Fleet-scale scenarios have fueled ships coasting instead of burning, which is a good target for the bounded engine planner once it extends past Grand Tour refuel recovery. Fleet Action's recent large samples are close to acceptable, but timeout rate and player-zero blowout risk should still be watched; the late-April sweep showed a timeout share of thirteen-point-three percent at thirty games. The easy, normal, and hard tiers now differ more than before; only widen the hard-versus-normal gap again if real playtesting says the tiers feel too similar. Impossible-shot and nuke-or-torpedo regressions are covered, so remaining hard-tier thresholds should only be tuned when scorecards or sweeps show overfiring.

## Gameplay user-experience and matchmaking

The remaining gameplay user-experience items group into digital-input parity and WebSocket protocol diagnostics.

### Verify same-token WebSocket replacement

The late-April 2026 multiplayer deep probe exercised the create, join, and quick-match routes, the paired WebSocket flow, spectator attach, mid-match disconnect and reconnect, and rate limits. Core flows work: seat assignment, reconnect by stored player token, typed WebSocket rejection frames, rate-limit close with a structured reason, matchmaker pairing, and idempotent same-player tickets. HTTP validation and URL diagnostics have shipped; the remaining gap is replacement behavior for duplicate same-seat sockets.

Specifically, when a second WebSocket connects with the same player token, the server code is meant to close the old socket with a "replaced by new connection" message. In the late-April local dev probe, the old socket never saw a close event over a ten-second window while still reporting an open ready state. This may be a Wrangler dev hibernation quirk, an underlying HTTP-library quirk, or a real production regression — it should be triangulated against deployed production before acting. If reproducible in production, it leaks zombie sockets per tab-switch until the client hits a rate-limit close. A reusable connectivity-harness script would keep this probe close to hand for future passes.

### Small accessibility polish

The late-April accessibility reaudit, including an axe pass and a manual sweep at phone viewport size, passed the baseline. Future accessibility work should stay limited to small, low-risk fixes that preserve the game's feel and visual language. Full keyboard tactical play on the canvas board remains explicitly out of scope per the accessibility scope document, and broader reduced-motion or heads-up display scale changes should wait for a specific player need rather than being pursued as generic compliance work. Candidate small fixes include keeping modal keyboard behavior tidy as new overlays are added, preserving clear focus rings and accessible names on new controls, and adding focused axe and manual checks when touching menu, heads-up display, help, game-over, or reconnect surfaces.

### Finish digital-input parity for pointer-first tactical picks

Combat target cycling, attacker cycling, and standard gamepad paths have shipped. The remaining gap is any tactical pick that still requires pointer interaction rather than keyboard or gamepad navigation. The action is to audit astrogation, ordnance, logistics, and ship or hex selection for pointer-only choices and add digital command paths where a player can otherwise get stuck without a mouse.

## Cost and abuse hardening

### Close the connecting-IP spoofing bypass

The server currently reads the connecting client IP from the Cloudflare connecting-IP header without sanity-checking that the request actually originated through Cloudflare. An attacker hitting the Worker directly, or a misconfigured environment where the header is accepted from untrusted upstreams, can rotate that header on every request and silently bypass every hashed-IP throttle. The fix is to verify the request arrived through the trusted Cloudflare front door, reject spoofed headers, and fall back to a stable per-connection identifier otherwise. This is the highest-priority hardening item on the backlog.

### Tighten the hosted Model Context Protocol input schema

The hosted Model Context Protocol endpoint accepts JSON-RPC input at the Cloudflare edge. Several tool handlers still accept loose shapes that overlap with optional fields — for example, shared compatibility aliases between match token and session identifier. A tighter schema at the entry point would reject malformed tool calls before they reach in-Worker logic, reduce the blast radius of any future handler bug, and produce cleaner error telemetry.

### Cap concurrent WebSocket sockets per IP

The existing rate limits protect the new-connection rate but nothing caps steady-state resource use per salted hashed IP. The WebSocket connect limit lets one client open twenty new sockets per minute. Nothing reaps the accumulating set of open sockets, and a client that sends a message every four minutes keeps its Durable Object under the five-minute inactivity timeout cliff forever. A patient attacker can therefore maintain hundreds to low thousands of warm Durable Objects from one IP, each billed for wall-clock and WebSocket duration. The public create route already has a per-IP active-room cap; steady-state WebSocket ownership still needs a cap. Recommended additions are a per-IP concurrent-WebSocket count with a suggested cap near ten, rejecting new handshakes with a "try again later" close code when over the cap, and a shorter inactivity timeout — perhaps sixty seconds — when no opponent has joined, since a solo seat holding a Durable Object open for five minutes with no second player serves no purpose. A monthly billing alert for Workers, Durable Objects, object storage, and the database would also surface any slipped attack before the invoice does.

### Add a hashed-URL cache for client assets

The production client bundle returns a cache-control header that forces revalidation on every page visit even when the content hash has not changed. Cloudflare hits the edge cache, but the browser still makes a revalidation round-trip on every navigation, and on a cold cache eviction the full body redownloads. The fix is to switch to content-hashed URLs emitted by the bundler, paired with an immutable long-lived cache header for the hashed files, while the index HTML stays revalidate-on-every-load so a new deploy lands immediately. Returning visitors then receive zero bytes for the JavaScript and style assets until the build hash changes. The existing static-copy hash in the style bundle step already knows the cache-bust shape and can be extended to rewrite the script and stylesheet tags in each shell HTML file to point at hashed paths.

### Extend Forget-my-callsign scope to include the anonymous identifier

The lobby's Forget-my-callsign button clears the locally stored token bundle and player profile but does not rotate the stable anonymous telemetry identifier. New telemetry events after the reset still attach to the same anonymous identifier that linked every previous callsign and session from the device. A maintainer with database read access could correlate pre-forget and post-forget activity. Two options: document the scope limit explicitly in the privacy document so users and operators know that Forget does not break the telemetry link, or rotate the anonymous identifier when the reset fires so the resolver mints a fresh one on next call. Implementation is the honest option; the doc-only fix is acceptable if we want to keep long-term telemetry continuity more than forgettability.

### Scrub engine-error stack traces before the database persist

The server telemetry path writes a code, phase, turn, message, and stack for every engine error into the thirty-day-retained events table. Stack traces are typically file and function paths only, but thrown error messages can capture value literals — any engine error whose message is constructed from user-reachable input leaks that string into the retained table. Current code does not obviously construct error messages from user-typed strings, but a single upstream template-interpolated error could slip through. The action is to audit the thrown-error surface for template interpolation of client-supplied strings and either replace with structured codes or truncate the message and stack fields at safe bounds — perhaps one kilobyte each — before persist. Low likelihood of active exposure; bundle with the next authentication or validation pass rather than shipping as a standalone task.

### Scheduled dependency audit and automated dependency pull requests

Continuous integration runs the package install but never runs the audit command, and there is no Dependabot or Renovate configuration. The late-April dependency review caught two advisories manually; the next one lands silently unless someone reruns the audit. Two low-cost options: add a weekly scheduled audit workflow that opens an issue on any high-severity advisory, or enable Dependabot with a small open-pull-request limit and grouped patch updates. Scope this once one of the two existing advisories resurfaces or the production runtime picks up a new direct dependency.

## Telemetry and observability

### Remaining discovery and session-quality signals

The internal metrics endpoint, observability query recipes, discovery page views, replay engagement events, and scenario-selected telemetry are shipped. The remaining gaps are narrower: a leaderboard-row-clicked event once leaderboard rows become interactive, and a connection-quality metric over a session — such as round-trip time or out-of-order frame counts — rather than only a single invalid-message event.

## Architecture and correctness

### Refresh and automate the audio-book rewrites

The audio-rewritten folder holds hand-authored, text-to-speech-friendly prose versions of every canonical documentation chapter. The rewriter is not a script; the folder was last bulk-refreshed a few days before the late-April sweep. Every source document updated after that is stale in the audio edition, and rerunning the audio-book build command does not refresh the prose — it only rerenders the same text through headless Chromium with a new build date. Concrete work: regenerate every audio-rewritten chapter whose source markdown is newer, and stop shipping stale audio PDFs by adding a guard on the build command that compares each source's modification time or git blob hash against its rewritten counterpart and refuses to build when any is stale, printing the list of chapters that need a new pass. An optional follow-up is a skeleton command-line tool that drops each source chapter into a prompt for a human or language-model pass, writes the output into the rewritten folder, and records a metadata timestamp. Until the refresh ships, the audio edition front matter and the main readme's compiled-book section should flag that the audio edition may lag the main book by a few days after each documentation sweep.

### Measure long-game memory growth

The late-April review caught the bundle wins but did not measure client heap growth over a twenty- to thirty-minute match. The event-source stream accumulates in replays and the renderer holds canvas buffers per turn animation; if either leaks, the browser's tab process grows until a major garbage collection or an out-of-memory kill on mobile. A one-hour action is to start a duel against hard artificial intelligence, take heap snapshots at zero, five, fifteen, and thirty minutes, and diff for growing retainers. Escalate only if the diff shows unbounded growth; do not chase it if heap stays flat.

### Optional deduplication of the initial publication path

New-game initialization already publishes through the same publication-pipeline path as post-init actions, and random-number-generator breach fallbacks now use deterministic streams. The remaining work is optional deduplication only: if this area is touched again, consider whether match initialization should call the publication pipeline directly without the state-change indirection.

## Future features

These items depend on product decisions or external triggers. They are not in the active queue. A web application firewall or additional edge rate-limit namespaces for the join, replay, and leaderboard probe paths would be added if distributed scans wake Durable Objects or cost too much; the late-April pass confirmed that these read paths use only the per-isolate fallback map, so a distributed scan cycling edge locations could multiply the nominal quota by the number of isolates hit. Cloudflare Turnstile on the human name-claim endpoint would be added if logs show bulk claim posts or the beta opens to a larger audience. Populating the help-overlay screenshots is pending a user-interface freeze so in-game captures will not go stale in the next release cycle. Finally, an OpenClaw skill document published on the external skill hub, gated on the agent-token environment variable, would let any OpenClaw agent auto-acquire Delta-V capability once the hosting platform is ready.
