# Delta-V Backlog

Active work items are listed below in one global priority order.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

The list below is the output of a full project review aimed at "solid architecture first, then iterate on fun". Items are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) are the most likely to translate directly into a better experience; architecture-solidity items (P2) unblock confident iteration on P1.

**Recently shipped from the review pass:** early-turn nuke + parity-deficit guards in the shared AI (duel avg length 2.3 → 6.0 turns across seeded sweeps), structured reporting for LIVE_REGISTRY register/deregister and MCP observation timeouts, a `reportLifecycleEvent` helper wired to `game_started` / `game_ended` / `disconnect_grace_started` / `disconnect_grace_resolved` / `disconnect_grace_expired` / `turn_timeout_fired`, matchmaker `matchmaker_paired` + `matchmaker_pairing_split` events with a regression test covering the 409-collision log line, a 10 s MCP observation timeout (`Promise.race`) with structured reporting, error-code preservation in the WebSocket dispatch fallback, bounded-insertion-order idempotency key cache, seeded RNG made **required** on `aiAstrogation` / `aiOrdnance` (test sites use a local wrapper with a deterministic default), difficulty-aware lookahead RNG bias (easy 0.4 / normal 0.5 / hard 0.6), turn-1 `stalePhase` race fixed server-side (guard forgives stale expectedPhase when the action type is valid for the real phase) with a regression test, game-over modal Escape routing to Exit with keyboard regression test, `data-testid` attributes on `ship-entry` and `fleet-shop-item` with Playwright selectors swapped, Vitest client coverage thresholds (statements 60 / branches 55 / functions 65 / lines 60), load-harness error binning (`{http4xx, http5xx, rateLimited, actionRejected, timeout, invalidInput, authError, stateConflict, other}`), pre-commit and CI simulation iteration counts unified at 60, protocol fixtures expanded to cover all 15 C2S action types plus 7 negative fixtures, client bootstrap that keeps the JS-required fallback visible until boot succeeds, `warnOnce` on silent storage/telemetry failures, shared `MOBILE_BREAKPOINT_PX` used by tutorial / course renderer / UI media query, inline documentation for every AI difficulty knob, weak-gravity "definite-only" design made explicit at the movement call site, doc link hygiene for `AGENT_SPEC.md` / `AGENTS.md`, and a running "outstanding issues" header in `AGENT_IMPROVEMENTS_LOG.md`. Several backlog items turned out to be already correct on re-inspection (D0 capture rule, `replacedSockets` GC, intentional `idempotencyCache.clear` on state advance, single-threaded DO event-seq race, disconnect-grace enforcement at the HTTP join).

**Also shipped in this pass:** operator-facing documentation of every structured server event in [`OBSERVABILITY.md`](./OBSERVABILITY.md) with copy-pastable D1 queries (lifecycle cadence, disconnect-grace outcomes, matchmaker split rate, MCP timeout, LIVE_REGISTRY failures, turn-timeout by phase) and new alert-threshold guidance; an empirical bias sweep harness (`scripts/ai-bias-sweep.ts`) that measured the passenger-escort lookahead bias across 7 triples × 480 games — result: **bias knob is effectively inert on tested scenarios** (the lookahead code path is too narrow geometrically to dominate AI-vs-AI outcomes), so the priors stay put; a measured duel pacing attempt that found no single-lever tweak (ordnance type restriction, zero starting velocity, away velocity) cleanly reaches the 8-turn target without trading away seat balance — documented as needing a multi-lever design pass; extended a11y axe coverage to fleet-building and the desktop log panel; and a two-browser quick-match pairing e2e that proves the full UI → matchmaker → GameDO → WebSocket path end-to-end.

---

## P1 — Gameplay feel (the parts that don't work well yet)

### 1. Duel / quick-match pacing — multi-lever design pass

Current baseline (tip of main, 30 × 16 seeds, hard vs hard): mean avg turns 6.0 (range 4.9–7.2), seat 42.9% P0. Target ≥ 8 turns with stable seat balance.

