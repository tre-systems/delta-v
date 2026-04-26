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

Current concurrent work should stay split into two streams so both can branch
from `main` without touching the same files:

- **Stream 1 — AI evaluation and failure corpus.** Own the simulation harness,
  seed-sweep reporting, scorecard policy tests, promoted failure fixtures, and
  simulation docs. Do not change AI behavior in this stream. Files:
  `scripts/simulate-ai.ts`, `scripts/duel-seed-sweep.ts`,
  `src/shared/simulate-ai-policy.test.ts`, `src/shared/ai/__fixtures__/`, and
  `docs/SIMULATION_TESTING.md`.
- **Stream 2 — AI planner and role behavior.** Own planner/heuristic changes
  and behavior-focused AI tests. Consume Stream 1's paired-seed scorecards
  before and after changes, but avoid editing the harness while Stream 1 is
  active. Files: `src/shared/ai/common.ts`,
  `src/shared/ai/astrogation.ts`, `src/shared/ai/logistics.ts`,
  `src/shared/ai/scoring.ts`, and targeted behavior tests in
  `src/shared/ai.test.ts`.

The integration point is evidence, not shared code: Stream 2 should land with
paired-seed scorecard output from Stream 1's harness showing objective,
elimination, timeout, fuel-stall, and passenger-delivery impact.

### Promote Captured Failure States into Fixtures (P1, ongoing)

The scorecard / seed-sweep / failure-capture / capture-manifest plumbing has
shipped. The recurring work is to keep promoting captured `GameState`
snapshots into decision-class regressions in
[src/shared/ai/__fixtures__/](../src/shared/ai/__fixtures__/) when a
particular bad decision appears repeatedly across seeds — "land to refuel",
"keep the viable passenger carrier", "do not coast while stalled", "screen
the carrier instead of chasing attrition", etc. Avoid exact burn assertions
unless the rules require them. Fixture-backed behaviour assertions should
land with the Stream 2 AI fix that makes the bad decision unrepresentable.

Add a new failure counter only when the current scorecard / capture
manifest genuinely misses a recurring symptom; pure tuning belongs in
existing counters.

**Files:** `src/shared/ai/__fixtures__/`,
`src/shared/simulate-ai-policy.test.ts` (gates), `docs/SIMULATION_TESTING.md`
(when adding a counter).

### Add a Bounded Engine Planner for Movement Objectives (P1)

Grand Tour, evacuation, convoy, and blockade all depend on movement planning
under fuel, velocity, gravity, and landing constraints. The current scorer uses
many scalar distance/fuel bonuses where a small bounded planner would provide a
better signal without replacing the whole AI.

Already plumbed via [planShortHorizonMovementToHex](../src/shared/ai/common.ts):
refuel base reachability ([findReachableRefuelBase](../src/shared/ai/common.ts)),
passenger arrival odds ([scorePassengerArrivalOdds](../src/shared/ai/logistics.ts)),
and the burn-vs-coast gate that drove fleet-scale fuel stalls (drift bonus
gated to "fuel tight, drift closes the gap, or genuinely nothing to do" plus
a stall penalty for stationary fueled ships ignoring engagements).

Still to do: score the *cost-to-go* (turns × fuel) for the next checkpoint
so Grand Tour ships pre-emptively detour to refuel rather than committing
to a checkpoint they can't reach with current fuel + velocity. The seed-1
Grand Tour `28.3% P0` decided rate hasn't moved despite the refuel work —
this is the next planner extension to attempt.

**Files:** `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/ai/scoring.ts`, `src/shared/ai.test.ts`

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

- **Passenger scenarios:** evacuation now resolves more by objective on
  `--seed 1` (56.7% delivery, 43.3% fleet elim at 60 games as of
  2026-04-26) but the average game still ends in 2-3 turns — the carrier
  reaches Terra fast when nothing intercepts and dies fast when
  something does. Convoy is still flat at ~20% objective share with most
  games ending in attrition. Passenger-carrier doctrine should rank
  arrival odds (now planner-aware) and survival of a viable destination
  runner above hull quality or generic combat value.
- **Biplanetary:** the 2026-04-24 sweep resolved **100% of 30 hard-vs-hard
  games by fleet elimination**. Re-run on 2026-04-26 (`biplanetary 30 --ci
  --seed 1`) showed 90% fleet-elim with 10% landings — directionally
  better but still well short of an objective-driven scenario. The
  landing objective is largely unreachable under current AI doctrine
  outside the rare seed where one side commits.
