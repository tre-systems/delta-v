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

1. **Reconcile Rating Rows With Archive/R2 Retention (P2)** — define and
   enforce the invariant for rated games whose archive row or R2 object is
   missing.
2. **Keep D1 and R2 Archive Completion Times Consistent (P3)** — preserve the
   original completion timestamp when archive code runs more than once.

Primary write ownership: `migrations/`, `src/server/game-do/match-archive.ts`,
`src/server/game-do/alarm.ts`, `src/server/game-do/publication.ts`,
`src/server/leaderboard/rating-writer.ts`, `src/server/matches-list.ts`,
archive/rating tests, and Cloudflare data-audit docs.

Avoid touching AI policy, scenario tuning, briefing UI, or static marketing
pages except for narrow type fallout.

### Agent B — Gameplay AI Scenario Reliability

Goal: make hard-vs-hard scenario play resolve credibly without invalid actions,
fuel-stall loops, or timeout-heavy stalemates.

1. **Reduce Fleet Action Fuel-Stall Drift (P2)** — investigate and fix fueled
   coasting in large-fleet simulations.
2. **Rebalance Blockade Runner Objective Pressure (P2)** — either make the
   landing race resolve by objective more often or update scenario copy/manual
   tests to match the actual attrition-heavy product experience.
3. **Maintain Fixture-Backed AI Workflow (guardrail)** — promote representative
   captures into fixtures before changing heuristics or score weights.

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

1. **Add Role-Specific Asymmetric Briefing Copy (P2)** — Convoy P1 should not
   see the escort-side story while their objective is to destroy all enemies.
   Cover Lunar Evacuation before it returns to the lobby.

Primary write ownership: `src/client/ui/scenario-briefing-view.ts`, a new
briefing-copy helper if needed, briefing/UI tests, `docs/MANUAL_TEST_PLAN.md`,
and narrow static/help copy if needed.

Avoid touching AI heuristics, `src/shared/map-data.ts`, Cloudflare data schemas,
archive retention, or leaderboard telemetry.

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
- **Improve Passenger Objective AI** — current paired scorecards landed; keep
  only the fixture workflow guardrail for future AI changes.
- **Small Accessibility Polish** — current a11y pass is complete; reopen only
  for a concrete gap discovered while touching a UI surface.

`leaderboard_row_clicked` is intentionally not assigned right now because
leaderboard rows are still inert. Add it only in the same change that makes rows
interactive.

## Remaining Backlog Detail

### Reduce Fleet Action Fuel-Stall Drift (P2)

The 2026-05-02 post-deploy simulation sweep surfaced a strong Fleet Action AI
quality issue even though engine stability passed. `npm run simulate -- all 60
--ci --quiet --json` produced 442 `fuelStalls` in Fleet Action, or 7.37 per
game, with 2 timeouts. A narrower capture run,
`fleetAction 20 --seed -403487708 --capture-failure-kind fuelStall`, reproduced
442 stalls in 20 games, or 22.1 per game, with 10% timeouts and P0 decided rate
38.9%.

Triage whether the metric is over-classifying legitimate station-keeping in
large fleet fights or whether the hard AI is genuinely leaving fueled ships
idle without a movement/combat objective. Promote representative captures from
`tmp/live-pass-fleetaction-fuel` into fixtures before changing weights or fleet
plans.

Acceptance: Fleet Action keeps zero invalid actions and no crash regressions,
while `fuelStallsPerGame` drops below 0.1 on a paired 60+ game seed sweep and
timeouts remain below 5%.

**Files:** `src/shared/ai/`, `src/shared/ai/__fixtures__/`,
`scripts/simulate-ai.ts`, `src/shared/simulate-ai-policy.test.ts`

### Rebalance Blockade Runner Objective Pressure (P2)

Blockade Runner is marketed as a speed/landing race, but the live archive and
AI simulation both show it resolving mainly by attrition. The post-cleanup
archive has 7/7 Blockade rows ending `Fleet eliminated!`. The 2026-05-02
post-deploy simulation sweep produced only 8 Mars landings in 60 games
(13.3% objective share), and a focused `blockade 40 --seed -403487708` run
landed only 6/40 (15% objective share).

