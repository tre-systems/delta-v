# Delta-V Backlog

Outstanding tasks that deserve a named home between PRs. Shipped work belongs in
`git log`, not here. Recurring review procedures live in
[REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in
[ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in
[EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

Sections are grouped by theme and ordered roughly by player impact.

## AI Evaluation & Heuristic Planning

The current AI backlog has repeatedly converged on the same failure mode: a
single bad simulation or playtest produces another local weight tweak. That is
fragile. The active AI work is grouped into three tracks:

- **Evaluation loop:** scenario scorecards, failure captures, and fixture
  regressions.
- **Reusable planning primitives:** bounded movement planning and ship-role
  assignment.
- **Intent-first planning:** named tactical plans with comparable evaluation
  vectors instead of one large scalar score.
- **Scenario symptom queue:** player-facing balance/AI failures to validate
  through the first two tracks rather than one-off weight changes.

### Promote Captured Failure States into Fixtures (P1, ongoing)

Keep promoting captured `GameState` snapshots into decision-class regressions in
[src/shared/ai/__fixtures__/](../src/shared/ai/__fixtures__/) when a
particular bad decision appears repeatedly across seeds — "land to refuel",
"keep the viable passenger carrier", "do not coast while stalled", "screen
the carrier instead of chasing attrition", etc. Avoid exact burn assertions
unless the rules require them. Fixture-backed behaviour assertions should
land with the AI fix that makes the bad decision unrepresentable.

Add a new failure counter only when the current scorecard / capture
manifest genuinely misses a recurring symptom; pure tuning belongs in
existing counters.

**Files:** `src/shared/ai/__fixtures__/`,
`src/shared/simulate-ai-policy.test.ts` (gates), `docs/SIMULATION_TESTING.md`
(when adding a counter).

### Turn Planner Signals Into Landing-Safe Objective Decisions (P1)

Grand Tour, evacuation, convoy, and blockade all depend on movement planning
under fuel, velocity, gravity, and landing constraints. The open problem is
applying landing-safe doctrine to passenger and landing-objective scenarios
without turning every fix into a scenario-specific weight.

Action: promote recurring evacuation, convoy, and biplanetary terminal-approach
failures into fixtures, then teach the race/refuel branch to prefer plans that
preserve a safe landing or abort/refuel line. Avoid another scalar-only course
score unless the fixture proves it generalizes.

**Files:** `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/ai/scoring.ts`, `src/shared/ai.test.ts`

### Complete Intent-First AI Planning Architecture (P1)

The AI has outgrown a single scalar course score. Future fixes should extract
named plans and ordered evaluation vectors so objective safety, carrier
survival, fuel margin, landing setup, and combat posture are compared
explicitly instead of fighting through unrelated bonuses.

The foundation is now in place: passenger and fuel-support decisions have named
plans for `deliverPassengers`, `preserveLandingLine`, `escortCarrier`,
`interceptPassengerCarrier`, `supportPassengerCarrier`,
`postCarrierLossPursuit`, and `refuelAtReachableBase`.

Current architecture state:

**Decision inventory to finish the shift:**

- **Astrogation:** named plans cover passenger/refuel overrides, emergency
  escort, and transfer formation orders. Scalar order traces cover ordinary
  burns, including top rejected scalar burn candidates.
- **Logistics:** transfer selection now emits named passenger/fuel transfer
  plans that consume `AIDoctrineContext`. Add logistics-specific capture traces
  only if a concrete logistics failure needs them.
- **Ordnance:** nuke, torpedo, mine, and race-role hold decisions now have
  named plan candidates. Launches, race-role holds, and anti-nuke-reach
  rejections now flow into simulation captures. Remaining ordnance work is to
  expose landing-line hold diagnostics if a concrete capture shows they are
  needed, while keeping intercept geometry helpers local.
- **Combat:** target choice, attack grouping, hold-fire, and anti-nuke grouping
  now emit named plans into simulation diagnostics.
- **Fleet building:** purchase search remains acceptable as bounded optimizer
  / rules-gate logic unless a player-facing fleet-choice failure appears; do
  not churn it only for architecture purity.

The passenger plan surface is split by responsibility behind the stable
`plans/passenger.ts` barrel: combat holds, carrier support/delivery approach,
escort navigation overrides, interceptor pursuit, shared passenger helpers,
and action types. Future passenger fixes should extend the relevant narrow
module and consume `AIDoctrineContext` instead of rediscovering carrier,
threat, and role state.

**Files:** new `src/shared/ai/plans/`, `src/shared/ai/astrogation.ts`,
`src/shared/ai/combat.ts`, `src/shared/ai/logistics.ts`,
`scripts/simulate-ai.ts`, `src/shared/ai.test.ts`

Acceptance for each task: add or promote a fixture that failed before the
change, assert the chosen intent where possible, and compare paired seed
scorecards before / after without increasing invalid actions, fuel stalls,
passenger-transfer mistakes, or timeout-heavy stalemates.

### Tighten Role-Aware Tactical Doctrine (P1)

Generic combat, objective, fuel, and landing scores still fight each other in
escort scenarios.

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

- **Passenger scenarios:** passenger-objective failure is now explicit: if no
  colonists survive on the delivery side, the interceptor wins immediately
  instead of cleaning up tankers/escorts as a fleet-elimination ending. In
  `convoy 80 --seed 21`, this moved fleet eliminations from 83.75% to 26.25%
  while preserving 0 invalid actions, 0 transfer mistakes, and 0.25 fuel
  stalls/game. Remaining tuning is behavior, not outcome classification:
  convoy still delivers passengers only 11.25% in that sample, and evacuation
  still has a short opening window (`evacuation 80 --seed 21`: 61 deliveries,
  19 passenger-objective failures, 76.25% P0). Improve carrier survival and
  raider counterplay without returning to fleet-elimination-heavy outcomes or
  timeout-heavy stalemates.
- **FleetAction balance:** keep watching timeout rate and P0 blowout risk on
  broader seeded sweeps.

**Files:** `src/shared/ai/`, `src/shared/scenario-definitions.ts`,
`src/shared/engine/victory.ts`, `scripts/simulate-ai.ts`,
`scripts/duel-seed-sweep.ts`

## Gameplay UX & Matchmaking

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

### Leaderboard Row Click Telemetry (P2)

Add `leaderboard_row_clicked` once leaderboard rows become interactive.

**Files:** `src/client/leaderboard/*.ts`, `static/leaderboard.html`,
`src/server/metrics-route.ts`

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
