# Delta-V Backlog

Roadmap index and shipped history. Recurring review procedures live in [REVIEW_PLAN.md](./REVIEW_PLAN.md); architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

**Open roadmap** below is rolled up by priority theme (P1 gameplay/AI/agents, P2 architecture/types/tests). **Future features** stay trigger-gated and are not in the active queue.

## Recently shipped (2026-04-18)

Follow-up on `main`: hosted MCP moved to workspace package `@delta-v/mcp-adapter`; server agent-seat bot AI now defaults to **normal** (same as single-player / lobby) via `SERVER_AGENT_AI_DIFFICULTY` instead of a hard-coded `hard` path in `game-do`. UX/docs: scenario list titles CSS-uppercased; menu/join/chat focus rings on `:focus-visible` only (HUD chat ring matches menu strength; lobby HUD scale buttons 48px min height); notification-channel precedence helpers + tests; **phase banner** driven by `attachSessionPhaseAlertEffect` (`session-ui-effects.ts`) on aligned `playing_*` ↔ `gameState.phase` transitions (re-shows after `playing_movementAnim`); **toast dedupe** (`createToastDedupeGate` in `notification-policy.ts`, wired in `overlay-view.ts` `showToast`); **`preferNotificationChannel`** in `showToast` so **non-error toasts yield to an active phase alert**; `prefers-contrast: more` / `forced-colors: active` pass on full-screen `.screen`, menu shell, **`#menu` / `.menu-surface` / inputs** in `components.css`, game-over `.overlay-panel` (plus **forced-colors** outcome hues on `h2` / divider via `forced-color-adjust: none`), reconnect, toasts, tutorial tip, help/sound FABs, help TOC/groups, `#phaseAlert`, and **HUD** (`.hud-bar`, ship list / log, latest log bar, ship tooltip); manual test plan contrast spot-check section; game-over replay nav matches bottom replay bar (`replay-btn` + SVGs). Help overlay a11y: `show()` clears `aria-hidden` when an element is shown; lobby **How to Play** calls `hudChromeView.toggleHelpOverlay()` so overlay open/close matches the HUD (single handler on `#helpCloseBtn`). HUD **`#fleetStatus`**: `deriveHudViewModel` supplies `fleetStatusAriaLabel` (plain-language ordnance + fleet counts); `updateFleetStatus` passes it to `aria-label` on the span. Waiting **`#gameCode`**: `aria-live="polite"` / `aria-atomic="true"` in markup; lobby sets `aria-label` (spelled game code, quick-match status, or connecting placeholder). **Local stdio MCP:** `delta_v_send_action` with `waitForResult` resolves on S2C **`error`** with `{ accepted: false, reason, message }` (protocol errors wake the same waiters as state updates). **`queueForMatch`:** `normalizeQuickMatchServerUrl` maps `ws://` / `wss://` to `http://` / `https://` for REST; quick-match timeout error text suggests starting a second client or raising `timeoutMs`. **Docs:** [AGENTS.md](./AGENTS.md) adds hosted two-token walkthrough + `scripts/benchmark.ts` JSON field guide; [DELTA_V_MCP.md](./DELTA_V_MCP.md) links rate limits to [SECURITY.md](./SECURITY.md) §3; [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md) adds optional agent/MCP smoke checks.

**2026-04-17 agent/MCP batch:** `DEV_MODE=1` re-enables matchmaker **dev quick-match bot fill** (~10s lone-ticket pairing) for single-client local runs; agent-seat **bot think delay** raised to 15s before autoplayer acts; [DELTA_V_MCP.md](./DELTA_V_MCP.md) documents dev bot fill + stdio host serialization vs `mcp:delta-v:http`; `.claude/skills/play/SKILL.md` adds **`coachDirective`** guidance and splits **stdio vs hosted** MCP entry paths.

Single release batch on `main`: global `:focus-visible` and `.visually-hidden`; stronger placeholders and `prefers-contrast: more` / `forced-colors: active` baselines; HUD default|large text scale (localStorage + lobby controls + `html[data-hud-scale]` CSS); help overlay jump links + TOC styling; quick-match waiting elapsed time; scenario `lobbyMeta` rendered on lobby cards; difficulty `role="radiogroup"` and hint line; wider menu/scenario shell at ≥1024px; ship-list bottom fade when scrollable; larger burn/overload hit targets; chat character counter; reconnect reassurance copy; game-over rematch auto-focus; `#hudBoardSummary` live region for board context; Ko-fi image dimensions; shorter welcome tutorial line; `src/client/messages/notification-policy.ts` as documented channel names. Toasts: dismiss control, hover/focus pause + CSS `animation-play-state` for info/success, errors persist with `role="alert"` until dismissed. Waiting **Cancel** after `cancelQuickMatch` calls `exitToMenu` when still not on `menu` (fixes private-room / join / post-match quick-match teardown); connecting copy shows **Cancel** with clearer titles. Archived replay `fetch` is aborted when leaving to menu or starting another replay (`AbortSignal` + `releaseArchivedReplayFetchAbortIfMatches` guard). Asteroid column on the Other Damage table: rolls 5–6 are both D1 per 2018 rulebook (was D2 on 6). Security hardening: MCP JSON body cap 16 KB; committed `DEV_MODE=0` with local dev via `.dev.vars` (`DEV_MODE=1`, see `.dev.vars.example`); hosted MCP `matchToken` redemption requires `Authorization: Bearer`; `POST /quick-match` with `agent_…` `playerKey` requires a verified agent Bearer (shared `queueForMatch` mints via `/api/agent-token` first) so leaderboard `is_agent` is not prefix-spoofable; MCP enqueue sets an internal verified-agent header when the tool caller is authenticated.