Investigate whether the packet ship needs more initial separation, fuel,
defensive survivability, or a clearer route heuristic. If the intended product
experience is actually interception combat, change the lobby/manual copy
instead of calling it a landing race.

Acceptance: on a 60+ game hard-vs-hard seed sweep, Blockade Runner should either
exceed 50% landing/objective resolutions or have scenario copy and manual tests
updated to describe it as a combat-heavy interception scenario.

**Files:** `src/shared/map-data.ts`, `src/shared/ai/`,
`src/shared/ai/__fixtures__/`, `docs/MANUAL_TEST_PLAN.md`,
`docs/SIMULATION_TESTING.md`

### Add Role-Specific Asymmetric Briefing Copy (P2)

The live browser sweep still shows Convoy P1 receiving a fixed escort-mission
description beside objective `⬡ Destroy all enemies`. The player is actually
the pirate/interceptor side, so the briefing tells them the story for the other
role. Escape P1 reads clearly; Convoy remains the visible player-facing gap.
Lunar Evacuation has the same structural risk before it can safely return to
the lobby.

Render a per-seat role banner or per-seat scenario description for asymmetric
scenarios. Keep the current shared description as a fallback only when both
sides have the same role framing.

Acceptance: forcing `__DELTAV_FORCE_PLAYER_SIDE = 0` and `1` before launching
Convoy shows role-accurate briefing copy for both seats; the same test should
cover Lunar Evacuation before re-enabling its card.

**Files:** `src/client/ui/scenario-briefing-view.ts`, new briefing-copy helper
if needed, `src/client/ui/*briefing*.test.ts`, `docs/MANUAL_TEST_PLAN.md`

### Reconcile Rating Rows With Archive/R2 Retention (P2)

The 2026-05-02 post-deploy Cloudflare audit found `match_rating` rows whose
`game_id` no longer has a corresponding `match_archive` row or R2 object. The
live examples included `BCFV9-m1` and `3PJYX-m1`: both have `rating_applied`
events and earlier `archived_replay_fetch_succeeded` telemetry, but
`match_rating LEFT JOIN match_archive` reports no archive and `wrangler r2
object get delta-v-match-archive/matches/<gameId>.json` now returns missing.
That leaves leaderboard/rating history referring to games that cannot be
inspected through the archive/replay path.

Define the retention invariant explicitly. Either every rated game keeps a
hidden/internal archive row and R2 object, or a rating row can be marked as
`archive_retired` with a reason so operators and public surfaces do not imply a
replay exists. Avoid destructive cleanup paths that delete only one side of the
rating/archive/R2 relationship.

Acceptance: `SELECT COUNT(*) FROM match_rating mr LEFT JOIN match_archive ma ON
ma.game_id = mr.game_id WHERE ma.game_id IS NULL` is zero, or every non-zero row
has an explicit retired/hidden status and no public route links to a missing
replay. Recent D1 archive rows should still have non-empty R2 objects.

**Files:** `migrations/`, `src/server/game-do/match-archive.ts`,
`src/server/leaderboard/rating-writer.ts`, `src/server/matches-list.ts`,
`docs/EXPLORATORY_TESTING.md`, `src/server/*match*.test.ts`

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

### Keep D1 and R2 Archive Completion Times Consistent (P3)

The 2026-05-02 D1/R2 parity sample found older archived matches where D1
`match_archive.completed_at` matches the final `gameOver` event timestamp, but
the R2 archive top-level `completedAt` is several minutes later. Examples:
`BCFV9-m1` D1 `1777617952527`, R2 `1777618319354`, final event
`1777617952525`; `3PJYX-m1` D1 `1777395957287`, R2 `1777396266883`, final
event `1777395957284`. Newer disconnect-forfeit archives from the same pass
were consistent.

Likely cause: a later alarm/archive path rewrites the R2 object with
`Date.now()` while the D1 row is protected by `INSERT OR IGNORE`, leaving the
metadata surfaces disagreeing. Preserve the original completed time on
re-archive, derive it from the final `gameOver` event/state, or skip R2 rewrites
when an archive already exists.

**Files:** `src/server/game-do/match-archive.ts`,
`src/server/game-do/alarm.ts`, `src/server/game-do/publication.ts`,
`src/server/game-do/match-archive.test.ts`

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
