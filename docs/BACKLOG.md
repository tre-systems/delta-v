# Delta-V Backlog

Unfinished actionable work, in one global priority order. Shipped history lives in git; recurring review procedures live in [REVIEW_PLAN.md](./REVIEW_PLAN.md); architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

## Recently shipped (2026-04-18)

Single release batch on `main`: global `:focus-visible` and `.visually-hidden`; stronger placeholders and `prefers-contrast: more` / `forced-colors: active` baselines; HUD default|large text scale (localStorage + lobby controls + `html[data-hud-scale]` CSS); help overlay jump links + TOC styling; quick-match waiting elapsed time; scenario `lobbyMeta` rendered on lobby cards; difficulty `role="radiogroup"` and hint line; wider menu/scenario shell at ≥1024px; ship-list bottom fade when scrollable; larger burn/overload hit targets; chat character counter; reconnect reassurance copy; game-over rematch auto-focus; `#hudBoardSummary` live region for board context; Ko-fi image dimensions; shorter welcome tutorial line; `src/client/messages/notification-policy.ts` as documented channel names (runtime deduplication enforcement still open below). Toasts: dismiss control, hover/focus pause + CSS `animation-play-state` for info/success, errors persist with `role="alert"` until dismissed. Waiting **Cancel** after `cancelQuickMatch` calls `exitToMenu` when still not on `menu` (fixes private-room / join / post-match quick-match teardown); connecting copy shows **Cancel** with clearer titles.

---

## Gameplay UX & matchmaking integrity

