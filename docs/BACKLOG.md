# Delta-V Backlog

Active work items are listed below in one global priority order.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

The list below is the output of a full project review aimed at "solid architecture first, then iterate on fun". Items are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) are the most likely to translate directly into a better experience; architecture-solidity items (P2) unblock confident iteration on P1.

**Recently shipped from the review pass:** early-turn nuke + parity-deficit guards in the shared AI (duel avg length 2.3 → 6.0 turns across seeded sweeps), structured reporting for LIVE_REGISTRY register/deregister and MCP observation timeouts, a `reportLifecycleEvent` helper wired to `game_started` / `game_ended` / `disconnect_grace_started` / `disconnect_grace_resolved` / `disconnect_grace_expired` / `turn_timeout_fired`, matchmaker `matchmaker_paired` + `matchmaker_pairing_split` events with a regression test covering the 409-collision log line, a 10 s MCP observation timeout (`Promise.race`) with structured reporting, error-code preservation in the WebSocket dispatch fallback, bounded-insertion-order idempotency key cache, seeded RNG made **required** on `aiAstrogation` / `aiOrdnance` (test sites use a local wrapper with a deterministic default), difficulty-aware lookahead RNG bias (easy 0.4 / normal 0.5 / hard 0.6), turn-1 `stalePhase` race fixed server-side (guard forgives stale expectedPhase when the action type is valid for the real phase) with a regression test, game-over modal Escape routing to Exit with keyboard regression test, `data-testid` attributes on `ship-entry` and `fleet-shop-item` with Playwright selectors swapped, Vitest client coverage thresholds (statements 60 / branches 55 / functions 65 / lines 60), load-harness error binning (`{http4xx, http5xx, rateLimited, actionRejected, timeout, invalidInput, authError, stateConflict, other}`), pre-commit and CI simulation iteration counts unified at 60, protocol fixtures expanded to cover all 15 C2S action types plus 7 negative fixtures, client bootstrap that keeps the JS-required fallback visible until boot succeeds, `warnOnce` on silent storage/telemetry failures, shared `MOBILE_BREAKPOINT_PX` used by tutorial / course renderer / UI media query, inline documentation for every AI difficulty knob, weak-gravity "definite-only" design made explicit at the movement call site, doc link hygiene for `AGENT_SPEC.md` / `AGENTS.md`, and a running "outstanding issues" header in `AGENT_IMPROVEMENTS_LOG.md`. Several backlog items turned out to be already correct on re-inspection (D0 capture rule, `replacedSockets` GC, intentional `idempotencyCache.clear` on state advance, single-threaded DO event-seq race, disconnect-grace enforcement at the HTTP join).

---

## P1 — Gameplay feel (the parts that don't work well yet)

### 1. Duel / quick-match pacing — further tuning pass

Current baseline (tip of main, 30 × 16 seeds, hard vs hard): mean avg turns 6.0 (range 4.9–7.2), seat 42.9% P0. Target remains ≥ 8 turns with stable seat balance. This is iterative tuning work that needs a dedicated session and sweep validation per edit.

- Re-measure with `npm run simulate:duel-sweep -- --iterations 50 --json-out ...` and `quickmatch:scrimmage --json-out` before the change.
- Try rule edits in small, measured increments: ordnance stock caps, scenario-specific fuel, or starting spread. Avoid naive geometry edits (a one-hex start move regressed P0/P1 badly in prior testing).
- Re-run the same sweep after the change and attach the diff (avgTurn mean, P0/decided mean, draw%) to the commit.

**Files:** `src/shared/scenario-definitions.ts`, `src/shared/scenario-capabilities.ts`, `scripts/simulate-duel-sweep.ts`

### 2. Extend a11y axe coverage to ordnance + logistics panels

The existing `test:e2e:a11y` spec asserts clean a11y for the menu / waiting lobby / HUD / help overlay. It does not exercise the ordnance or logistics panels because getting into those phases from scratch in a smoke test is non-trivial. Add a spec that plays a Biplanetary match to the ordnance phase and runs `runA11yCheck` on the HUD + transfer panel.

**Files:** `e2e/a11y.spec.ts`, `e2e/support/app.ts`

---

## P2 — Architecture solidity (unblocks P1 iteration)

### 3. Surface lifecycle events in OBSERVABILITY.md + D1 query examples

The structured lifecycle events shipped this pass (`game_started`, `game_ended`, `disconnect_grace_{started,resolved,expired}`, `turn_timeout_fired`, `matchmaker_paired`, `matchmaker_pairing_split`, `mcp_observation_timeout`, `live_registry_{register,deregister}_failed`) land in the D1 `events` table but aren't documented for operators. Add a section to [`OBSERVABILITY.md`](./OBSERVABILITY.md) listing each event with its props and a SQL snippet for common questions (average disconnect-grace duration, matchmaker split rate, game abandonment rate).

**Files:** `docs/OBSERVABILITY.md`

---

## P3 — Engine / AI refinements

_All P3 items from the prior pass shipped. New entries below only._

### 4. Tune the difficulty-aware lookahead bias empirically

The lookahead bias constants (easy 0.4, normal 0.5, hard 0.6) are reasonable priors but not measured. Once `simulate:duel-sweep` is the baseline tool, sweep {0.35 / 0.5 / 0.65} and {0.45 / 0.5 / 0.55} and pick the triple that maximises hard's win-rate against normal without collapsing easy's.

**Files:** `src/shared/ai/astrogation.ts` (`LOOKAHEAD_BIAS_BY_DIFFICULTY`), `scripts/simulate-duel-sweep.ts`

---

## P4 — Tooling, tests, docs (quality-of-life)

### 5. Full `data-testid` sweep on HUD controls

This pass swapped only the two class-based Playwright selectors (`.ship-entry`, `.fleet-shop-item`). The remaining ID-based selectors are stable today but would be less brittle as `data-testid`. Low priority.

**Files:** `src/client/ui/**`, `e2e/**`

### 6. E2E for matchmaker split retry

The split retry is covered by the `matchmaker-do.more.test.ts` 409-collision test and the new `matchmaker_pairing_split` regression log assertion. An e2e that actually spins up two browser contexts and queues both in quick-match would be stronger proof but requires shared worker state and is non-trivial.

**Files:** `e2e/support/app.ts`, new spec under `e2e/`

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