---

## Open roadmap (rolled up)

Prior long-form bullets were folded here on **2026-04-17** so this file stays a lightweight index; spin fine-grained tasks from git history of `docs/BACKLOG.md` or from the theme anchors below when you start a slice.

### P1 — Gameplay UX & matchmaking

Contrast execution, forced-colors sweeps, tutorial/help depth, notification dedupe audits, keyboard-first targeting, burn-hit verification — `static/styles/*.css`, `src/client/tutorial.ts`, `src/client/messages/notification-policy.ts`, `src/client/game/session-ui-effects.ts`, `keyboard.ts`, `input.ts`, [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md), [A11Y.md](./A11Y.md).

### P1 — AI & rules conformance

Ordnance intercept simulation, nuke / `recommendedIndex` heuristics, rulebook parity checks, mine launcher self-hex, deterministic regression fixtures — `src/shared/ai/ordnance.ts`, `src/shared/engine/ordnance.ts`, `*.test.ts`, [Triplanetary2018.pdf](../Triplanetary2018.pdf).

### P1 — Agent & MCP ergonomics

Tool-surface unification (stdio vs hosted), `wait_for_turn` vs `get_observation` payload parity, default observation shape (avoid silent `state` compaction), one astrogation contract across engine + docs, scrimmage verified-agent defaults, MCP resources, structured ActionGuards outcomes, timeout auto-play surfacing, eventual removal of legacy `matchTarget` unions — `packages/mcp-adapter`, `scripts/delta-v-mcp-server.ts`, `src/server/game-do/mcp-handlers.ts`, `action-guards.ts`, [AGENT_SPEC.md](../AGENT_SPEC.md).

### P2 — Architecture, types, tests

Deterministic publication RNG, replayable turn advance, DO projection caching, publication/broadcast hardening, import/client DI cleanup, branded IDs + scenario validation, typed client errors, broader protocol fixtures — `src/server/game-do/*`, `src/shared/engine/*`, `import-boundary*.test.ts`, `contracts.json`.

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Ordered by expected blast radius on billing and auth integrity.

**Current baseline (already enforced):** see [SECURITY.md](./SECURITY.md) — join/replay hashed-IP GET throttles, WebSocket upgrade cap, per-socket message rate limit, chat throttle, telemetry POST caps, authoritative room creation, MCP two-token model with `AGENT_TOKEN_SECRET` fail-closed in production.

**Still backlog / trigger-gated:** WAF or `[[ratelimits]]` if baseline throttles prove insufficient; Turnstile on human name claim; proof-of-work on bulk agent name claims; spectator delay for serious competition. Concrete file hooks are listed under [Future features](#future-features-not-currently-planned) where applicable.

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

### Cloudflare Turnstile on human name claim

**Trigger:** logs show bulk human name-claim POSTs, or the beta opens to a larger audience.

Add Turnstile verification to `POST /api/claim-name`: include a site-key widget on the claim form, pass `turnstileToken` in the request, verify server-side via a `TURNSTILE_SECRET_KEY` binding before the name validation / upsert. Free, no tier cap. Endpoint is already structured to accept the extra field with no change to the success path.

**Files:** `src/server/auth/claim-name.ts`, `src/server/auth/turnstile.ts` (new), `static/index.html` + `src/client/` home screen, `wrangler.toml` (`TURNSTILE_SITE_KEY` public var, `TURNSTILE_SECRET_KEY` secret)

### Proof-of-work on first agent name claim

**Trigger:** logs show bulk agent-token issuance being used to farm leaderboard pseudonyms.

Symmetric in spirit to the Turnstile gate on human claims. Server issues a challenge; client submits a nonce whose hash beats a threshold. A few seconds of CPU for a legit agent, painful at bulk. No new infra or billing. Keep the per-IP rate limit in place alongside.

**Files:** `src/server/auth/agent-token.ts`, `src/shared/pow.ts` (new)

### Spectator delay for organized competitive play

**Trigger:** organized matches or tournaments make real-time spectator leakage a meaningful competitive risk.

Delay spectator-facing state/replay updates without affecting player latency.

**Files:** `src/server/game-do/broadcast.ts`, `src/shared/engine/resolve-movement.ts`, replay/socket viewer paths

### Populate Help overlay screenshots

**Trigger:** UI/UX is frozen enough that in-game screenshots won't go stale in the next release cycle.

Six `.help-screenshot` placeholder blocks in `#helpOverlay` currently render as dashed boxes containing descriptive notes of what each image should show (ship + burn arrows, gravity well, combat result popup, fleet builder, mines/torpedoes, in-game HUD with labels). Once the UI settles, capture screenshots at 2x DPI, optimize to WebP + PNG fallback, and replace each placeholder with an `<img>` (with `alt` text from the current placeholder copy). Keep the `.help-screenshot` CSS for the final frame/caption styling.

**Files:** `static/index.html` (lines ~311, 323, 361, 386, 403, 468), `static/styles/overlays.css` (`.help-screenshot`), new image assets under `static/help/`

### OpenClaw SKILL.md on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so any OpenClaw agent auto-acquires Delta-V capability. Depends on the remote MCP endpoint and `agentToken` issuance above.

**Files:** external publish; skill body references remote MCP endpoint
