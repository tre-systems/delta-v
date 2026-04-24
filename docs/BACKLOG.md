# Delta-V Backlog

Outstanding tasks that deserve a named home between PRs. Shipped work belongs in
`git log`, not here. Recurring review procedures live in
[REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale lives in
[ARCHITECTURE.md](./ARCHITECTURE.md). Exploratory-pass technique lives in
[EXPLORATORY_TESTING.md](./EXPLORATORY_TESTING.md).

Sections are grouped by theme and ordered roughly by player impact. Entries with
only "done for this slice" history were removed in the 2026-04-24 cleanup.

## AI Objective Discipline

### Retune Passenger-Carrier Doctrine So Arrival Outranks Attrition (P1)

The escort scenarios have bespoke passenger logic in `src/shared/ai/logistics.ts`
and `src/shared/ai/astrogation.ts`, but hard-vs-hard samples still resolve too
often by elimination. Transfer scoring now rejects moving passengers onto a
materially worse destination runner; the broader evacuation / convoy posture
still needs tuning so escorts protect scoring lines without turning the scenario
into an attrition fight.

Action: continue retuning passenger astrogation and escort posture so the AI
strongly prefers preserving a viable destination runner. Reassign passengers
only when the new carrier materially improves arrival odds, not just combat
strength or generic ship value.

**Files:** `src/shared/ai/logistics.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/ai/scoring.ts`, `scripts/simulate-ai.ts`

### Broaden Objective-Discipline Seeded Validation (P2)

The AI suite has target-race coverage, passenger-carrier transfer regressions,
and direct tests around the simulator objective-warning policy. Passenger
scenarios still need broader seeded validation because convoy / evacuation can
look acceptable on one seed batch and drift on another.

Action: keep extending passenger-objective regressions and seeded sweep docs so
future convoy / evacuation regressions are judged against repeated objective
warning samples rather than a single manual sweep.

**Files:** `src/shared/ai.test.ts`, `src/shared/simulate-ai-policy.test.ts`,
`scripts/simulate-ai.ts`, `docs/SIMULATION_TESTING.md`

### Finish Grand Tour Seat-Balance Tuning (P1)

Grand Tour no longer deadlocks in 499-turn checkpoint races, and the 2026-04-24
refuel-navigation pass improved P0 from `0/60` to `18/60` on
`grandTour 60 -- --ci --seed 1`. It still warns at `30.0%` P0 on that focused
seed and still includes too many fleet-elimination resolutions instead of clean
race finishes. A full pre-push `simulate all 60 --ci` sample landed exactly on
the lower warning bound (`21/60`, `35.0%` P0), so this remains live but narrower
than the original failure.

Action: finish rebalancing the per-home route / checkpoint policy so both seats
complete the objective consistently without one side getting a free lane. Keep
the Grand Tour objective-seat warning green on repeated seeded samples, not only
one run.

**Files:** `src/shared/ai/common.ts`, `src/shared/ai/astrogation.ts`,
`src/shared/movement.ts`, `scripts/simulate-ai.ts`

### Evacuation Still Resolves Too Often by Elimination (P1)

Fresh reruns after the 2026-04-21 AI changes reconfirmed that evacuation is
still too short and too attrition-heavy. The relevant failure is not just seat
balance; objective share is too low for a passenger rescue scenario.

Action: tune evacuation passenger objective behavior first, then remeasure
convoy with the same passenger-objective warning policy so both scenarios reward
arrival over fleet deletion.

**Files:** `src/shared/ai/scoring.ts`, `src/shared/ai/common.ts`,
`src/shared/ai/astrogation.ts`, `src/shared/scenario-definitions.ts`,
`scripts/simulate-ai.ts`

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

## AI Behavior & Rules Conformance

### Tune Remaining Ordnance Recommendation Thresholds (P2)

The old impossible-shot and over-eager nuke/torpedo issues now have direct
regressions and measured hard-tier gates. The remaining work is threshold
validation against broader scenario outcomes, not another structural rewrite.

Action: if future `simulate:duel-sweep` or scenario sweeps show late-turn hard
nukes still over-firing, tighten the `3T+` threshold rows first. Add optional
engine-level integration seeds only if helper-level ordnance coverage stops
catching regressions.

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`,
`src/shared/engine/combat.ts`, `src/shared/ai.test.ts`,
`src/shared/test-helpers.ts`

### Keep Watching FleetAction Timeouts (P3)

FleetAction improved after mixed-fleet purchase tuning and stronger local
closing pressure. Recent large samples put it near "good enough", but it has
historically drifted between acceptable and too many timeouts.

Action: only revisit if larger seeded sweeps drift back above roughly `8-10%`
timeouts or reintroduce a strong P0 blowout.

**Files:** `src/shared/ai/`, `scripts/simulate-ai.ts`,
`src/shared/scenario-definitions.ts`, `src/shared/engine/victory.ts`

### Reassess Difficulty Tier Separation After Real Playtesting (P3)

Easy, Normal, and Hard now differ more in behavior and same-tier mirrors are
healthier. The menu copy was intentionally simplified again, so the remaining
question is player-perceived tier separation rather than stale homepage wording.

Action: only widen the Hard-vs-Normal gap again if real playtesting still says
the tiers feel too similar.

**Files:** `src/shared/ai/config.ts`, `src/shared/ai/`,
`scripts/simulate-ai.ts`

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

### Simultaneous or Pre-Submitted Astrogation

**Trigger:** product wants both players to commit astrogation before reveal, or
any model other than I-go-you-go `activePlayer` after fleet building.

Requires an explicit engine + protocol change; today astrogation is sequential
by `activePlayer` across engine, action guards, local MCP, and hosted MCP.

### Public Matchmaking With Longer Room Identifiers

**Trigger:** product moves beyond shared short codes.

Implement longer opaque room IDs or signed invites and update the join/share UX.

**Files:** `src/server/protocol.ts`, lobby and join UI, share-link format

### Trusted HTML Sanitizer for User-Controlled Markup

**Trigger:** chat, player names, or modded scenarios render as HTML.

Add a single sanitizer boundary, for example DOMPurify inside `dom.ts`, and
route all user-controlled markup through it. The trusted HTML boundary already
exists for internal strings.

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

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

### Proof-of-Work on First Agent Name Claim

**Trigger:** logs show bulk agent-token issuance being used to farm leaderboard
pseudonyms.

Server issues a challenge; client submits a nonce whose hash beats a threshold.
Keep the per-IP rate limit in place alongside it.

**Files:** `src/server/auth/agent-token.ts`, `src/shared/pow.ts`

### Spectator Delay for Organized Competitive Play

**Trigger:** organized matches or tournaments make real-time spectator leakage a
meaningful competitive risk.

Delay spectator-facing state/replay updates without affecting player latency.

**Files:** `src/server/game-do/broadcast.ts`,
`src/shared/engine/resolve-movement.ts`, replay/socket viewer paths

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
