# Delta-V Backlog

Outstanding tasks only — **no release log** (use `git log` for shipped work). Recurring review procedures: [REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale: [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

## Gameplay UX & matchmaking integrity

Exploratory live-session notes (2026-04-17) plus UX/a11y review (2026-04-18). Items below are **open** or **partial** (still need follow-up or verification).

### Contrast audit (quantified)

Several surfaces were brightened (e.g. duel queue note, game-over stat labels, chat/menu placeholders, `prefers-contrast: more` hooks). **Partial (2026-04-18):** [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md) now has a **Contrast & readability** section with explicit WCAG AA spot-check steps for help overlay and game-over; [A11Y.md](./A11Y.md) manual checklist links there. Remaining: execute the measurements each release and tune CSS from findings.

**Files:** `static/styles/*.css`, `docs/MANUAL_TEST_PLAN.md`, `docs/A11Y.md`

### Stronger high-contrast modes

**Partial (2026-04-18):** full-screen `.screen` and `.menu-content` use opaque fills with blur off under `prefers-contrast: more`; same plus `Canvas` / `CanvasText` under `forced-colors: active`. Overlays: game-over `.overlay-panel`, reconnect scrim, toasts, tutorial tip, help/sound buttons, help TOC/groups; systems `#phaseAlert` — blur removed and backgrounds solid or system-paired.

**Partial (2026-04-18):** `hud.css` — HUD bar, bottom buttons, ship entries, game log, latest log bar, and ship tooltip drop `backdrop-filter` under `prefers-contrast: more` / `forced-colors: active` with opaque or system fills.

**Partial (2026-04-18):** `components.css` — `#menu` gradient stack and decorative `::before` / `::after` toned down or removed under forced-colors; `#menu .menu-content`, `.menu-surface`, profile / join code inputs, and `.scenario-tag` use opaque or system (`Canvas` / `Field`) fills for legibility.

**Partial (2026-04-18):** game-over outcome `h2` titles and `.game-over-divider` use `forced-color-adjust: none` under `forced-colors: active` so victory / defeat / neutral author colors remain visible on top of the system `Canvas` panel.

**Still open:** spot-check other screens that reuse `.menu-content` without `#menu` (already covered in `base.css` `.screen`); optional follow-up if any game-over chrome beyond the hero still reads as flat in strict HC themes.

**Files:** `static/styles/base.css`, `static/styles/components.css`, `static/styles/hud.css`, `static/styles/overlays.css`, `static/styles/systems.css`

### Tutorial: deepen task-first flow

Welcome copy was shortened; remaining: spotlight-driven steps, a repeatable "what do I do now?" affordance, and tighter coupling to HUD hints.

**Files:** `src/client/tutorial.ts`, `src/client/ui/hud-chrome-view.ts`, `static/index.html`, `static/styles/overlays.css`

### Help overlay: active-section highlighting (optional)

Jump links and TOC styling exist; optional follow-up: highlight the section in view on scroll, or collapse long groups with `<details>`.

**Files:** `static/index.html`, `static/styles/overlays.css`, optional small script in `src/client/ui/`

### Enforce notification channel precedence in code

**Partial (2026-04-18):** `notification-policy.ts` exports `NOTIFICATION_CHANNEL_PRECEDENCE`, `notificationChannelPrecedenceIndex`, and `preferNotificationChannel` so call sites can resolve conflicts without duplicating ordering; Vitest covers ordering and ties. **`createToastDedupeGate`** suppresses identical non-error toasts within a short window (`overlay-view.ts` `showToast`); errors are never dropped. **`showToast`** skips **info/success** while the phase alert banner is visible (`preferNotificationChannel('toast', 'phaseAlert')`).

**Partial (2026-04-18):** `attachSessionPhaseAlertEffect` calls `overlay.showPhaseAlert` when the client enters `playing_astrogation` / `ordnance` / `logistics` / `combat` and `gameState.phase` matches (skips mismatches during animation, dedupes stable `(phase, turn, activePlayer)` until leaving those modes).

**Still open:** audit HUD status line + game log vs toast for duplicate **copy** on the same tick; `preferNotificationChannel` helpers are available at call sites.

**Files:** `src/client/messages/notification-policy.ts`, `src/client/ui/overlay-view.ts`, `src/client/game/session-ui-effects.ts`, `src/client/game/session-signals.ts`, `src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`, `src/client/telemetry.ts`

### Digital-input parity for map selection and targeting

Core map interactions are still pointer-first: selecting combat targets, cycling mixed-hex attackers, and resolving some tactical choices depend on click/tap hex input. Add keyboard-first targeting and selection flows that expose the current focus in the HUD, and structure them so gamepad support can reuse the same command path instead of bolting on a second interaction model later.

**Files:** `src/client/game/keyboard.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud-chrome-view.ts`

### Burn-arrow tap targets (verification)

Renderer burn/overload **disks** are visual; **astrogation picks still resolve by hex** (`resolveBurnToggle` / `resolveOverloadToggle` in `input.ts` — click targets the neighboring **cell**, not only the painted circle). At default zoom that is typically ≥48px; on very small `hexSize` viewports the cell can shrink — revisit only if playtesting reports misses.

**Files:** `src/client/renderer/course.ts`, `src/client/renderer/vectors.ts`, `src/client/game/input.ts`, `src/client/input-interaction.ts`

---

## AI behavior & rules conformance

Findings from a 2026-04-18 deep-research pass against the [2018 Triplanetary rulebook](../Triplanetary2018.pdf) (pp. 5-6) plus the AI ordnance code path. User-visible symptom: AI fires ordnance wildly and drops nukes for no apparent reason. The rulebook makes clear that hitting is meant to be hard because of *vector geometry over a 5-turn window*, not the damage table — several AI gates skip that geometry entirely.

### `recommendedIndex` over-suggests consecutive ordnance launches

**Partial (2026-04-18):** candidate ranking now checks for consecutive-turn ordnance pressure (own active ordnance at `turnsRemaining === 4`) and demotes low-confidence follow-up ordnance recommendations behind `skipOrdnance`. Confidence is based on per-launch intercept projection (`evaluateOrdnanceLaunchIntercept`): nukes must have short-fuse intercepts (≤2 turns), torpedoes ≤3 turns. This keeps `recommendedIndex` from reflexively chaining weak follow-up launches while still allowing high-quality opportunities.

**Update (2026-04-18):** when `includeCandidateLabels` is on, `labeledCandidates` ordnance entries append the same short-intercept rationale so agents see why a follow-up may trail skip/emplace.

**Still open:** tune thresholds with simulation outcomes (especially scenario-specific target velocities / gravity lanes).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/agent/observation.ts`, `src/shared/agent/candidates.ts`, `src/shared/agent/candidate-labels.ts`

### Tighten Hard-difficulty nuke gates with cost and intercept probability

Hard difficulty currently fires nukes whenever target score ≥70, OR enemy stronger and ≤6 hexes, OR target carries passengers and ≤6 hexes. Misses three rulebook factors: nukes cost **300 MCr** (15× a torpedo), can be shot down at **2:1 odds** with full range/velocity modifiers (p.6), and detonate on contact with **any** ship / base / asteroid / mine / torpedo (friendly-fire risk). Add an expected-damage estimate that nets out anti-nuke intercept odds and disqualifies launches whose vector passes through friendly hexes.

**Mitigations shipped (2026-04-18):** `assessNukeBallisticToEnemy` extends the existing 5-turn ballistic intercept stepper with per-turn friendly-ship motion; any ordnance path / ally path intersection suppresses the nuke. Hard tier also applies `nukeMinReachProbability` (default **0.22**): grouped anti-nuke volley destroy probability is derived from the same `ANTI_NUKE_ODDS`, range, and velocity modifiers as `resolveAntiNukeAttack`, then compounded across the modelled intercept window. **Still open:** explicit 300 MCr vs torpedo trade-off in scoring, bases/asteroids/mines/torpedoes on the lane, and tuning against `simulate:duel-sweep` measurements.

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/engine/combat.ts`

### Audit four subtle ordnance/combat rules for drift from 2018 rulebook

**Verified (2026-04-18):** Code review plus regression tests in `src/shared/combat.test.ts` (`Triplanetary 2018 gun combat geometry`) lock **closest-approach range** (`computeRangeModToTarget` + `lastMovementPath`) and **velocity modifier threshold** (`VELOCITY_MODIFIER_THRESHOLD` / `computeVelocityModToTarget`). **Torpedo eligibility** matches `SHIP_STATS.canLaunchTorpedoes` (warships + orbital bases only; packet/civilians false) and `validateShipOrdnanceLaunch` in `src/shared/engine/util.ts`. **One ordnance per ship per ordnance phase** is enforced in `processOrdnance` (`launchedShips` set) and property-tested in `src/shared/ordnance.property.test.ts`. AI torpedo launches go through the same `validateOrdnanceLaunch` path.

**Files:** `src/shared/combat.ts`, `src/shared/combat.test.ts`, `src/shared/engine/astrogation.ts`, `src/shared/engine/util.ts`, `src/shared/ordnance.property.test.ts`, `src/shared/ai/ordnance.ts`

### Add ordnance AI regression fixtures for impossible-shot launches

**Partial (2026-04-18):** `driftingEnemyWouldBeHitByOpenSpaceBallistic` + `EMPTY_SOLAR_MAP` in `test-helpers.ts` now back fixtures that assert hard AI **does not** launch torpedoes/nukes when no 5-turn open-space intercept exists. **Update (same pass):** regression tests cover friendly-lane nuke suppression and grouped anti-nuke EV gating. **Still open:** same-stack edge cases beyond launch-hex stacking, fixtures on real `buildSolarSystemMap()` gravity geometries, and optional `game-engine.test.ts` integration seeds.

**Files:** `src/shared/ai.test.ts`, `src/shared/test-helpers.ts`, `src/shared/test-helpers.test.ts`, optional `src/shared/engine/game-engine.test.ts`

---

## Agent & MCP ergonomics

Findings from a 2026-04-18 agent/MCP experience review. The contract is strong — AGENT_SPEC.md, pre-computed `candidates[]`, labelled observations, two-token auth, ActionGuards forgiveness — but the MCP surface has grown in two places (local stdio MCP in `scripts/delta-v-mcp-server.ts` and hosted `@delta-v/mcp-adapter`) and a handful of per-turn affordances still cost extra round-trips or external doc reads. Ordered by blast radius on agent experience.

### Parallel MCP stdio: host tool pipelining + quick-match pairing

**Mitigations shipped:** local HTTP MCP for multi-process concurrency; stdio outbound **send queue** so concurrent tool *completions* cannot interleave JSON-RPC lines on stdout ([DELTA_V_MCP.md](./DELTA_V_MCP.md)); inbound requests are already dispatched concurrently by the MCP SDK (handlers are not awaited before reading the next stdin line).

**Partial (2026-04-18):** operational workarounds for serial hosts / orphan pairing / `DEV_MODE` bot seats are documented in [DELTA_V_MCP.md](./DELTA_V_MCP.md) (stdio quick match notes). **Still open:** a first-class “pair these two tickets” dev hook if product wants automated two-seat stdio without lobby URLs.

**Files:** `scripts/delta-v-mcp-server.ts`, `src/shared/mcp-stdio-serialized-send.ts`, `src/shared/agent/quick-match.ts`, `docs/DELTA_V_MCP.md`

### Unify local and hosted MCP tool surfaces

Local stdio exposes `delta_v_quick_match_connect` plus `delta_v_list_sessions`, `delta_v_get_events`, `delta_v_close_session`; hosted MCP exposes `delta_v_quick_match` (matchToken) and lacks the session tools. An agent that learns one surface does not port to the other without rewriting. Pick one name for the quick-match entry point (or have one delegate to the other), and decide whether session/event buffering belongs on the hosted side — remote agents on flaky networks benefit from server-side event buffers, so porting `get_events` and `close_session` to hosted is the higher-value direction.

**Partial (2026-04-18):** local stdio now exposes `delta_v_quick_match` as an alias of `delta_v_quick_match_connect`, and hosted MCP now exposes `delta_v_quick_match_connect` as an alias of `delta_v_quick_match`. Agents can call either name on both transports; payload models still differ (local session-oriented `sessionId`/`code`/`playerToken` vs hosted `matchToken`).

**Files:** `scripts/delta-v-mcp-server.ts`, `packages/mcp-adapter/src/handlers.ts`, `docs/DELTA_V_MCP.md`, `AGENT_SPEC.md`

### Pick one astrogation turn contract and derive the surfaces from it

**Mitigations shipped (2026-04-18):** the engine has always gated astrogation on `activePlayer`; local stdio `delta_v_wait_for_turn` now uses the same `isActionable` contract as hosted MCP (`fleetBuilding` only for both seats). `checkActionGuards` now applies `wrongActivePlayer` in astrogation so auto-stamped guards reject the inactive seat early (matches dispatch behaviour). `AGENT_SPEC.md` §5.1, `.claude/skills/play/SKILL.md`, hosted adapter tool copy, and `mcp-handlers` comments no longer claim simultaneous / pre-submittable astrogation. `static/agent-playbook.json` already described sequential astrogation by `activePlayer`.

**Still open:** if product ever wants true pre-submitted astrogation, that requires an explicit engine + protocol change — today’s contract is sequential only after fleet building.

**Files:** `scripts/delta-v-mcp-server.ts`, `src/server/game-do/mcp-handlers.ts`, `src/server/game-do/action-guards.ts`, `src/shared/engine/util.ts`, `static/agent-playbook.json`, `AGENT_SPEC.md`, `.claude/skills/play/SKILL.md`, `docs/DELTA_V_MCP.md`, `packages/mcp-adapter/src/handlers.ts`

### Ship MCP resources: rules, match log, replay

[AGENT_SPEC.md lines 91–96](../AGENT_SPEC.md) lists `game://rules/current`, `game://rules/{scenario}`, `game://matches/{id}/observation`, `game://matches/{id}/log`, `game://matches/{id}/replay`, `game://leaderboard/agents` as first-class MCP resources; none are served yet. The rules resource has the highest payoff — agents currently either bake rules into the skill body (`/play`) or re-read `/.well-known/agent.json` + `/agent-playbook.json` every session. Serving the same content as a listable MCP resource lets hosts cache it and skip repeated fetches.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/delta-v-mcp-server.ts`, `static/.well-known/agent.json`, `src/shared/agent/`

### Structured action-rejection reasons

`checkActionGuards` in `src/server/game-do/action-guards.ts` rejects with a `reason` + human `message`, but the surface seen by agents mixes several causes (`expectedTurn` vs `expectedPhase` vs `wrongActivePlayer`, plus engine-level invalidations). Return a discriminated `{ reason, expected, actual }` so agents can branch without parsing strings. The smart-forgiveness path (phase stale but action type valid for the current phase) should also surface as a distinct reason when it fires, so agents can tell "you got lucky" from "you are in sync."

**Files:** `src/server/game-do/action-guards.ts`, `src/shared/types/domain.ts`, `packages/mcp-adapter/src/handlers.ts`, `scripts/delta-v-mcp-server.ts`

### Retire legacy `{code, playerToken}` tool args once leaderboard stabilises

Hosted MCP tools still accept either `matchToken` or `{code, playerToken}` via `matchTargetSchema` in `packages/mcp-adapter/src/handlers.ts`. Carrying both doubles tool-args surface area and forces every call site to branch on auth mode. Once the public leaderboard is live and all active agents have migrated to `matchToken`, drop the legacy union and simplify the adapter — consistent with the pre-launch-deletions stance elsewhere.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/quick-match-agent.ts`, `scripts/llm-player.ts`, `docs/DELTA_V_MCP.md`

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Ordered by expected blast radius on billing and auth integrity.

**Current baseline (already enforced):** see [SECURITY.md](./SECURITY.md) — join/replay hashed-IP GET throttles, WebSocket upgrade cap, per-socket message rate limit, chat throttle, telemetry POST caps, authoritative room creation, MCP two-token model with `AGENT_TOKEN_SECRET` fail-closed in production.

**Still backlog / trigger-gated:** WAF or `[[ratelimits]]` if baseline throttles prove insufficient; Turnstile on human name claim; proof-of-work on bulk agent name claims; spectator delay for serious competition. Concrete file hooks are listed under [Future features](#future-features-not-currently-planned) where applicable.

---

## Architecture & correctness

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

Property tests for ordnance launch duplication/phase gating and logistics transfer validation shipped in `ordnance.property.test.ts` / `logistics.property.test.ts`. Gun-combat geometry invariants (range path, velocity threshold, torpedo-capable hull set) are regression-locked in `combat.test.ts`. **`c2sRejected`** in `contracts.json` now includes extra malformed **combat** / **combatSingle** rows (wrong `attacks` type, missing `attack`, non-object `attack`). Remaining: positive C2S fixtures for edge combat/combat-single messages and broader negative coverage beyond the curated set.

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
