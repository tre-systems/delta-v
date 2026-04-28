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

Remaining architecture tasks:

1. **Complete combat doctrine plan extraction.** Ship and ordnance target
   ordering now flows through named combat target plans, including
   `interceptPassengerCarrier`, `finishAttrition`, `defendAgainstOrdnance`,
   and `attackThreat`. Remaining work is to move attack grouping / threshold
   decisions such as `screenObjectiveRunner`, race-role restraint, and
   anti-nuke grouping into `PlanDecision` candidates. Keep the low-level odds /
   range math in the combat module, but make the strategic reason for firing or
   holding fire explicit and covered by intent assertions.
2. **Complete astrogation trace coverage.** Failure captures now include chosen
   and rejected named astrogation plan intents when a passenger, escort,
   interceptor, or refuel plan is applied. Remaining work is to trace the
   generic scalar course-score branch and special emergency / transfer
   formation orders so every burn can be explained without a local debugger.
3. **Finish passenger doctrine coordinator adoption.** Evacuation and convoy
   failures cross phase boundaries: route choice, escort screen, ordnance, and
   combat affect each other. A shared turn context now identifies the primary
   passenger carrier, active threat, landing window, and ship roles for
   astrogation, ordnance, and combat. Remaining work is to move logistics and
   phase-specific passenger plan helpers onto that context, then use it for the
   next concrete passenger behavior fix.
4. **Split passenger plan modules by responsibility.** Break
   `plans/passenger.ts` into narrower modules such as delivery, escort,
   intercept, and combat once the next behavior fix touches that area. Avoid a
   pure file shuffle; do it when a concrete fixture needs the split.
5. **Standardize `PlanEvaluation` units and ranges.** Document expected ranges
   for objective, survival, landing, fuel, combat, formation, tempo, risk, and
   effort, then update plan candidates whose scores are currently informal
   constants. Add comparison tests for at least one cross-domain decision
   where objective safety should beat local combat.

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

- **Passenger scenarios:** evacuation now avoids the worst early carrier-stack
  wipeouts, but hard-vs-hard samples are too escort-favored. Interceptor
  combat now explicitly prioritizes passenger carriers over closer escorts;
  the remaining evacuation issue is the short two-turn landing window and
  escort opening volley, which can deny the corsair a meaningful first combat.
  Tune that without returning to fleet-elimination-heavy outcomes or
  timeout-heavy stalemates. Convoy still has too many attrition endings; keep
  using captured fleet-elimination states to rank arrival odds and survival of
  viable destination runners above hull quality or generic combat value.
- **Duel live seat imbalance:** the 2026-04-27 D1 audit (R20) measured
  Duel at **27/35 = 77% P0** across decided archived matches. A
  follow-up audit of `MatchmakerDO` found the quick-match layer already
  shuffles seats and now has a repeated stable-key regression covering
  both shuffle directions and token-to-seat mapping. A local hard-vs-hard
  check on 2026-04-27 did **not** reproduce the live skew: `duel 200
  --seed 10` measured 45% P0, forced P0 start measured 41% P0, forced P1
  start measured 55% P0, and a 16-seed x 80-game sweep averaged 45.3% P0.
  Treat the remaining imbalance as a production-segmentation question first:
  re-run the D1 audit after `rating_applied` carries `officialBotMatch`, and
  split by official bot, human-vs-human, rematches, and winner seat before
  changing Duel rules or doctrine.
- **Grand Tour:** the 2026-04-27 cost-to-go checkpoint targeting pass moved
  focused `grandTour 60 --ci --seed 1` to a passing 55% P0 decided rate
  with no invalid actions or fuel stalls, but route pacing remains
  imbalanced. Tune route pacing / seat balance without giving back the
  objective-safety gains; avoid simple checkpoint-list or start-world swaps
  unless paired scorecards prove they generalize. A 2026-04-27 follow-up
  showed the current objective-safe Luna route still sweeps at 0% P0 across
  seeds 0-7 x 60, while an outward-first Luna route only reached 19.6% P0 and
  regressed objective completions to 31.5% with many fleet eliminations. Do not
  revive that route; the next fix needs to preserve landing-safe completion
  while addressing the Mars-side timing advantage.
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
