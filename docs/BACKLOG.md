# Delta-V Backlog

Active work items are listed below in one global priority order.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

---

## Active work

### 1. Stabilize `npm run verify` coverage output

**Source:** [REVIEW_PLAN.md](./REVIEW_PLAN.md) section 1 review on 2026-04-04.

`npm run verify` still fails intermittently in `test:coverage` with `ENOENT` on `coverage/.tmp/coverage-*.json` after prior coverage runs. Pre-commit already works around this by removing `coverage/` first; `verify` should be made equally robust so the primary local/CI gate does not require manual cleanup.

**Files:** `package.json`, `.husky/pre-commit`, `vitest.config.ts`

### 2. Harden Durable Object alarm error handling

**Source:** [REVIEW_PLAN.md](./REVIEW_PLAN.md) section 5 review on 2026-04-04.

`runGameDoTurnTimeout()` catches engine failures and reschedules, but `runGameDoAlarm()` still lets unexpected errors in the `disconnectExpired` and `inactivityTimeout` branches bubble out of `GameDO.alarm()`. Add top-level catch/reschedule coverage so alarm failures do not skip cleanup, forfeit handling, or the next alarm.

**Files:** `src/server/game-do/alarm.ts`, `src/server/game-do/game-do.ts`, `src/server/game-do/alarm.test.ts`

### 3. Raise engine coverage below the review threshold

**Source:** [REVIEW_PLAN.md](./REVIEW_PLAN.md) section 4 review on 2026-04-04.

The latest clean coverage run still leaves executable engine modules below the review floor of 80% line coverage, notably `src/shared/engine/combat.ts` (73.59%) and `src/shared/engine/event-projector/conflict.ts` (70.58%). Add targeted tests for the uncovered branches or lower the risk another way with explicit justification.

**Files:** `src/shared/engine/combat.ts`, `src/shared/engine/event-projector/conflict.ts`, related `*.test.ts`

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

Baseline per-isolate rate limiting is already shipped (100 combined GET /join + /replay per 60s per IP). Add WAF or `[[ratelimits]]` only if the baseline proves insufficient.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`