- **Grand Tour:** the 2026-04-24 refuel-navigation pass improved focused
  `grandTour 60 -- --ci --seed 1` from `0/60` P0 to `18/60`. After the
  planner-aware refuel pass on 2026-04-26 the same focused run sits at
  17/60 (28.3%) — within sample noise of the 2026-04-24 baseline, no
  regression but no win either. Still warns at decided-rate skew and
  has too many fleet-elimination resolutions.
- **Evacuation:** the scenario is still too short — average 2.3 turns at
  30 games — but objective share has crossed back above 50% on the
  focused seed. Continue to track on broader sweeps.
- **FleetAction fuel stalls:** legacy `fuelDriftBonus` + fuel-spent
  tie-break landed fleetAction at **72-150 stalls/game** depending on
  the sweep. After the 2026-04-26 drift gate + stall penalty work,
  fleetAction sits at **40.2/game on `--seed 1`** (above the 30 gate
  but well off the prior peak). Tightening further likely needs the
  bounded-planner extension into combat positioning rather than another
  scalar.
- **FleetAction balance:** recent large samples are close to acceptable,
  but keep watching timeout rate and P0 blowout risk on broader seeded
  sweeps. The 2026-04-24 sweep showed `timeoutShare 13.3%` at 30 games;
  2026-04-26 `--seed 1` was 10%.

**Files:** `src/shared/ai/`, `src/shared/scenario-definitions.ts`,
`src/shared/engine/victory.ts`, `scripts/simulate-ai.ts`,
`scripts/duel-seed-sweep.ts`

## Discovery & Onboarding

The journey from "someone shared the URL" to "first burn plotted" is where
players form their lasting impression. The items below are gaps surfaced by
a 2026-04-26 deep-review pass.

### Add Open Graph / Twitter / `meta description` for shareable previews (P2)

The live `<head>` ([static/index.html:1-13](../static/index.html)) only
ships `theme-color`, `viewport`, favicon and manifest links. Pasting
`https://delta-v.tre.systems/` into Discord, Slack, iMessage, X, or any
RCS chat renders a bare URL with the favicon — no preview card, no
description, no image. A game whose growth depends on word-of-mouth is
*invisible* in social feeds.

