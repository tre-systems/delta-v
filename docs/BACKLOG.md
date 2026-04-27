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

### Turn Planner Signals Into Landing-Safe Objective Decisions (P1)

Grand Tour, evacuation, convoy, and blockade all depend on movement planning
under fuel, velocity, gravity, and landing constraints. The planner now has
short-horizon cost-to-go signals for refuel, passenger arrival, and Grand Tour
checkpoint targeting, and checkpoint racers avoid lines that leave no in-map
continuation after a near-edge move or a ramming trap on a shared-base
approach. The next open problem is applying the same landing-safe doctrine to
the passenger and landing-objective scenarios without turning every fix into a
scenario-specific weight.

Action: promote recurring evacuation, convoy, and biplanetary terminal-approach
failures into fixtures, then teach the race/refuel branch to prefer plans that
preserve a safe landing or abort/refuel line. Avoid another scalar-only course
score unless the fixture proves it generalizes.

**Files:** `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/ai/scoring.ts`, `src/shared/ai.test.ts`

### Tighten Role-Aware Tactical Doctrine (P1)

Generic combat, objective, fuel, and landing scores still fight each other in
escort scenarios. The AI now has a shared turn-local role map with `carrier`,
`escort`, `interceptor`, `refuel`, `race`, and `screen` roles, and astrogation
has begun consuming it for non-checkpoint race/escort course overlays. Ordnance
and combat now preserve race-role ships from opportunistic attacks when cover is
available.

Action: use promoted fixtures and paired scorecards to tune the role-specific
priorities instead of adding broad weights. Interceptors should commit harder to
enemy objective runners, escorts/screens should value formation and blocking
over attrition, and race ships should only break objective posture for direct
threats. Grand Tour should stay on the separate landing-safe checkpoint doctrine
item; the generic race overlay skewed seat balance there.

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
- **Duel live seat imbalance:** the 2026-04-27 D1 audit (R20) measured
  Duel at **27/35 = 77% P0** across decided archived matches. A
  follow-up audit of `MatchmakerDO` found the quick-match layer already
  shuffles seats and now has a repeated stable-key regression covering
  both shuffle directions and token-to-seat mapping. Treat the remaining
  imbalance as Duel turn-order, doctrine, or scenario-balance work rather
  than a matchmaking assignment bug.
- **Grand Tour:** the 2026-04-27 cost-to-go checkpoint targeting pass moved
  focused `grandTour 60 --ci --seed 1` to a passing 55% P0 decided rate
  with no invalid actions or fuel stalls, but 55% still resolved by fleet
  elimination. The follow-up checkpoint edge-continuation pass removed the
  repeated turn-32 north-edge loss and moved the same sample to 75% Grand Tour
  completions / 25% fleet eliminations. The final shared-base ramming-avoidance
  pass moved the same sample to 100% Grand Tour completions, 0% fleet
  eliminations, and no objective-drift captures, but it exposed the underlying
  race imbalance: P0 decided rate is 0% on this focused seed. Next Grand Tour
  work should tune route pacing / seat balance without giving back the
  objective-safety gains. A 2026-04-27 follow-up rejected two tempting
  rules/data shortcuts: adding Luna as a ninth checkpoint improved seat rate
  but reintroduced 30-50% fleet eliminations through terminal-approach crashes,
  while moving P0's home start from Luna to Terra produced 100% fleet
  eliminations in the focused sample. Treat this as an AI route/landing-planner
  problem rather than a simple checkpoint-list or start-world swap.
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

## Gameplay UX & Matchmaking

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
