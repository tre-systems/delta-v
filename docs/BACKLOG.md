# Delta-V Backlog

Outstanding tasks that deserve a named home between PRs. Shipped work belongs in
`git log`, not here. Recurring review procedures live in
[REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in
[ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in
[EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

Sections are grouped by theme and ordered roughly by player impact. Entries with
only "done for this slice" history were removed in the 2026-04-24 cleanup.

## AI Evaluation & Heuristic Planning

The current AI backlog has repeatedly converged on the same failure mode: a
single bad simulation or playtest produces another local weight tweak. That is
fragile. The active AI work is grouped into three tracks:

- **Evaluation loop:** scenario scorecards, failure captures, and fixture
  regressions.
- **Reusable planning primitives:** bounded movement planning and ship-role
  assignment.
- **Scenario symptom queue:** player-facing balance/AI failures to validate
  through the first two tracks rather than one-off weight changes.

### Build Scenario Scorecards and a Failure-State Corpus (P1)

Win rate alone is too blunt for asymmetric objective scenarios. Each scenario
needs a small scorecard that captures the product behavior we actually care
about: objective-completion share, fleet-elimination share, average turns,
timeouts, invalid candidate count, fuel-stall count, passenger delivery share,
and seat balance where relevant. Simulation warnings should compare paired seed
sets against those scorecards so a PR can say whether it improved the scenario
instead of only whether one seed got lucky.

Bad simulation states should also become fixtures. When the harness sees a
fuel stall, invalid order, passenger transfer mistake, or objective drift, save
the `GameState` and add a decision-class regression such as "land to refuel",
"keep the viable passenger carrier", "do not coast while stalled", or "screen
the carrier instead of chasing attrition". Avoid exact burn assertions unless
the rules require them.

Action:
- Extend `scripts/simulate-ai.ts` with additional objective/failure counters as
  new recurring failure modes appear.
- Grow the fixture path into a broader corpus of decision-class regressions as
  the harness captures new recurring failures.

**Files:** `scripts/simulate-ai.ts`, `scripts/duel-seed-sweep.ts`,
`src/shared/simulate-ai-policy.test.ts`, `src/shared/ai.test.ts`,
`docs/SIMULATION_TESTING.md`

### Add a Bounded Engine Planner for Movement Objectives (P1)

Grand Tour, evacuation, convoy, and blockade all depend on movement planning
under fuel, velocity, gravity, and landing constraints. The current scorer uses
many scalar distance/fuel bonuses where a small bounded planner would provide a
better signal without replacing the whole AI.

Action: grow the reusable short-horizon planner over `computeCourse` so it can
score "can reach safe refuel / objective / landing line within N turns" and
return a cost-to-go. Feed that cost into checkpoint/refuel ranking more
directly, then passenger arrival decisions, where it can replace several ad hoc
fuel and landing bonuses.

**Files:** `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/movement.ts`, `src/shared/ai.test.ts`

### Separate Ship Roles Before Tactical Scoring (P1)

Generic combat, objective, fuel, and landing scores still fight each other in
escort scenarios. A cheap role pass would make the scoring simpler and more
stable: assign each ship a turn-local role such as `carrier`, `escort`,
`interceptor`, `refuel`, `race`, or `screen`, then let the role choose a smaller
set of priorities.

Action: expand the lightweight role assignment step for AI phases that need
coordination. Reuse the same idea for Grand Tour race/refuel decisions if it
proves useful.

**Files:** `src/shared/ai/logistics.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/ai/scoring.ts`

### Scenario Symptoms to Validate With the New Loop (P1)

These are still real player-facing AI issues, but they should be handled through
the scorecard / fixture / planner workflow above rather than one-off weight
changes:

- **Passenger scenarios:** convoy and evacuation still resolve too often by
  elimination. Passenger-carrier doctrine should rank arrival odds and survival
  of a viable destination runner above hull quality or generic combat value.
  The 2026-04-24 `all 30 --ci` sweep showed convoy objective share 20% with
  `P0 decided rate 75.9%` warning, and evacuation objective share 50% with
  average turns 3.2 (still too short to reach Terra meaningfully).
- **Biplanetary:** the same 2026-04-24 sweep resolved **100% of 30 hard-vs-hard
  games by fleet elimination** (`objective resolutions 0.0% below 5%` and
  `fleet-elimination share 100.0% above 90%` warnings). The landing objective
  is unreachable under current AI doctrine — this is a new symptom for the
  scorecard loop, not a weight tweak.
- **Grand Tour:** the 2026-04-24 refuel-navigation pass improved focused
  `grandTour 60 -- --ci --seed 1` from `0/60` P0 to `18/60`, but the sample
  still warns at `30.0%` P0 and has too many fleet-elimination resolutions.
- **Evacuation:** the scenario is still too short and too attrition-heavy; the
  target metric is objective share, not just seat balance.
- **FleetAction / InterplanetaryWar fuel stalls:** the 2026-04-24 sweep
  recorded `Fuel Stalls/Game` of **72.1** (fleetAction) and **110.3**
  (interplanetaryWar) at hard-vs-hard. That is an order of magnitude worse
  than convoy (19.3) or duel (2.8). Fleet-scale scenarios have fueled ships
  coasting instead of burning — good target for the bounded engine planner
  once it extends past Grand Tour refuel recovery.
- **FleetAction:** recent large samples are close to acceptable, but keep
  watching timeout rate and P0 blowout risk on broader seeded sweeps. The
  2026-04-24 sweep showed `timeoutShare 13.3%` at 30 games.
- **Difficulty tiers:** Easy/Normal/Hard now differ more than before. Only widen
  Hard-vs-Normal again if real playtesting still says the tiers feel too similar.
- **Ordnance thresholds:** impossible-shot and nuke/torpedo regressions are now
  covered. Tune remaining hard-tier threshold rows only when scorecards or
  sweeps show over-firing.

**Files:** `src/shared/ai/`, `src/shared/scenario-definitions.ts`,
`src/shared/engine/victory.ts`, `scripts/simulate-ai.ts`,
`scripts/duel-seed-sweep.ts`

## Gameplay UX & Matchmaking

The remaining gameplay UX items group into digital-input parity and WebSocket
protocol diagnostics.

### Verify Same-Token WebSocket Replacement (P2)

The 2026-04-24 multiplayer deep probe exercised `POST /create`,
`GET /join/{CODE}`, `POST /quick-match`, the paired WebSocket flow, spectator
attach, mid-match disconnect/reconnect, and rate limits. Core flows work —
seat assignment, reconnect by stored `playerToken`, typed WebSocket rejection
frames, rate-limit close (1008 with reason), matchmaker pairing, and idempotent
same-player tickets. HTTP validation and URL diagnostics have shipped; the
remaining gap is replacement behavior for duplicate same-seat sockets.

Concrete issues observed on the local dev server:

- **Verify behaviour of a second WebSocket with the same `playerToken`.**
  Server code at [game-do.ts:178-184](../src/server/game-do/game-do.ts) calls
  `old.close(1000, 'Replaced by new connection')` when a same-seat socket
  replaces an existing one. In the 2026-04-24 local dev probe, a second
  node-side `undici` socket connected without the old socket seeing any
  close event over 10 s (HOST1 remained `readyState: OPEN` but received no
  further broadcasts). This may be a `wrangler dev` hibernation-API quirk,
  an `undici` quirk, or a real prod regression — triangulate against
  deployed production before acting. If reproducible in prod, it leaks
  zombie sockets per tab-switch until the client hits a rate-limit close.

Found via EXPLORATORY_TESTING.md R5 / R8 / R9 applied to the multiplayer
surface with a purpose-built WebSocket harness. A reusable
`scripts/mp-connectivity.mjs` harness would keep this probe close to hand for
future passes.

**Files:** [src/server/game-do/fetch.ts](../src/server/game-do/fetch.ts),
[src/server/game-do/http-handlers.ts](../src/server/game-do/http-handlers.ts),
[src/server/protocol.ts](../src/server/protocol.ts),
[src/server/game-do/actions.ts](../src/server/game-do/actions.ts),
[src/shared/types/domain.ts](../src/shared/types/domain.ts) (ErrorCode enum)

### Small Accessibility Polish (P3)

The 2026-04-24 a11y re-audit (axe 8/8, manual sweep at 375 × 812) passed
the baseline. Future accessibility work should stay limited to small,
low-risk fixes that preserve the game's feel and visual language. Full
keyboard tactical play on the canvas board remains explicitly out of scope
per [A11Y.md § Scope](./A11Y.md#scope), and broader reduced-motion or HUD-scale
UI changes should wait for a specific player need rather than being pursued as
generic compliance work.

Candidate small fixes:
- Keep modal keyboard behavior tidy as new overlays are added.
- Preserve clear focus rings and accessible names on new controls.
- Add focused axe/manual checks when touching menu, HUD, help, game-over, or
  reconnect surfaces.

**Files:** [static/index.html](../static/index.html),
[static/styles/base.css](../static/styles/base.css),
[src/client/ui/overlay-view.ts](../src/client/ui/overlay-view.ts),
[src/client/ui/hud-chrome-view.ts](../src/client/ui/hud-chrome-view.ts)
(pattern reference), [e2e/a11y.spec.ts](../e2e/a11y.spec.ts)

### Finish Digital-Input Parity for Pointer-First Tactical Picks (P2)

Combat target cycling, attacker cycling, and standard gamepad paths have shipped.
The remaining gap is any tactical pick that still requires pointer interaction
instead of keyboard/gamepad navigation.

Action: audit astrogation, ordnance, logistics, and ship/hex selection for
pointer-only choices and add digital command paths where a player can otherwise
get stuck without a mouse.

**Files:** `src/client/game-client-browser.ts`,
`src/client/game/client-runtime.ts`, `src/client/game/input-events.ts`,
`src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud.ts`

## Cost & Abuse Hardening

### Cap Concurrent WebSocket Sockets Per IP (P2)

The existing rate limits protect **new-connection rate** but nothing caps
**steady-state** resource use per IP. `WS_CONNECT_LIMIT = 20 / 60 s`
([src/server/reporting.ts:74-75](../src/server/reporting.ts)) lets one IP
open 20 new WebSockets per minute. Nothing reaps the accumulating set of
open sockets, and a client that sends a message every 4 minutes keeps its
Durable Object under the `INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000` cliff
forever (see [src/shared/constants.ts:263](../src/shared/constants.ts)).

A patient attacker can therefore maintain **hundreds to low-thousands of
warm Durable Objects from one IP**, each billed for wall-clock + WebSocket
duration. Public `/create` already has a per-IP active-room cap; steady-state
WebSocket ownership still needs a cap.

Add:

- A per-IP concurrent-WebSocket count tracked in the per-isolate map (or a
  global KV/DO counter if we move there). Reject new WS handshakes with
  close code 1013 ("try again later") when the IP is over its cap
  (suggest 10 concurrent).
- A shorter `INACTIVITY_TIMEOUT_MS` when no opponent has joined (suggest
  60 s) — a solo seat holding a DO open for 5 minutes with no second
  player serves no purpose.

Also consider a monthly Cloudflare Workers/DO/R2/D1 billing alert
(dashboard-only, not code) so any attack that slips the above caps
surfaces before the invoice does.

**Files:** [src/server/index.ts](../src/server/index.ts) (WS handshake
path, lines 534–553), [src/server/reporting.ts](../src/server/reporting.ts)
(rate-limit state), [src/server/game-do/game-do.ts](../src/server/game-do/game-do.ts)
(`touchInactivity` logic around line 286),
[src/shared/constants.ts](../src/shared/constants.ts)

## Telemetry & Observability

### Add Remaining Discovery / Session-Quality Signals (P2)

The internal metrics endpoint, observability SQL recipes, discovery page views,
replay engagement events, and `scenario_selected` are shipped. The remaining
gaps are narrower:

- `leaderboard_row_clicked` once leaderboard rows become interactive.
- A connection-quality metric over a session, such as RTT or out-of-order frame
  counts, rather than only `ws_invalid_message`.

**Files:** `src/client/game/main-session-shell.ts`,
`src/client/game/replay-controller.ts`, `src/client/leaderboard/*.ts`,
`static/matches.html`, `static/leaderboard.html`, `src/server/metrics-route.ts`

## Architecture & Correctness

### Content-Hashed Client Asset URLs + Long-Lived Cache (P2)

`https://delta-v.tre.systems/client.js` today returns
`cache-control: public, max-age=0, must-revalidate` with a content-hash
etag, so every page visit revalidates the full client bundle even when the
contents haven't changed. Cloudflare HITs the edge cache but the browser still
makes the revalidation round-trip on every navigation, and on a cold cache
eviction the full body redownloads.

Switch to hashed URLs (e.g. `/client.<contenthash>.js`) emitted by esbuild
(`entryNames: "[name].[hash]"`) plus a `_headers` rule:

```
/client.*.js
  Cache-Control: public, max-age=31536000, immutable

/style.*.css
  Cache-Control: public, max-age=31536000, immutable
```

Index HTML (`/`, `/agents`, `/matches`, `/leaderboard`) stays
`must-revalidate` so a new deploy lands immediately. Returning visitors
then get zero bytes for the JS/CSS until the build hash changes. The
existing `copyStaticToDist` hash in `scripts/bundle-style-css.mjs` already
knows the cache-bust shape; extend it to rewrite the `<script src>` and
`<link rel="stylesheet">` tags in `index.html` / the three other shell
files to point at the hashed paths.

**Files:** [esbuild.client.mjs](../esbuild.client.mjs),
[scripts/bundle-style-css.mjs](../scripts/bundle-style-css.mjs),
[dist/_headers](../dist/_headers) (template lives in
[static/_headers](../static/_headers)),
[static/index.html](../static/index.html),
[static/agents.html](../static/agents.html),
[static/matches.html](../static/matches.html),
[static/leaderboard.html](../static/leaderboard.html)

### Measure Long-Game Memory Growth (P3)

Not done this pass — the 2026-04-24 review caught the bundle wins but
did not measure client heap growth over a 20–30 min match. The event-
source stream accumulates in replays and the renderer holds Canvas
buffers per turn animation; if either leaks, the browser's tab process
grows until a major GC or an OOM on mobile. One-hour action: start a
duel against AI Hard, take Chrome DevTools heap snapshots at 0 / 5 /
15 / 30 minutes, diff for growing retainers. Escalate only if the diff
shows unbounded growth; don't chase it if heap stays flat.

**Files:** first-hour measurement, no code changes unless findings
surface.

### Refresh (and Automate) the Audio-Book Rewrites (P2)

`docs/audio-rewritten/` holds hand-authored, TTS-friendly prose versions
of every canonical markdown chapter, consumed by
[scripts/build-audio-doc-book.mjs](../scripts/build-audio-doc-book.mjs)
to produce `docs/delta-v-documentation-book.audio.pdf`. The rewriter is
not a script — the folder was last populated in commit
[`ea7cb99 Refresh audio documentation book`](../docs/audio-rewritten/)
on **2026-04-21**. Every source doc updated after that (ARCHITECTURE,
SECURITY, PRIVACY_TECHNICAL, A11Y, REVIEW_PLAN, SPEC, BACKLOG, and
anything else touched in the 2026-04-24 sweep) is stale in the audio
edition. Re-running `npm run docs:book:audio` does not refresh the
prose — it re-renders the same 2026-04-21 text through Chromium with a
new build date.

Concrete work:

- Regenerate every audio-rewritten chapter whose source markdown is
  newer. The prose style is established — spell out acronyms (HTTP,
  SHA), replace code blocks / tables / file paths with plain-English
  descriptions, and keep section/chapter headings so the TTS
  navigation still tracks the main book.
- Stop shipping stale audio PDFs: add an
  `npm run docs:book:audio` guard that compares each source's `mtime`
  (or git blob hash) against the rewritten counterpart and refuses to
  build when any is stale, printing the list of chapters that need a
  new pass. The build script already loads chapters from the same
  `parts` config, so the check is small.
- Optional follow-up: a skeleton CLI (e.g. `scripts/refresh-audio.mjs`)
  that drops each source chapter into a prompt for a human or LLM
  pass, writes the output into `docs/audio-rewritten/<same-path>.md`,
  and records a metadata timestamp. Until that lands, the refresh
  stays a manual authorial step.

Until the refresh ships, the audio PDF's front matter /
`README.md § Compiled book editions` should flag that the audio edition
may lag the main book by a few days after each doc sweep.

**Files:** [scripts/build-audio-doc-book.mjs](../scripts/build-audio-doc-book.mjs),
[docs/audio-rewritten/](../docs/audio-rewritten/) (every chapter),
[README.md](../README.md) (compiled-book section)

### Optional Deduplication of Initial Publication Path (P3)

`initGameSession` already publishes via the same `GameDO.publishStateChange` to
`runPublicationPipeline` path as post-init actions, and RNG breach fallbacks now
use deterministic `mulberry32` streams. The remaining work is optional
deduplication only.

Action: if this area is touched again, consider whether `match.ts` should call
`runPublicationPipeline` without the `publishStateChange` indirection.

**Files:** `src/server/game-do/match.ts`,
`src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`

## Future Features

These items depend on product decisions or external triggers. They are not in
the active queue.

### WAF or Cloudflare `[[ratelimits]]` Binding for Join / Replay / Leaderboard Probes

**Trigger:** distributed scans wake Durable Objects or cost too much. The
2026-04-24 pass confirmed that `/join/{CODE}`, `/replay/{CODE}`,
`/api/leaderboard`, `/api/leaderboard/me`, and `/api/matches` use only the
per-isolate `joinProbeRateMap` / `replayProbeRateMap` fallback — the
`[[ratelimits]]` namespaces in wrangler.toml cover `/create`, `/telemetry`,
`/error`, `/mcp` only. A distributed scan cycling POPs therefore multiplies
the 100 / 60 s join-probe quota by the number of isolates hit.

Baseline per-isolate rate limiting is already shipped. Add WAF or
`[[ratelimits]]` when distributed activity on read paths becomes visible in
metrics, or proactively if a monthly billing alert fires.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Cloudflare Turnstile on Human Name Claim

**Trigger:** logs show bulk human name-claim POSTs, or the beta opens to a
larger audience.

Add Turnstile verification to `POST /api/claim-name` while preserving the
existing success path.

**Files:** `src/server/leaderboard/claim-route.ts`,
`src/server/auth/agent-token.ts` (for parity), new `src/server/auth/turnstile.ts`,
`static/index.html`, `src/client/`, `wrangler.toml`

### Populate Help Overlay Screenshots

**Trigger:** UI/UX is frozen enough that in-game screenshots will not go stale
in the next release cycle.

Replace the six `.help-screenshot` placeholder blocks with optimized screenshots
and alt text.

**Files:** `static/index.html`, `static/styles/overlays.css` (the six
`.help-screenshot` placeholder blocks live directly in `static/index.html`;
no dedicated `static/help/` directory is used yet)

### OpenClaw `SKILL.md` on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so OpenClaw agents can
auto-acquire Delta-V capability.

**Files:** external publish; skill body references remote MCP endpoint
