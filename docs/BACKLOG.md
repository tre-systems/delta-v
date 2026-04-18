# Delta-V Backlog

Unfinished actionable work, in one global priority order. Shipped history lives in git; recurring review procedures live in [REVIEW_PLAN.md](./REVIEW_PLAN.md); architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

## Recently shipped (2026-04-18)

Single release batch on `main`: global `:focus-visible` and `.visually-hidden`; stronger placeholders and `prefers-contrast: more` / `forced-colors: active` baselines; HUD default|large text scale (localStorage + lobby controls + `html[data-hud-scale]` CSS); help overlay jump links + TOC styling; quick-match waiting elapsed time; scenario `lobbyMeta` rendered on lobby cards; difficulty `role="radiogroup"` and hint line; wider menu/scenario shell at ≥1024px; ship-list bottom fade when scrollable; larger burn/overload hit targets; chat character counter; reconnect reassurance copy; game-over rematch auto-focus; `#hudBoardSummary` live region for board context; Ko-fi image dimensions; shorter welcome tutorial line; `src/client/messages/notification-policy.ts` as documented channel names (runtime deduplication enforcement still open below).

---

## Gameplay UX & matchmaking integrity

Findings from exploratory live-session testing on 2026-04-17 using paired quick-match queues, MCP sessions, and browser-driven player flows, plus a UX/UI and a11y review on 2026-04-18. Ordered by user impact and regression risk.

### Add `:focus-visible` indicator for buttons and the canvas

No global `:focus-visible` rule exists for `.btn` or `#gameCanvas`. Inputs have `outline: none` without a keyboard-focus ring replacement (only a `box-shadow` on `:focus`, which also fires on mouse click). Once a keyboard user tabs off an input they lose the focus indicator entirely — WCAG 2.4.7 (AA). Add a single tokenized rule using `var(--accent)` with 2px offset, then separate mouse-focus from keyboard-focus styling on inputs.

**Files:** `static/styles/components.css`, `static/styles/base.css`, `static/styles/hud.css`

### Raise low-contrast text and input placeholders to WCAG AA

Spot failures on translucent backgrounds:

- `.menu-surface-note` (11.84px `rgba(206, 220, 242, 0.68)`) — below 4.5:1
- `.code-input::placeholder` (`rgba(199, 212, 234, 0.3)`) — below 3:1 for UI component non-text contrast (WCAG 1.4.11)
- `.menu-profile-input::placeholder` (`rgba(199, 212, 234, 0.38)`) — same
- `.fate-card-detail` (0.58rem, muted) and `.go-stat-label` (0.56rem, muted) — sub-10px body text
- `.help-row` copy stacked on `.help-group` translucency

The axe suite already excludes `color-contrast`; add explicit ratio checks to the release manual-test plan, then tighten the token values or darken the surface behind them.

**Files:** `static/styles/components.css`, `static/styles/overlays.css`, `static/styles/base.css`, `docs/MANUAL_TEST_PLAN.md`, `docs/A11Y.md`

### Support `prefers-contrast` and `forced-colors`

No matches for either media query anywhere in `static/styles/`. Users on Windows High Contrast or macOS Increase Contrast get the full translucent-surface treatment with no fallback. Add a `@media (prefers-contrast: more)` block that drops backdrop-blur, opaques surfaces, thickens borders, and pushes text to full white/accent; add a `@media (forced-colors: active)` block that uses system colors for buttons and focus rings.

**Files:** `static/styles/base.css`, `static/styles/components.css`, `static/styles/hud.css`, `static/styles/overlays.css`

### Add player-facing large-text / HUD-scale presets

Live play depends on compact mono text across the HUD, ship list, latest-log bar, and help overlay, but there is no player-facing way to scale it up. Add at least `default` / `large` display presets that increase HUD copy, log text, utility-button hit areas, and any glyph-adjacent labels together, persist the choice in local storage, and cover the largest preset in the manual test plan.

**Files:** `static/index.html`, `static/styles/base.css`, `static/styles/hud.css`, `static/styles/overlays.css`, `src/client/ui/`, `src/client/web-local-storage.ts`, `docs/MANUAL_TEST_PLAN.md`

### Dismissible, pause-on-hover toasts

`.toast` animations are pure timers (`animation: toastIn 0.3s, toastOut 0.3s ease-in 2.7s forwards`). No close control, no `animation-play-state` pause on hover/focus, and errors share the same auto-dismiss as info. NN/g guidance: errors should persist until acknowledged; informational toasts should pause for hover/focus. Add a close affordance, pause semantics, and route errors through `role="alert"`.

**Files:** `static/styles/overlays.css`, `src/client/ui/` (toast view code), `static/index.html`

### Help overlay navigation

The help content is a single 560-px column with ten sections totaling ~4000 words. Candidates: sticky in-page ToC, tab strip across the top, or collapsible `<details>` per section (the DOM is already grouped by `.help-group`). Keep current content order; add jump affordance.

**Files:** `static/index.html` (help overlay markup), `static/styles/overlays.css`, optional JS for active-section highlighting

### First-session onboarding should be task-first, not prose-first

The current tutorial copy explains the system well, but first-time players still have to read and remember too much before acting. Rework onboarding around the next required action: spotlight the selected ship, burn arrows, and confirm control; keep each step to one short instruction plus one concept; reserve the deeper vector-movement explanation for later steps or the help reference. Add a repeatable "what do I do now?" affordance after the first-turn flow.

**Files:** `src/client/tutorial.ts`, `src/client/ui/hud-chrome-view.ts`, `static/index.html`, `static/styles/overlays.css`

### Consolidate notification channels with a precedence policy