Exploratory live-session notes (2026-04-17) plus UX/a11y review (2026-04-18). Many original bullets shipped in **[Recently shipped](#recently-shipped-2026-04-18)**; the list below is **still open** or needs a verification pass.

### Refine `:focus` vs `:focus-visible` on form controls

Global `:focus-visible` outlines exist in `base.css`. Some inputs still pair `outline: none` with `:focus` box-shadow in a way that also fires on mouse click. Prefer splitting keyboard vs pointer affordances where it still feels noisy.

**Files:** `static/styles/components.css`, `static/styles/hud.css`

### Contrast audit (quantified)

Several surfaces were brightened (e.g. duel queue note, game-over stat labels, chat/menu placeholders, `prefers-contrast: more` hooks). Remaining: measure against WCAG AA on every translucent panel, especially stacked `.help-group` copy; add explicit ratio checks to the release manual-test plan.

**Files:** `static/styles/*.css`, `docs/MANUAL_TEST_PLAN.md`, `docs/A11Y.md`

### Stronger high-contrast modes

Current `prefers-contrast: more` / `forced-colors: active` improve borders, placeholders, and key labels. Still open: opaque panel fills, reducing `backdrop-filter` where it hurts legibility, and broader `CanvasText` / `Canvas` usage under `forced-colors`.

**Files:** `static/styles/base.css`, `static/styles/components.css`, `static/styles/hud.css`, `static/styles/overlays.css`

### Tutorial: deepen task-first flow

Welcome copy was shortened; remaining: spotlight-driven steps, a repeatable "what do I do now?" affordance, and tighter coupling to HUD hints.

**Files:** `src/client/tutorial.ts`, `src/client/ui/hud-chrome-view.ts`, `static/index.html`, `static/styles/overlays.css`

### Help overlay: active-section highlighting (optional)

Jump links and TOC styling exist; optional follow-up: highlight the section in view on scroll, or collapse long groups with `<details>`.

**Files:** `static/index.html`, `static/styles/overlays.css`, optional small script in `src/client/ui/`

### Enforce notification channel precedence in code

`notification-policy.ts` documents channel names and order; routing is still by callsite convention. Add deduplication or guardrails when adding new player-visible messages.

**Files:** `src/client/ui/overlay-view.ts`, `src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`, `src/client/telemetry.ts`

### Archived replay: abort in-flight fetch on cancel

Join/spectate/quick-match connecting now exposes **Cancel** and tears down via `exitToMenu` when `cancelQuickMatch` is a no-op. Archived replay still runs `fetchArchivedReplay` without cancellation — if users navigate away mid-fetch, add an `AbortController` (or ignore late results when state is no longer `connecting`).

**Files:** `src/client/game/session-controller.ts`, `src/client/game/session-api.ts`, `src/client/game/main-session-network.ts`

### Digital-input parity for map selection and targeting

Core map interactions are still pointer-first: selecting combat targets, cycling mixed-hex attackers, and resolving some tactical choices depend on click/tap hex input. Add keyboard-first targeting and selection flows that expose the current focus in the HUD, and structure them so gamepad support can reuse the same command path instead of bolting on a second interaction model later.

**Files:** `src/client/game/keyboard.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud-chrome-view.ts`

### Replay transport: one visual language

`#replayNav` (glyph buttons) and `#replayBar` (icons) are never shown together, but markup and styling diverge. Unify appearance, spacing, and disabled rules, or retire the inline cluster if the bottom bar becomes the single transport surface.

**Files:** `static/index.html`, `src/client/game/replay-controller.ts`, `src/client/ui/overlay-view.ts`, `static/styles/overlays.css`

### Burn-arrow tap targets (verification)

Renderer geometry was enlarged; confirm ≥48px effective targets on narrow phones and extend hit slop in `input-interaction` if needed.

**Files:** `src/client/renderer/course.ts`, `src/client/renderer/vectors.ts`, `src/client/input-interaction.ts`

### Standardize scenario / label casing

HUD and menu buttons are uppercased via CSS `text-transform`, but scenario titles in `#scenarioList` are authored in mixed case ("Bi-Planetary") and then uppercased inconsistently. Pick one authoring style (prefer sentence case in HTML, CSS-uppercased in presentation) and apply uniformly.

**Files:** `static/index.html`, `src/client/ui/lobby-view.ts`, `static/styles/components.css`

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Ordered by expected blast radius on billing and auth integrity.

**Current baseline (already enforced):** see [SECURITY.md](./SECURITY.md) — join/replay hashed-IP GET throttles, WebSocket upgrade cap, per-socket message rate limit, chat throttle, telemetry POST caps, authoritative room creation, MCP two-token model with `AGENT_TOKEN_SECRET` fail-closed in production.

**Still backlog / trigger-gated:** WAF or `[[ratelimits]]` if baseline throttles prove insufficient; Turnstile on human name claim; proof-of-work on bulk agent name claims; spectator delay for serious competition. Concrete file hooks are listed under [Future features](#future-features-not-currently-planned) where applicable.

---

## Architecture & correctness

### Extract MCP adapter into a dedicated subpackage

Move hosted and local MCP surfaces into a separate workspace package (for example `packages/mcp-adapter`) with its own `package.json` so `@modelcontextprotocol/sdk` and `zod` are scoped to MCP integration instead of the core game/runtime package. Keep the existing MCP behavior and tool contracts unchanged while making the core app build path dependency-light.

**Files:** `packages/mcp-adapter/` (new), `src/server/mcp/handlers.ts`, `scripts/delta-v-mcp-server.ts`, `src/server/index.ts`, root `package.json`/workspace config, MCP docs

### Deterministic initial publication path

Route `initGameSession` through `runPublicationPipeline`, then remove the remaining `getActionRng()` fallbacks to `Math.random` in paths that should already have persistent match identity.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`, `src/shared/prng.ts`

### Replayable turn advancement

Make reinforcement and fleet-conversion side effects fully replayable by either emitting explicit turn-advance events or sharing one mutation implementation between the live engine and the event projector.

**Files:** `src/shared/engine/turn-advance.ts`, `src/shared/engine/victory.ts`, `src/shared/engine/event-projector/lifecycle.ts`, `src/shared/engine/engine-events.ts`

### Cached current-state projection (partial — checkpoint cleanup done)

Checkpoint pruning now happens inside `archiveCompletedMatch` after the R2 + D1 writes land, so completed matches no longer leave a permanent checkpoint in DO storage. The live-projection caching (avoid rebuilding current state from checkpoint + tail on every wake/read) remains — it requires an in-memory cache invalidated on every event append.

**Files:** `src/server/game-do/projection.ts`, `src/server/game-do/game-do.ts`

### Publication and broadcast safety rails

Replace coarse JSON-string parity failures with structured diffs, converge normalization between production and tests, make lower-level broadcast helpers private, and add an exhaustive S2C builder/broadcast check similar to the C2S action map.

**Files:** `src/server/game-do/publication.ts`, `src/server/game-do/broadcast.ts`, `src/server/game-do/message-builders.ts`, `src/server/game-do/archive.test.ts`

### Boundary hardening and explicit client seams

Hide clone-sensitive engine mutators behind non-exported modules, extend import-boundary enforcement to the missing directions, and finish the client kernel DI cleanup so `WebSocket` and `fetch` are injected rather than reached directly.

**Files:** `src/shared/engine/victory.ts`, `src/shared/engine/turn-advance.ts`, `src/shared/import-boundary.test.ts`, `src/server/import-boundary.test.ts`, `src/client/game/client-kernel.ts`, `src/client/game/connection.ts`, `src/client/game/session-api.ts`, `biome.json`

---

## Type safety & scenario definitions

### Close remaining stringly-typed registries and IDs

Add `isHexKey`, tighten scenario/body registries around closed keys, and brand ship / ordnance identifiers so lookup-heavy paths stop depending on plain `string`.

**Files:** `src/shared/hex.ts`, `src/shared/ids.ts`, `src/shared/map-data.ts`, `src/shared/types/domain.ts`, `src/server/room-routes.ts`, `src/server/game-do/http-handlers.ts`, `src/client/game/main-session-network.ts`

### Scenario and map validation

Validate scenario definitions and map data at load/game-creation time: conflicting rule combinations, unknown bodies, invalid spawn hexes, overlapping bodies, unreachable bases, and bounds that should be derived from body placement instead of hardcoded constants.

**Files:** `src/shared/map-data.ts`, `src/shared/map-layout.ts`, `src/shared/engine/game-creation.ts`, `src/shared/types/domain.ts`

### Standardized error surfaces and client recovery messaging

Prefer `engineFailure()` everywhere, then surface typed rate-limit / validation handling in the client so user-facing error behavior can branch on error code instead of generic text alone.

**Files:** `src/shared/engine/util.ts`, `src/shared/engine/astrogation.ts`, `src/shared/engine/ordnance.ts`, `src/shared/engine/logistics.ts`, `src/shared/engine/combat.ts`, `src/shared/types/domain.ts`, `src/server/game-do/socket.ts`, `src/client/game/connection.ts`, `src/client/game/message-handler.ts`

---

## Testing & client consistency

### Broaden engine and protocol coverage (partial)

Property tests for ordnance launch duplication/phase gating and logistics transfer validation shipped in `ordnance.property.test.ts` / `logistics.property.test.ts`. Remaining: positive C2S fixtures for edge combat/combat-single messages and negative-fixture protocol coverage for malformed payloads.

**Files:** `src/shared/__fixtures__/contracts.json`, `src/shared/protocol.test.ts`, `src/server/game-do/__fixtures__/transport.json`

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
