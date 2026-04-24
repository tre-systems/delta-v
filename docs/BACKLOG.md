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
fragile. The next pass should make AI tuning more systematic while keeping the
heuristic architecture simple.

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
  new recurring failure modes appear. The baseline scorecard, invalid-action,
  fuel-stall, passenger-transfer mistake, and objective-drift counters are
  already shipped.
- Grow the fixture path from one captured fuel-stall regression into a broader
  corpus. Invalid orders, fuel stalls, passenger transfer mistakes, and
  objective drift are captured by the harness.

**Files:** `scripts/simulate-ai.ts`, `scripts/duel-seed-sweep.ts`,
`src/shared/simulate-ai-policy.test.ts`, `src/shared/ai.test.ts`,
`docs/SIMULATION_TESTING.md`

### Add a Bounded Engine Planner for Movement Objectives (P1)

Grand Tour, evacuation, convoy, and blockade all depend on movement planning
under fuel, velocity, gravity, and landing constraints. The current scorer uses
many scalar distance/fuel bonuses where a small bounded planner would provide a
better signal without replacing the whole AI.

Action: continue growing the reusable short-horizon planner over `computeCourse`
that can score "can reach safe refuel / objective / landing line within N
turns" and return a cost-to-go. The first helper is now used for Grand Tour
checkpoint fuel-stall recovery. Next, feed that cost into checkpoint/refuel
ranking more directly, then passenger arrival decisions, where it can replace
several ad hoc fuel and landing bonuses.

**Files:** `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/movement.ts`, `src/shared/ai.test.ts`

### Separate Ship Roles Before Tactical Scoring (P1)

Generic combat, objective, fuel, and landing scores still fight each other in
escort scenarios. A cheap role pass would make the scoring simpler and more
stable: assign each ship a turn-local role such as `carrier`, `escort`,
`interceptor`, `refuel`, `race`, or `screen`, then let the role choose a smaller
set of priorities.

Action: continue expanding the lightweight role assignment step for AI phases
that need coordination. The first pass now classifies convoy / evacuation
passenger ships as carrier, escort, screen, or refuel and feeds passenger
astrogation scoring. Next, reuse the same idea for Grand Tour race/refuel
decisions if it proves useful.

**Files:** `src/shared/ai/logistics.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/ai/scoring.ts`

### Scenario Symptoms to Validate With the New Loop (P1)

These are still real player-facing AI issues, but they should be handled through
the scorecard / fixture / planner workflow above rather than one-off weight
changes:

- **Passenger scenarios:** convoy and evacuation still resolve too often by
  elimination. Passenger-carrier doctrine should rank arrival odds and survival
  of a viable destination runner above hull quality or generic combat value.
- **Grand Tour:** the 2026-04-24 refuel-navigation pass improved focused
  `grandTour 60 -- --ci --seed 1` from `0/60` P0 to `18/60`, but the sample
  still warns at `30.0%` P0 and has too many fleet-elimination resolutions.
- **Evacuation:** the scenario is still too short and too attrition-heavy; the
  target metric is objective share, not just seat balance.
- **FleetAction:** recent large samples are close to acceptable, but keep
  watching timeout rate and P0 blowout risk on broader seeded sweeps.
- **Difficulty tiers:** Easy/Normal/Hard now differ more than before. Only widen
  Hard-vs-Normal again if real playtesting still says the tiers feel too similar.
- **Ordnance thresholds:** impossible-shot and nuke/torpedo regressions are now
  covered. Tune remaining hard-tier threshold rows only when scorecards or
  sweeps show over-firing.

**Files:** `src/shared/ai/`, `src/shared/scenario-definitions.ts`,
`src/shared/engine/victory.ts`, `scripts/simulate-ai.ts`,
`scripts/duel-seed-sweep.ts`

## Gameplay UX & Matchmaking

### Enforce Notification Channel Precedence in Code (P2)

Several high-salience flows now use HUD/sound/game-log feedback instead of
stacking toasts, while connection, reconnect, and session errors stay on the
toast channel. The remaining work is an audit, not a known single bug.

Action: audit session UI effects, reactive wiring, telemetry-driven copy, and
logistics paths that may still mirror game-log content as a toast.

**Files:** `src/client/ui/overlay-view.ts`,
`src/client/game/session-ui-effects.ts`, `src/client/game/session-signals.ts`,
`src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`,
`src/client/game/command-router.ts`, `src/client/telemetry.ts`

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

### Make Official Bot Provenance Obvious Everywhere (P1)

The explicit quick-match fallback offer is shipped, as are server-side metadata,
telemetry, archive, rating, and match-list fields. What is not yet obvious from
the current client code is a product-surface badge wherever an official platform
bot appears.

Action: render an `Official Bot` badge or equivalent display affordance in
matchup UI, match history, replay chrome, and leaderboard presentation whenever
the archived/match metadata says `officialBotMatch`. Keep user-created agents
visually distinct from the platform-operated bot.

**Files:** `src/client/leaderboard/*.ts`,
`src/client/game/main-session-shell.ts`, `src/client/game/replay-controller.ts`,
`src/server/game-do/archive.ts`, `src/shared/types/*`

## Cost & Abuse Hardening

### Clear the Transitive `hono` Advisory in the MCP Adapter Chain (P2)

`npm audit --omit=dev` still reports `GHSA-458j-xx4x-4375` through
`@modelcontextprotocol/sdk -> hono`. The codebase does not appear to use the
affected JSX SSR path, so this is dependency hygiene rather than a top security
issue.

Action: clear when the MCP SDK chain updates.

**Files:** `package.json`, `packages/mcp-adapter/package.json`

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

### WAF or Cloudflare Rate Limits for Join / Replay Probes

**Trigger:** distributed scans wake Durable Objects or cost too much.

Baseline per-isolate rate limiting is already shipped. Add WAF or
`[[ratelimits]]` only if that baseline proves insufficient.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Cloudflare Turnstile on Human Name Claim

**Trigger:** logs show bulk human name-claim POSTs, or the beta opens to a
larger audience.

Add Turnstile verification to `POST /api/claim-name` while preserving the
existing success path.

**Files:** `src/server/auth/claim-name.ts`, `src/server/auth/turnstile.ts`,
`static/index.html`, `src/client/`, `wrangler.toml`

### Populate Help Overlay Screenshots

**Trigger:** UI/UX is frozen enough that in-game screenshots will not go stale
in the next release cycle.

Replace the six `.help-screenshot` placeholder blocks with optimized screenshots
and alt text.

**Files:** `static/index.html`, `static/styles/overlays.css`,
`static/help/`

### OpenClaw `SKILL.md` on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so OpenClaw agents can
auto-acquire Delta-V capability.

**Files:** external publish; skill body references remote MCP endpoint