Four overlapping surfaces can fire in the same turn: `#phaseAlert`, `#toastContainer`, `#logLatestBar`, and the HUD status text inside `#topBar`. Define a precedence — e.g. *phase change → phase-alert only; action outcome → toast; historical → log; dynamic instruction → HUD status* — and enforce in code so signals don't stack. Document which surface each engine event targets.

**Files:** `src/client/ui/overlay-view.ts`, `src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`, `src/client/telemetry.ts`, `docs/MANUAL_TEST_PLAN.md`

### Difficulty selector as `role="radiogroup"` + inline hint

Three buttons with an `.active` class that is mutually exclusive should announce as a radio group. Also add a one-line description under the active button so players know what changes between Easy/Normal/Hard (search depth, heuristics, or other). Applies to any similarly structured segmented controls.

**Files:** `static/index.html`, `src/client/ui/lobby-view.ts`, `static/styles/components.css`

### Quick Match queue state feedback

`#waitingStatus` currently pulses "Waiting for opponent…" with no elapsed time, no queue position, and `#cancelWaitingBtn` is hidden for the first N seconds. Add an elapsed counter and a visible "cancel search" button from the start so players can tell whether the queue is active.

**Files:** `static/index.html`, `src/client/game/session-controller.ts`, `src/client/ui/lobby-view.ts`

### Desktop menu layout and scenario picker

`.menu-content { width: min(430px, 100%) }` applies at every breakpoint — on ≥1024px the menu is a narrow phone column in a 1000-px dark void. Options: widen to ~640px at `min-width: 1024px`, or split into a two-column hero+form layout, or surface the scenario grid inline (bypass the scenario-select screen entirely for Quick Match / Play vs AI).

**Files:** `static/styles/components.css`, `static/styles/base.css`, `static/index.html`, `src/client/ui/lobby-view.ts`

### Add richer scenario comparison metadata

Scenario cards currently show name, tags, and a short description only. Add structured metadata so players can compare at a glance: recommended-for-new-players state, estimated length, complexity, and key mechanics such as fleet building, logistics, hidden information, or no combat. This should come from the scenario definition layer rather than hardcoded UI copy.

**Files:** `src/shared/scenario-definitions.ts`, `src/shared/types/scenario.ts`, `src/client/ui/lobby-view.ts`, `static/styles/components.css`

### Ship list overflow affordance

`.ship-list { scrollbar-width: none }` hides scrollbars and there is no fade mask at the top/bottom. In Fleet Action / Interplanetary War scenarios the list overflows its max-height with no visual cue. Add a top/bottom linear-gradient mask that fades when the list is scrollable.

**Files:** `static/styles/hud.css`, `src/client/ui/ship-list-view.ts`

### Verify burn-arrow tap target size on small devices

Manual review of the 375×812 mobile view shows burn arrows at roughly 40–44px, below Material 48dp and at the Apple HIG 44pt floor when packed in a cluster. Measure exact sizes in the renderer, then bump to ≥48px or add invisible padding to the hit region.

**Files:** `src/client/renderer/course.ts`, `src/client/renderer/vectors.ts`, `src/client/input-interaction.ts`

### Add digital-input parity for map selection and targeting

Core map interactions are still pointer-first: selecting combat targets, cycling mixed-hex attackers, and resolving some tactical choices depend on click/tap hex input. Add keyboard-first targeting and selection flows that expose the current focus in the HUD, and structure them so gamepad support can reuse the same command path instead of bolting on a second interaction model later.

**Files:** `src/client/game/keyboard.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud-chrome-view.ts`

### Game over polish: auto-focus Rematch, unify replay transports

Two distinct replay UIs exist: the `#replayNav` cluster inside `#gameOver` (First / Prev / Next / Last) and the bottom `#replayBar` (Prev / Play/Pause / Next with icons). Transport controls should align. Separately, auto-focus `#rematchBtn` on game-over so Enter starts the next match; keep `#exitBtn` reachable via Tab. Consider demoting Exit to a text link.

**Files:** `static/index.html`, `src/client/game/replay-controller.ts`, `src/client/ui/overlay-view.ts`, `static/styles/overlays.css`

### Reconnect overlay reassurance copy

`#reconnectOverlay` shows a spinner and "Reconnecting…". Add a reassuring line ("Your fleet and plotted burns are saved — we're restoring the match state"). Reduces panic during network wobble.

**Files:** `static/index.html`, `src/client/ui/overlay-view.ts`

### Layout stability for external Kofi image

`<img src="https://storage.ko-fi.com/…" height="32">` is missing an explicit `width`, plus it's an external CDN fetch. Causes CLS on slow connections. Add a `width` attribute matching the asset's intrinsic aspect ratio.

**Files:** `static/index.html`

### Chat character counter

`#chatInput` has `maxlength="200"` but silently rejects keystrokes at the cap. Add a subtle character counter visible at ≤ 20 remaining; announce through `aria-live="polite"` when the threshold is crossed.

**Files:** `static/index.html`, `static/styles/hud.css`, `src/client/ui/game-log-view.ts`

### Reconsider canvas `role="application"` semantics

`#gameCanvas` has `role="application"`, which drops NVDA out of browse mode. The current `aria-label` is descriptive but not authoritative. Evaluate: keep `application` but expose a hidden live region that narrates phase and selected-ship state, or switch to `role="img"` with `aria-describedby` pointing at a continuously updated summary. Product decision — document rationale either way in `docs/A11Y.md`.

**Files:** `static/index.html`, `src/client/ui/hud-chrome-view.ts` (live region updates), `docs/A11Y.md`

### Standardize button-label casing

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
