# Delta-V Backlog

Outstanding tasks that deserve a named home between PRs. Shipped work belongs in
`git log`, not here. Recurring review procedures live in
[REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in
[ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in
[EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

Sections are grouped by priority and trigger. Last reviewed: 2026-05-02.

## Concurrent Work Streams

Use these streams when two agents need to work concurrently from `main`. Each
stream is internally ordered; do not split one stream across multiple agents
unless the lead agent has already landed its current PR, because tasks within a
stream intentionally share files and migrations.

### Stream A — Data Integrity and Public History

Goal: make Cloudflare-stored data durable, privacy-conscious, and cleanly
presentable without manual destructive cleanup.

1. **Snapshot Callsigns in Match Archives (P1)** — first, because archive
   visibility and match-list rendering should depend on immutable participant
   snapshots rather than live `player` joins.
2. **Add Archive Visibility and Quality Flags (P2)** — second, because it can
   use callsign snapshots to hide low-quality rows without deleting R2/D1 audit
   records.
3. **Reconcile Rating Rows With Archive/R2 Retention (P2)** — third, because
   rated games should not outlive the archive/replay record they reference
   unless they have an explicit hidden/retired status.
4. **Classify Player Identity Rows (P2)** — fourth, so future filtering and
   retention decisions use explicit identity lifecycle instead of username
   globbing.
5. **Minimize Raw Player Keys in Telemetry Props (P2)** — fifth, because it is
   mostly telemetry plumbing and can follow the identity taxonomy.
6. **Keep D1 and R2 Archive Completion Times Consistent (P3)** — fold in after
   the archive schema work, or land separately if timestamp drift blocks replay
   trust.
7. **Leaderboard Row Click Telemetry (P2)** — small follow-up once leaderboard
   data semantics are stable.

Primary write ownership: `migrations/`, `src/server/game-do/match-archive.ts`,
`src/server/matches-list.ts`, `src/server/leaderboard/`, `src/server/auth/`,
`src/server/reporting.ts`, `src/server/game-do/telemetry.ts`,
`src/server/matchmaker-do.ts`, `static/matches.html`, `static/leaderboard.html`,
and observability/security docs.

Avoid touching Stream B AI/engine files except for narrow type fallout.

### Stream B — Gameplay Reliability and Player Experience

Goal: make the game itself resolve correctly, play credibly, and remain usable
across supported UI surfaces.

1. **Improve Passenger Objective AI (P1, completed current pass
   2026-05-02)** — keep the fixture-backed workflow tight for future AI
   changes and measure Convoy/Evacuation drift with paired scorecards.
2. **Reduce Fleet Action Fuel-Stall Drift (P2)** — the 2026-05-02 live
   post-deploy sweep found Hard-vs-Hard Fleet Action producing hundreds of
   fueled coasting turns and occasional timeouts.
3. **Rebalance Blockade Runner Objective Pressure (P2)** — the live archive
   and simulation both show the landing race usually resolving as attrition.
4. **Add Role-Specific Asymmetric Briefing Copy (P2)** — Convoy P1 still sees
   an escort-mission description beside a destroy-all-enemies objective.
5. **Maintain Fixture-Backed AI Workflow (P1, ongoing)** — do this as part of
   the AI work, not as a separate refactor.
6. **Small Accessibility Polish (P3, completed current pass 2026-05-02)** —
   only reopen when a touched UI surface exposes a concrete accessibility gap.

Primary write ownership: `src/shared/ai/`, `src/shared/ai/__fixtures__/`,
`src/shared/simulate-ai-policy.test.ts`, `scripts/simulate-ai.ts`,
`docs/SIMULATION_TESTING.md`, `src/shared/engine/`, `src/shared/protocol.ts`,
`src/server/game-do/actions.ts`, `src/server/game-do/mcp-handlers.ts`,
`src/client/ui/`, `static/index.html`, `static/styles/`, and e2e/a11y tests.

Avoid touching Stream A migrations, archive listing, leaderboard, or telemetry
storage files unless the fix is explicitly coordinated.

### Trigger-Gated Items

Keep these out of concurrent main-branch work until their trigger fires:
WAF / Cloudflare read-path rate limits and Cloudflare Turnstile belong to
Stream A when needed; OpenClaw `SKILL.md` publishing belongs to Stream B only
when the external platform is ready.

## Active Priority

### Improve Passenger Objective AI (P1)

Convoy is the remaining high-value passenger AI tuning target on public UX
surfaces. Lunar Evacuation remains defined for replay, simulation, and agent
coverage, but it is hidden from the lobby while its balance and UX are
revisited. Recent engine work made passenger objective failure explicit, so
these scenarios now end for the right reason instead of drifting into cleanup
fleet-elimination endings. The remaining problem is behavior: protect or
intercept the carrier well enough that the intended passenger objective produces
credible play.

Current 2026-04-28 checks:

- `convoy 40 --seed 21`: 27.5% passenger deliveries, 65% objective
  resolutions, 35% fleet eliminations, 0 invalid actions, 0 transfer
  mistakes, 0 fuel stalls.
- `convoy 80 --seed 21`: 31.25% passenger deliveries, 70% objective
  resolutions, 30% fleet eliminations, 0 timeouts, 0 invalid actions, 0
  transfer mistakes, 0 fuel stalls.
- `convoy 200 --seed 21`: 24.5% passenger deliveries, 71% objective
  resolutions, 29% fleet eliminations, 0 timeouts, 0 invalid actions, 0
  transfer mistakes, 0 fuel stalls.
- `evacuation 40 --seed 21`: 80% passenger deliveries, 100% objective
  resolutions, average 2.1 turns, 80% P0 decided, 0 invalid actions, 0 fuel
  stalls.
- `evacuation 80 --seed 21`: 76.25% passenger deliveries, 100% objective
  resolutions, average 2.075 turns, 76.25% P0 decided, 0 invalid actions, 0
  fuel stalls.

2026-05-02 live exploratory follow-up:

- `evacuation 60 --seed 1777706300 --ci --quiet --json`: 47-13 P0, 78.3%
  P0 decided, 100% objective resolutions, 78.3% passenger deliveries, average
  2.05 turns, 0 crashes, 0 invalid actions, 0 fuel stalls.
- `convoy` remains watch-listed from the 2026-04-28 checks rather than newly
  failing this pass; the live browser launch path and one-turn Play-vs-AI smoke
  passed for Convoy.

2026-05-02 Stream B completion checkpoint:

- `convoy 80 --seed 21 --ci --quiet --json`: improved from 31.25% to 46.25%
  passenger deliveries, from 70% to 81.25% objective resolutions, and from 30%
  to 18.75% fleet eliminations. No crashes, invalid actions, fuel stalls,
  passenger transfer mistakes, or timeouts.
- `convoy 200 --seed 21 --ci --quiet --json`: improved from 24.5% to 43.5%
  passenger deliveries, from 71% to 82% objective resolutions, and from 29% to
  18% fleet eliminations. No crashes, invalid actions, fuel stalls, passenger
  transfer mistakes, or timeouts.
- `evacuation 60 --seed 1777706300 --ci --quiet --json`: unchanged at 47-13 P0,
  78.3% P0 decided, 100% objective resolutions, 78.3% passenger deliveries, and
  0 fleet eliminations. Treat this as simulation coverage for now unless Lunar
  Evacuation is being prepared for UX re-entry.

Action: no active passenger-objective task remains outside normal regression
maintenance. Future passenger AI work should be trigger-driven by fresh Convoy
captures or by a decision to return Lunar Evacuation to the UX. Do not add broad
scalar weights without a fixture proving the change generalizes. Use
`--capture-failure-kind passengerObjectiveFailure,objectiveDrift,fuelStall` for
convoy so carrier-loss states, fleet-elimination drift, and false-positive
support-hold classifications are visible.

Acceptance: current paired scorecards improved passenger delivery quality and
reduced fleet-elimination drift without increasing invalid actions, fuel
stalls, passenger-transfer mistakes, or timeout-heavy stalemates.

**Files:** `src/shared/ai/`, `src/shared/ai/__fixtures__/`,
`src/shared/simulate-ai-policy.test.ts`, `scripts/simulate-ai.ts`

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

**Files:** `src/client/ui/scenario-briefing-view.ts`,
`src/shared/map-data.ts`, `src/client/ui/*briefing*.test.ts`,
`docs/MANUAL_TEST_PLAN.md`

### Snapshot Callsigns in Match Archives (P1)

The 2026-05-02 Cloudflare cleanup exposed that public match history depends on
`match_archive -> match_rating -> player` joins to display participant
callsigns. Once generated/default `Pilot XXXX` player rows were pruned, archive
rows such as `G3ZAN-m1` could no longer display players and had to be deleted
from public history. `match_rating` should remain rating audit, not the durable
participant-display source.

Add immutable participant snapshots to `match_archive` at archive time, at
minimum `player_a_username`, `player_b_username`, and `winner_username` (or a
small JSON participant snapshot if that fits D1 query needs better). Populate
from room config / claimed player records when the match ends, and make
`/api/matches` render from these archive columns instead of live `player` joins.
Keep joins only as a compatibility/backfill path for older rows.

Acceptance: deleting or renaming a `player` row never makes an already archived
public match lose its displayed callsigns. A test should cover an archived match
whose participant `player` rows are missing but whose archive snapshots still
render.

**Files:** `migrations/`, `src/server/game-do/match-archive.ts`,
`src/server/matches-list.ts`, `src/server/leaderboard/rating-writer.ts`,
`src/server/*matches*.test.ts`, `static/matches.html`

### Add Archive Visibility and Quality Flags (P2)

Short/noisy rows were removed destructively during the 2026-05-02 cleanup:
`turns <= 2`, missing callsigns, no rating row, or stale test identities. That
kept `/matches` clean, but it erased replay/index records that might still be
useful for audit or debugging. The product needs a first-class way to hide
low-quality rows from public surfaces without deleting storage.

Add `public_visible` plus a compact `quality_flags` / `archive_status` field to
`match_archive`. Default `/api/matches` should return only public-visible rows.
Archive code should mark obvious noise at write time: one/two-turn disconnect
rows, missing participant snapshots, null-outcome abandoned games, known test
identity rows, and stale pre-snapshot rows. Keep an internal query path or D1
recipe for operators to inspect hidden rows without using the public endpoint.

Acceptance: a one-turn disconnect or missing-callsign archive remains available
for internal audit but does not appear on `/matches` or `/api/matches` by
default.

**Files:** `migrations/`, `src/server/game-do/match-archive.ts`,
`src/server/matches-list.ts`, `docs/EXPLORATORY_TESTING.md`,
`docs/MANUAL_TEST_PLAN.md`, `src/server/*matches*.test.ts`

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

### Classify Player Identity Rows (P2)

The `player` table currently mixes claimed humans, generated default callsigns,
scratch/test identities, platform agents, and seed agents. During cleanup, that
forced pattern-based deletes such as `username LIKE 'Pilot ____'`, `QA_*`,
`Probe*`, and `agent_live*`. The schema should make identity lifecycle explicit
instead of relying on username conventions.

Add an identity classification column such as `identity_kind` (`claimed_human`,
`default_human`, `test`, `agent`, `seed_agent`, `official_bot`) and set it in
claim-name, agent-token, seed/bootstrap, and quick-match bot paths. Use it in
leaderboard filtering, recovery eligibility, archive quality decisions, and
future retention policy. Existing rows can be backfilled conservatively from
current keys/usernames.

Acceptance: default/generated `Pilot XXXX` rows and known test identities can be
selected by `identity_kind` without username globbing, while named users such as
Rob, Fau, Reyes, and Kepler remain unambiguously preserved.

**Files:** `migrations/`, `src/server/leaderboard/player-store.ts`,
`src/server/leaderboard/claim-route.ts`, `src/server/auth/agent-token.ts`,
`src/shared/player.ts`, `src/server/leaderboard/query-route.ts`

### Minimize Raw Player Keys in Telemetry Props (P2)

D1 `events.props` can contain raw `playerKey` values from lifecycle telemetry
such as rating and matchmaker events. Those keys are opaque but still act as
stable account identifiers, and they make later cleanup/privacy reviews harder
than necessary.

Introduce a server-side telemetry redaction helper that replaces player keys in
event props with non-reversible hashed identifiers or role labels before
writing to D1. Preserve enough information for aggregate debugging (same player
within an event family, agent vs human, official bot flag) without storing the
raw credential-like value. Apply this only to future writes; old rows already
age out under the 30-day events retention.

Acceptance: new D1 `events` rows do not contain raw `human_*`, `agent_*`, or
browser-generated player keys in `props`, while existing R13/R20 queries still
answer operational questions.

**Files:** `src/server/reporting.ts`, `src/server/game-do/telemetry.ts`,
`src/server/leaderboard/rating-writer.ts`, `src/server/matchmaker-do.ts`,
`docs/OBSERVABILITY.md`, `docs/SECURITY.md`

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

### Leaderboard Row Click Telemetry (P2)

Add `leaderboard_row_clicked` when leaderboard rows become interactive. Do not
add telemetry for inert rows.

**Files:** `src/client/leaderboard/*.ts`, `static/leaderboard.html`,
`src/server/metrics-route.ts`

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
