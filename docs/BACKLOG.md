# Delta-V Backlog

Outstanding tasks that deserve a named home between PRs. Shipped work belongs in
`git log`, not here. Recurring review procedures live in
[REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in
[ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in
[EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

Sections are grouped by priority and trigger. Last reviewed: 2026-05-02.

## Active Priority

### Improve Passenger Objective AI (P1)

Convoy and Lunar Evacuation are the remaining high-value AI tuning targets.
Recent engine work made passenger objective failure explicit, so these scenarios
now end for the right reason instead of drifting into cleanup fleet-elimination
endings. The remaining problem is behavior: protect or intercept the carrier
well enough that the intended passenger objective produces credible play.

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

Action: continue promoting representative convoy and evacuation captures into
fixtures, then improve carrier survival, raider interception, and landing-safe
abort/refuel choices through named plans or bounded movement planning. Recent
work taught the emergency escort lookahead to avoid carrier courses that become
crash-doomed if the carrier is disabled on the following combat pass. The next
useful slice is reducing the remaining convoy fleet-elimination drift without
undoing the higher 200-game passenger delivery rate. Do not add broad scalar
weights without a fixture proving the change generalizes. Use
`--capture-failure-kind passengerObjectiveFailure,objectiveDrift` for convoy so
carrier-loss states and fleet-elimination drift are both visible.

Acceptance: paired scorecards should improve passenger delivery quality or
reduce fleet-elimination drift without increasing invalid actions, fuel stalls,
passenger-transfer mistakes, or timeout-heavy stalemates.

**Files:** `src/shared/ai/`, `src/shared/ai/__fixtures__/`,
`src/shared/simulate-ai-policy.test.ts`, `scripts/simulate-ai.ts`

### Fix Protocol Surrender Resolution (P2)

The 2026-05-02 live exploratory pass reproduced a protocol-level surrender
soft-lock in private Duel rooms. A direct WebSocket game starts cleanly, but
when the active player sends `{"type":"surrender","shipIds":["pXs0"]}` for all
eligible ships, the server accepts the action and broadcasts `stateUpdate` with
that ship marked `control: "surrendered"`, while `phase` and `activePlayer`
remain unchanged and `outcome` stays `null`. The match only resolved later
because both test sockets disconnected and the disconnect-forfeit path fired.

Expected behavior: surrendering all eligible ships should either immediately
produce `gameOver` or advance through the same game-end check used by other
phase-resolution paths. Also decide whether empty `shipIds: []` is a supported
shorthand on raw WebSocket as it is on the HTTP/MCP action path; if not, keep
the rejection but document the difference.

**Files:** `src/shared/engine/logistics.ts`,
`src/server/game-do/actions.ts`, `src/shared/protocol.ts`,
`src/server/game-do/mcp-handlers.ts`, `src/server/game-do/*.test.ts`

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
