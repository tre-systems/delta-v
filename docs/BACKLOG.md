# Delta-V Backlog

Active work items are listed below in one global priority order.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

---

## Active work

These are the **only** tracked open items from the architecture / hardening pass. They do **not** block UX or gameplay iteration unless you choose to prioritize them. (1) is “when we tune duel/quick-match feel”; (2) is optional load/observability; (3) is SPEC work when product asks.

1. **Duel / quick-match pacing (data-driven).** Use `quickmatch:scrimmage --json-out` (includes `quickMatchPairingSplitRetries`) to measure turn distributions and pairing retries, and **`npm run simulate:duel-sweep`** for multi-seed duel AI-vs-AI balance/pacing tables before rule edits. **Geometry tweaks need simulation sweeps** (a naive one-hex start move regressed P0/P1 badly in harness testing). Prefer `ScenarioRules` / ordnance stocks / queue presets once a change shows higher median turns *and* stable seat balance across seeds.

2. **Optional: stress-test MatchmakerDO** under parallel quick-match enqueue (many pairs) or add a scheduled job that alerts when `quickMatchPairingSplitRetries` is often ≥2 in production exports. **Coverage added:** sequential two-wave human pairing and 409→retry room allocation (`matchmaker-do.more.test.ts`).

3. **SPEC / engine follow-ups (bounded).** Contact geometry and dummy-counter logistics remain as documented in [SPEC.md](./SPEC.md); add tests or rules changes only when product prioritizes them.

**Shipped from the prior architecture pass:** split join vs replay rate limits; WebSocket connect failure telemetry + clearer toasts; CI Playwright a11y; Vitest `environmentMatchGlobs` for `src/client/**` + lazy telemetry `anonId`; structured `actionRejected` client handling; `dist/version.json` build artifact; [COORDINATED_RELEASE_CHECKLIST.md](./COORDINATED_RELEASE_CHECKLIST.md); OBSERVABILITY + SECURITY rate-limit updates; registry test for every `GAME_STATE_ACTION_TYPES` handler; [BETA_READINESS_REVIEW.md](../BETA_READINESS_REVIEW.md) refresh.

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
