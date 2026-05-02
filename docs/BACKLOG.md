# Delta-V Backlog

Outstanding tasks that deserve a named home between PRs. Shipped work belongs in
`git log`, not here. Recurring review procedures live in
[REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in
[ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in
[EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

Sections are grouped by agent ownership and trigger. Last reviewed:
2026-05-02.

## Parallel Main-Branch Work Streams

Use these streams when separate agents need to work concurrently from `main`.
Each stream has a distinct write area and an ordered task list. Agents should
not take work from another stream unless the owning stream has already landed
or the handoff is explicit.

### Agent A — Archive Retention Integrity

Goal: keep Cloudflare D1 rating history, D1 archive metadata, and R2 replay
objects consistent without destructive cleanup.

Both queue items have shipped — see "Verified Not Active" below for the
acceptance evidence. Reopen this stream only if a new retention drift
surfaces in the R20 audit (`unretired_orphans` non-zero, or D1/R2
`completed_at` drift on a freshly archived match).

Primary write ownership: `migrations/`, `src/server/game-do/match-archive.ts`,
`src/server/game-do/alarm.ts`, `src/server/game-do/publication.ts`,
`src/server/leaderboard/rating-writer.ts`,
`src/server/leaderboard/rating-archive-retention.ts`,
`src/server/matches-list.ts`, archive/rating tests, and Cloudflare
data-audit docs.

Avoid touching AI policy, scenario tuning, briefing UI, or static marketing
pages except for narrow type fallout.

### Agent B — Gameplay AI Scenario Reliability

Goal: make hard-vs-hard scenario play resolve credibly without invalid actions,
fuel-stall loops, or timeout-heavy stalemates.

Both queue items have shipped — see "Verified Not Active" below for acceptance
evidence. Reopen this stream when a fresh paired scorecard shows
`fuelStallsPerGame > 0.1` in Fleet Action, Blockade Runner objective share below
50%, or a new repeated AI decision class that lacks a fixture.

Primary write ownership: `src/shared/ai/`, `src/shared/ai/__fixtures__/`,
`src/shared/map-data.ts`, `src/shared/simulate-ai-policy.test.ts`,
`scripts/simulate-ai.ts`, `docs/SIMULATION_TESTING.md`, and targeted simulation
docs/tests. If Blockade Runner is intentionally repositioned as attrition
combat instead of rebalanced toward landings, leave a note for Agent C rather
than editing briefing/manual copy in the same parallel pass.

Avoid touching archive migrations, D1/R2 retention code, leaderboard code, or
briefing UI.

### Agent C — Asymmetric Briefing UX

Goal: make scenario briefing copy accurate for each player seat in asymmetric
scenarios.

The queue item has shipped — see "Verified Not Active" below for the
acceptance evidence. Reopen this stream when a new asymmetric scenario
lands without per-seat narration in
[src/client/ui/scenario-briefing-copy.ts](../src/client/ui/scenario-briefing-copy.ts),
or when an existing asymmetric scenario's role framing changes.

Primary write ownership: `src/client/ui/scenario-briefing-view.ts`,
`src/client/ui/scenario-briefing-copy.ts`, briefing/UI tests,
`docs/MANUAL_TEST_PLAN.md`, and narrow static/help copy if needed.

Avoid touching AI heuristics, `src/shared/map-data.ts`, Cloudflare data schemas,
archive retention, or leaderboard telemetry.

### Agent D — Onboarding and Scenario Flow UX

Goal: keep first-run and scenario-entry flows escapable, measurable, and clear
without changing engine rules.

1. **Restore Fleet Builder Escape Hatch (P2)** — Fleet Action and
   Interplanetary War must let a player leave fleet building before launch.
2. **Make Tutorial Completion Reachable (P2)** — tutorial completion should be
   possible in the first-run Beginner path and observable in telemetry.

Primary write ownership: `src/client/ui/screens.ts`,
`src/client/ui/visibility.ts`, `src/client/ui/fleet-building-view.ts`,
`src/client/tutorial.ts`, first-run/tutorial tests, and targeted manual-test
docs.

Avoid touching scenario geometry, AI tuning, Cloudflare migrations, or
leaderboard/rating paths.

## Verified Not Active

The following items were checked against the current code/docs on 2026-05-02 and
should not be assigned as active backlog work:

- **Snapshot Callsigns in Match Archives** — implemented via archive username
  columns and `/api/matches` snapshot rendering.
- **Add Archive Visibility and Quality Flags** — implemented via
  `public_visible` / `quality_flags` and default public filtering.
- **Classify Player Identity Rows** — implemented via `identity_kind` in player
  storage paths.
- **Minimize Raw Player Keys in Telemetry Props** — implemented for future
  writes through lifecycle role labels and `/telemetry` payload redaction. Old
  D1 event rows age out under retention.
- **Reconcile Rating Rows With Archive/R2 Retention** — implemented via
  migration 0010 (`archive_retired_at` / `archive_retired_reason` on
  `match_rating`), the `rating-archive-retention` helper module, and the
  invariant query in [EXPLORATORY_TESTING.md § R20](./EXPLORATORY_TESTING.md#r20-d1-r2-storage-audit).
  The 11 historic 2026-05-02 orphans were backfilled with reason
  `pre_audit_cleanup`; live audit shows `unretired_orphans = 0`.
- **Keep D1 and R2 Archive Completion Times Consistent** — implemented in
  `archiveCompletedMatch` via the `r2.head()` short-circuit. The alarm
  path no longer rewrites a canonical R2 object, and the unit test
  ("skips the R2/D1 write when the archive already exists") guards the
  invariant.
- **Add Role-Specific Asymmetric Briefing Copy** — implemented via
  `src/client/ui/scenario-briefing-copy.ts` plus the briefing-view
  override. Convoy P0/P1, Lunar Evacuation P0/P1, Escape P0/P1, and
  Blockade Runner P0/P1 each render seat-specific narration; symmetric
  scenarios fall through to the shared description. Coverage asserted
  by `scenario-briefing-copy.test.ts`.
- **Reduce Fleet Action Fuel-Stall Drift** — the `fleetAction 60 --seed
  -403487708 --ci --quiet --json` scorecard now reports 0 fuel stalls, 0
  invalid actions, 0 crashes, and 2/60 timeouts (3.3%). The captured
  terminal-fuel endgame is preserved as
  `fleet-action-terminal-intercept-stall.json` so the stall metric no longer
  treats a stranded no-progress hold as a fueled coasting regression.
- **Rebalance Blockade Runner Objective Pressure** — the packet/corvette
  opening geometry now produces 47 Mars landings in 60 hard-vs-hard games
  (78.3% objective share) with 0 invalid actions, 0 crashes, 0 stalls, and 0
  timeouts on seed `-403487708`. The simulation policy now warns if Blockade
  objective share drops below 50%, matching the public landing-race framing.
- **Improve Passenger Objective AI** — current paired scorecards landed; keep
  only the fixture workflow guardrail for future AI changes.
- **Small Accessibility Polish** — current a11y pass is complete; reopen only
  for a concrete gap discovered while touching a UI surface.

`leaderboard_row_clicked` is intentionally not assigned right now because
leaderboard rows are still inert. Add it only in the same change that makes rows
interactive.

## Remaining Backlog Detail

### Restore Fleet Builder Escape Hatch (P2)

The 2026-05-02 live exploratory pass against deployed assets hash `c713f124`
found that both Fleet Action and Interplanetary War enter `fleetBuilding` with
`LAUNCH FLEET` and `CLEAR`, but no visible `Exit to menu` / `Back` control; the
Escape key also leaves the player on the same fleet builder. A player who opens
one of the two long fleet scenarios by mistake is trapped until they buy at
least one ship and launch.

Fix by exposing a clear exit/back affordance in `fleetBuilding` mode and cover
it with a visibility/unit test plus a live-style manual check for both fleet
scenarios. Acceptance: Fleet Action and Interplanetary War can be opened from
Play vs AI, then returned to the menu without selecting or launching a fleet,
with keyboard focus and mobile tap targets still reachable.

**Files:** `src/client/ui/screens.ts`, `src/client/ui/visibility.ts`,
`src/client/ui/fleet-building-view.ts`, `static/index.html`,
`docs/MANUAL_TEST_PLAN.md`

### Make Tutorial Completion Reachable (P2)

The tutorial still has no observed completions in production:
`tutorial_started = 127`, `tutorial_step_shown = 25`, `tutorial_skipped = 24`,
and `tutorial_completed = 0` in the 2026-05-02 D1 audit. The current
implementation has six steps and only emits completion after the player clicks
through every step; phase-gated ordnance/combat steps are unreachable in common
first-run routes such as Bi-Planetary.

Fix either by making completion mean "all eligible steps for this scenario were
shown/acknowledged" or by splitting the full combat/ordnance tutorial from the
Beginner onboarding path. Acceptance: a fresh-profile Bi-Planetary Easy run can
emit `tutorial_completed` without forcing the player into a combat-heavy
scenario, while scenarios that do include ordnance/combat still show their
specialized tips.

**Files:** `src/client/tutorial.ts`, `src/client/tutorial.test.ts`,
`src/client/game/phase-entry.ts`, `docs/MANUAL_TEST_PLAN.md`,
`docs/OBSERVABILITY.md`

### Maintain Fixture-Backed AI Workflow (P1, ongoing)

This is the guardrail for future AI fixes, not a standalone refactor project.
When a bad decision repeats across seeds, capture the state and add a
decision-class regression such as "land to refuel", "preserve passenger
carrier", "screen instead of chasing attrition", or "do not coast while
stalled". Avoid exact burn assertions unless the rules require them.

Add a new failure counter only when the current scorecard or capture manifest
misses a recurring symptom. Pure tuning belongs in existing counters.

**Files:** `src/shared/ai/__fixtures__/`,
`src/shared/simulate-ai-policy.test.ts`, `docs/SIMULATION_TESTING.md`

## Opportunistic Polish

(empty — see "Verified Not Active" for items recently retired from this
section.)

## Future Features

These items depend on product decisions or external triggers. They are not in
the active queue.

### Leaderboard Row Click Telemetry

**Trigger:** leaderboard rows become interactive, for example by linking to
player detail, recent matches, or replay filters. The current table rows are
inert, so no telemetry should be added yet.

Add `leaderboard_row_clicked` in the same change that introduces the
interaction. Do not add telemetry for inert rows.

**Files:** `src/client/leaderboard/*.ts`, `static/leaderboard.html`,
`src/server/metrics-route.ts`

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