**Measured this pass (not shipped — data for the next attempt):**

| Change | avgTurns | P0/decided |
|---|---|---|
| Baseline (current) | 6.0 | 42.9% |
| `allowedOrdnanceTypes: ['mine','torpedo']` (no nukes) | 6.2 | 41.5% |
| `allowedOrdnanceTypes: ['mine']` only | 6.1 | 39.8% |
| Zero starting velocity | 4.6 | 34.4% (both regressed) |
| Outbound velocity (ships drift apart) | 6.7 | 54.0% (balance regressed) |
| No nukes + outbound velocity | 6.6 | 54.9% |

Conclusion: no safe single-lever edit reaches 8 turns. The next pass needs coordinated changes (likely a combination of scoring-weight tuning in `AI_CONFIG` to reward braking + defensive play, plus a scenario rule) rather than tweaking geometry alone. Start from the per-ship scoring weights (`combatClosingWeight`, `combatSpeedDiffPenalty`, `combatVelocityPenalty`) rather than map/fleet data.

**Files:** `src/shared/scenario-definitions.ts`, `src/shared/ai/config.ts`, `scripts/duel-seed-sweep.ts`

---

## P2 — Architecture solidity (unblocks P1 iteration)

_All P2 items from the prior passes shipped, including the lifecycle-event documentation and D1 query examples._

---

## P3 — Engine / AI refinements

_All P3 items from the prior pass shipped. The difficulty-aware lookahead bias sweep (via `scripts/ai-bias-sweep.ts`) showed the knob is effectively inert — the passenger-escort lookahead path is too narrow geometrically to influence AI-vs-AI outcomes on the scenarios tested. The priors (easy 0.4 / normal 0.5 / hard 0.6) are kept as sensible defaults; future work can revisit if the lookahead's trigger conditions widen._

---

## P4 — Tooling, tests, docs (quality-of-life)

### 2. Full `data-testid` sweep on HUD controls

Only the two class-based Playwright selectors were swapped (`.ship-entry`, `.fleet-shop-item`). The remaining ID-based selectors are stable today and have no current refactor driver, so a blanket conversion is busy-work. Low priority.

**Files:** `src/client/ui/**`, `e2e/**`

---

## Future features (not currently planned)

These items are potential future work that depend on product decisions or external triggers. They are not in the active queue.

### Public matchmaking with longer room identifiers

**Trigger:** product moves beyond shared short codes.

Implement longer opaque room IDs or signed invites and update the join/share UX accordingly.

**Files:** `src/server/protocol.ts`, lobby and join UI, share-link format

### Trusted HTML sanitizer for user-controlled markup

**Trigger:** chat, player names, or modded scenarios render as HTML.

Add a single sanitizer boundary (e.g. DOMPurify inside `dom.ts`) and route all user-controlled markup through it. The trusted HTML boundary (`setTrustedHTML`) already exists for internal strings.

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### WAF or Cloudflare rate limits for join/replay probes

**Trigger:** distributed scans wake durable objects or cost too much.

Baseline per-isolate rate limiting is already shipped (100 join-style GETs including `/join`, quick-match ticket polling, and `/api/matches` per 60s per IP; **250** `/replay` GETs per 60s on a separate counter). Add WAF or `[[ratelimits]]` only if the baseline proves insufficient.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Public agent leaderboard with Elo

**Trigger:** account / persistent-identity system exists.

Depends on accounts (out of scope for beta per `BETA_READINESS_REVIEW.md`). When unblocked, expose Elo, win/loss by reason, action-validity and latency metrics per agent `playerKey`. Flag coached matches separately.

**Files:** `src/server/leaderboard/` (new), new `/leaderboard` route, D1 schema additions

### OpenClaw SKILL.md on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so any OpenClaw agent auto-acquires Delta-V capability. Depends on the remote MCP endpoint and `agentToken` issuance above.

**Files:** external publish; skill body references remote MCP endpoint