The `site.webmanifest` already carries the right description ("Real-time
multiplayer tactical space combat with vector movement and orbital
gravity.") — it just needs to mirror into the page head.

Action:

- Add `<meta name="description" content="…">` matching the manifest copy.
- Add `og:title`, `og:description`, `og:type=website`, `og:url`,
  `og:image` (1200×630 hero PNG, ideally a curated game-state render).
- Add matching `twitter:card=summary_large_image`, `twitter:image`,
  `twitter:title`, `twitter:description`.
- Generate the hero image once and serve it from `static/og-card.png`.
- Update `<title>` from bare "Delta-V" to a tagged variant like
  `Delta-V — Real-time tactical space combat`.

**Files:** [static/index.html](../static/index.html), new
`static/og-card.png` (or generated by a script during `bundle-style-css`),
[static/agents.html](../static/agents.html),
[static/matches.html](../static/matches.html),
[static/leaderboard.html](../static/leaderboard.html).

### Polish the First-Paint Loading State (P3)

Anyone on 3G or a cold cache currently sees the
`<div id="jsRequiredMsg">JavaScript is required to play Delta-V.</div>`
text for 1–3 seconds before the SPA boots — a confusing "is this site
broken?" moment for the time it takes `client.js` to parse. The bundle
already removes the element on first run; the framing is just bad.

Action: replace the static text with a polished interstitial — even a
small "Loading Delta-V…" with the existing brand mark fading in over a
star-flecked background — and reserve "JavaScript is required" wording
for the genuine `<noscript>` fallback. Keep the same DOM id so the
bundle's existing `?.remove()` call still owns the dismissal.

**Files:** [static/index.html](../static/index.html) (the `#jsRequiredMsg`
block at line ~75), [static/styles/base.css](../static/styles/base.css).

### Prompt PWA Install After a Match (P3, triggered)

The site already serves a manifest, icons, and a service worker, so
mobile Safari + Android Chrome will offer "Add to Home Screen". But we
never *prompt* the player. After a player's first or second completed
match against AI is the right moment — they've demonstrated intent.
Capture the `beforeinstallprompt` event, stash it, and surface a
single dismissable prompt in the lobby on a subsequent visit.

**Files:** [static/index.html](../static/index.html),
[src/client/main.ts](../src/client/main.ts), and a new lightweight
`src/client/pwa-install.ts` that owns the deferred prompt.

## Gameplay UX & Matchmaking

### Surface Rating Delta on the Game-Over Screen (P2)

The server already computes Glicko-2 ratings on every paired-human
game and writes a `match_rating` row with `ratingBeforeA / ratingAfterA
/ ratingBeforeB / ratingAfterB`
(see `match_rating` writes in
[rating-writer.test.ts](../src/server/leaderboard/rating-writer.test.ts)).
The protocol never delivers any of it to the client, so a player who
just *won a ranked match* sees only "VICTORY" + reason + ship-loss
stats — to learn whether they gained or lost rating they have to
navigate to `/leaderboard` and search themselves.

Action: extend the `gameOver` S2C protocol message with an optional
`ratingDelta: { before, after, delta }` payload populated from
`match_rating` for ranked matches, and render the delta prominently in
[overlay-view.ts](../src/client/ui/overlay-view.ts) — `+18` in
`var(--success)`, `-12` in `var(--danger)`, animated count-up on the
final value. Skip silently for AI / Quick-Match-vs-bot / unranked
matches so the surface only appears when meaningful.

This is the single biggest "make the win feel won" lever available.

**Files:** [src/shared/types/protocol.ts](../src/shared/types/protocol.ts)
(gameOver message), [src/server/game-do/game-do.ts](../src/server/game-do/game-do.ts)
(populate the field on game-over publish),
[src/client/ui/overlay-view.ts](../src/client/ui/overlay-view.ts)
(render),
[src/client/ui/overlay-state.ts](../src/client/ui/overlay-state.ts)
(state shape).

### Show a Full-Screen Scenario Briefing on Game Start (P3)

Today `logScenarioBriefing()` writes the scenario name + objective into
the bottom-corner game log
([hud-controller.ts](../src/client/game/hud-controller.ts)) where it
scrolls past in seconds, and a new player likely doesn't even notice
it. There is no "INCOMING TRANSMISSION: *Land on Mars before the
enemy reaches Venus*" full-screen card — the cinematic moment that
turns a sterile cold-drop into an opening sequence is missing.

Action: add a `<div id="scenarioBriefing">` overlay that fades in
when a fresh game starts (turn 1, astrogation phase, first paint),
displays the scenario `name`, `description`, and `objectiveText` in
typewriter-paced reveal, then fades out after ~3 s or on click /
keypress. The strings are already produced by the engine — only a
display surface is missing. Skip on rematches, replays, and reconnects
to active games.

**Files:** [static/index.html](../static/index.html),
[static/styles/overlays.css](../static/styles/overlays.css),
[src/client/ui/overlay-view.ts](../src/client/ui/overlay-view.ts),
[src/client/game/main-session-shell.ts](../src/client/game/main-session-shell.ts)
(trigger on first non-replay game-start).

### Polish the Menu First-Impression Layer (P3)

The drifting nebula + parallax starfield (commit `302e858`) gave the
menu pulse, but two more pieces would carry the atmosphere:

- **Ambient drone.** The procedural [audio.ts](../src/client/audio.ts)
  has SFX for select / confirm / thrust / combat / explosion / phase
  change / warning / victory / defeat — but no music or ambient pad.
  A low sine pad + sub-rumble + occasional tonal swell, gesture-gated
  on first user interaction (so it never autoplays), default-on with
  a "Sound on" indicator on the existing sound button, would
  transform the first 5 seconds of the experience.
- **Logo entrance.** The 72 px DELTA-V `<img>` hero
  ([static/index.html:83](../static/index.html)) appears statically
  on first paint. A scale-in + glow-pulse on first paint, gated to
  once-per-session via `sessionStorage`, would punctuate arrival
  without replaying every menu return.

**Files:** [src/client/audio.ts](../src/client/audio.ts) (new
`playAmbientDrone()` / `stopAmbientDrone()`),
[src/client/main.ts](../src/client/main.ts) (wiring),
[static/styles/components.css](../static/styles/components.css)
(`menu-logo` keyframes + reduced-motion guard).

### Stronger Visual Punch on Detonation and Ship Destruction (P3)

The renderer already has [combat-fx.ts](../src/client/renderer/combat-fx.ts)
and [effects.ts](../src/client/renderer/effects.ts), and procedural
audio plays an explosion sample on each hit. But a *nuke* detonation
should feel cinematically heavier than a *gun hit* — currently both
read similarly to a casual viewer. The central drama of the game is
combat; it should hit harder.

Action: differentiate signatures by ordnance type in `combat-fx.ts`.
Nukes get a multi-stage shockwave (bright flash → expanding ring →
secondary debris cloud) and a screen-flash. Mines get a tighter
particle burst. Standard gun hits stay subtle. Capped intensity for
`prefers-reduced-motion: reduce` so the cinematics degrade
gracefully.

**Files:** [src/client/renderer/combat-fx.ts](../src/client/renderer/combat-fx.ts),
[src/client/renderer/effects.ts](../src/client/renderer/effects.ts),
[src/client/audio.ts](../src/client/audio.ts) (per-type sample tweak).

### "Share Replay" Affordance on Game-Over and Match History (P3)

Each match has a stable, public-readable URL of the form
`/?code=<roomCode>&archivedReplay=<gameId>` — already generated by
the matches page. After a tense win, a player has no quick way to
share it with friends; they would have to navigate back to
`/matches`, find the row, and copy the link from there.

Action: add a "Copy replay link" button to the game-over actions row
next to Rematch / Exit, and to each row in the matches list page.
Clipboard write + a brief "Copied" status, tracked via the existing
telemetry pipeline so engagement loop can be measured.

**Files:** [static/index.html](../static/index.html) (game-over
actions row), [src/client/ui/overlay-view.ts](../src/client/ui/overlay-view.ts),
[static/matches.html](../static/matches.html).

### Match-History Replay Thumbnails (P3)

`/matches` is a text-only table of game IDs / scenarios / winners /
turn count. There is no thumbnail, no scenario badge, no "you played
this" highlight. A small canvas-rendered minimap thumbnail per row —
the final game state from the archived `GameState` — would massively
change browse-ability and tempt return-engagement.

Action: extend the matches list response (or a new lightweight
endpoint) with the archived final-state's body positions + ship
endpoints, and render a 96×64 thumbnail per row. Heavier-than-zero
work but high payoff for return engagement.

**Files:** [static/matches.html](../static/matches.html),
[src/server/matches-list.ts](../src/server/matches-list.ts) (response
shape), [src/client/renderer/minimap-draw.ts](../src/client/renderer/minimap-draw.ts)
(re-usable rendering primitive).

### Leaderboard Rank-Trend Indicator (P3)

`/leaderboard` shows the current `rating` only. A `▲ 14` / `▼ 7`
badge per row — change since the player's previous appearance — would
create return-engagement pull. The data exists in `match_rating`
rows; the leaderboard endpoint just needs to project it.

**Files:** [src/server/leaderboard/query-route.ts](../src/server/leaderboard/query-route.ts),
[static/leaderboard.html](../static/leaderboard.html).

### Populate Help Overlay Screenshots (P3)

[static/index.html:375-534](../static/index.html) contains six
`.help-screenshot` placeholder text blocks (e.g. "[Screenshot: A
ship with its cyan velocity arrow pointing ahead, and burn arrows
around it showing the 6 possible acceleration directions]"). New
players opening Help to figure out vector physics — the unique
selling point of the game — get a description of where a screenshot
*would* be. The UI surfaces the help describes (vector burns, gravity,
fleet building, ordnance, HUD) have been stable since 2026-04-24, so
the original "wait for UI freeze" trigger is effectively met.

Action: render six PNGs from deterministic Play-vs-AI states in the
Playwright preview MCP, then drop them into `static/help/` and
replace each placeholder block with a proper `<img>` + alt text.
(Previously listed under Future Features; promoted to active because
the gating condition has held for ≥2 weeks.)

**Files:** [static/index.html](../static/index.html) (the six
`.help-screenshot` placeholders), [static/styles/overlays.css](../static/styles/overlays.css)
(the placeholder → image styling),
new `static/help/` PNGs.

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

## Telemetry & Observability

### Add Remaining Discovery / Session-Quality Signals (P2)

The internal metrics endpoint, observability SQL recipes, discovery page views,
replay engagement events, `scenario_selected`, and `ws_session_quality` (RTT
aggregate per WS lifecycle) are shipped. The remaining gaps are narrower:

- `leaderboard_row_clicked` once leaderboard rows become interactive.

**Files:** `src/client/game/main-session-shell.ts`,
`src/client/game/replay-controller.ts`, `src/client/leaderboard/*.ts`,
`static/matches.html`, `static/leaderboard.html`, `src/server/metrics-route.ts`

## Architecture & Correctness

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

### OpenClaw `SKILL.md` on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so OpenClaw agents can
auto-acquire Delta-V capability.

**Files:** external publish; skill body references remote MCP endpoint
