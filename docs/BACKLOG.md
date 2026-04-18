# Delta-V Backlog

Outstanding tasks only — **no release log** (use `git log` for shipped work). Recurring review procedures: [REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale: [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

## Gameplay UX & matchmaking integrity

Exploratory live-session notes (2026-04-17) plus UX/a11y review (2026-04-18). Items below are **open** or **partial** (still need follow-up or verification).

### Contrast audit (quantified)

Several surfaces were brightened (e.g. duel queue note, game-over stat labels, chat/menu placeholders, `prefers-contrast: more` hooks). **Partial (2026-04-18):** [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md) now has a **Contrast & readability** section with explicit WCAG AA spot-check steps for help overlay and game-over; [A11Y.md](./A11Y.md) manual checklist links there. Remaining: execute the measurements each release and tune CSS from findings.

**Files:** `static/styles/*.css`, `docs/MANUAL_TEST_PLAN.md`, `docs/A11Y.md`

### Stronger high-contrast modes

**Partial (2026-04-18):** `prefers-contrast: more` and `forced-colors: active` now use opaque / system fills and drop decorative blur across `.screen`, `.menu-content`, HUD, overlays (game-over, reconnect, toasts, tutorial, help), `#phaseAlert`, and menu chrome (`components.css` / `hud.css` / `overlays.css` / `systems.css`). Game-over hero titles keep author colors via `forced-color-adjust: none`.

**Still open:** spot-check any `.menu-content` surfaces off `#menu` and remaining game-over chrome in strict HC if playtesters report flat contrast.

**Files:** `static/styles/base.css`, `static/styles/components.css`, `static/styles/hud.css`, `static/styles/overlays.css`, `static/styles/systems.css`

### Tutorial: deepen task-first flow

Welcome copy was shortened; remaining: spotlight-driven steps, a repeatable "what do I do now?" affordance, and tighter coupling to HUD hints.

**Files:** `src/client/tutorial.ts`, `src/client/ui/hud-chrome-view.ts`, `static/index.html`, `static/styles/overlays.css`

### Help overlay: active-section highlighting (optional)

Jump links and TOC styling exist; optional follow-up: highlight the section in view on scroll, or collapse long groups with `<details>`.

**Files:** `static/index.html`, `static/styles/overlays.css`, optional small script in `src/client/ui/`

### Enforce notification channel precedence in code

**Partial (2026-04-18):** `notification-policy.ts` helpers + Vitest; toast dedupe gate and phase-alert suppression of info/success toasts in `overlay-view.ts`; `attachSessionPhaseAlertEffect` drives phase alerts with dedupe on `(phase, turn, activePlayer)`. Ordnance launches log once (no duplicate success toast vs game log — `ordnance-actions.ts`). Batch combat no longer mirrors targeting / queue-count copy as transient toasts; HUD status line shows queued volley count and `showFireButton` passes the queue depth (`combat-actions.ts`, `hud.ts`, `session-planning-effects.ts`).

**Partial (2026-04-19):** torpedo aiming intro routes to the **game log** instead of a transient toast (`ordnance-actions.ts`).

**Still open:** audit remaining toast producers (command router, session/quick-match/replay, logistics, reconnect) for duplicate copy vs HUD / log on the same tick; connection and reconnect outcomes remain toast channel per policy.

**Files:** `src/client/messages/notification-policy.ts`, `src/client/ui/overlay-view.ts`, `src/client/game/session-ui-effects.ts`, `src/client/game/session-signals.ts`, `src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`, `src/client/game/ordnance-actions.ts`, `src/client/telemetry.ts`

### Digital-input parity for map selection and targeting

Core map interactions are still pointer-first: selecting combat targets, cycling mixed-hex attackers, and resolving some tactical choices depend on click/tap hex input. Add keyboard-first targeting and selection flows that expose the current focus in the HUD, and structure them so gamepad support can reuse the same command path instead of bolting on a second interaction model later.

**Files:** `src/client/game/keyboard.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud-chrome-view.ts`

### Burn-arrow tap targets (verification)

Renderer burn/overload **disks** are visual; **astrogation picks still resolve by hex** (`resolveBurnToggle` / `resolveOverloadToggle` in `input.ts` — click targets the neighboring **cell**, not only the painted circle). At default zoom that is typically ≥48px; on very small `hexSize` viewports the cell can shrink — revisit only if playtesting reports misses.

**Files:** `src/client/renderer/course.ts`, `src/client/renderer/vectors.ts`, `src/client/game/input.ts`, `src/client/input-interaction.ts`

---

## AI behavior & rules conformance

Findings from a 2026-04-18 deep-research pass against the [2018 Triplanetary rulebook](../Triplanetary2018.pdf) (pp. 5-6) plus the AI ordnance code path. User-visible symptom: AI still over-commits ordnance when marginal shots or economic trade-offs should discourage launches. The rulebook stresses *vector geometry over a 5-turn window* and high cost for nukes — remaining gaps are called out in the items below.

### `recommendedIndex` over-suggests consecutive ordnance launches

**Partial (2026-04-18):** candidate ranking demotes low-confidence consecutive ordnance behind `skipOrdnance` using `evaluateOrdnanceLaunchIntercept` (nukes ≤2-turn fuse, torpedoes ≤3). With `includeCandidateLabels`, `labeledCandidates` append the same short-intercept rationale for agents.

**Still open:** tune thresholds with simulation outcomes (especially scenario-specific target velocities / gravity lanes).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/agent/observation.ts`, `src/shared/agent/candidates.ts`, `src/shared/agent/candidate-labels.ts`

### Tighten Hard-difficulty nuke gates with cost and intercept probability

Hard difficulty historically over-fired nukes on marginal geometry and cost. Rulebook factors: **300 MCr vs 20 MCr** torpedo cost, **2:1** anti-nuke odds with modifiers (p.6), and detonation on contact with **any** ship / base / asteroid / mine / torpedo on the lane.

**Partial (2026-04-18):** `assessNukeBallisticToEnemy` with friendly-path and intercept checks; hard-tier `nukeMinReachProbability` (default **0.22**); grouped anti-nuke EV gating.

**Partial (2026-04-19):** torpedo-viable **nuke score floor** and **2× strength** gate vs cheaper torpedo shots; lane occlusion for **other enemy ships** and **enemy ordnance in flight** (same ballistic stepping as ships); **map lane hazards** from non-space `MapHex` cells (bases, bodies, asteroid/planet/sun surface terrain) plus **pending asteroid hazard** hexes.

**Still open:** expected-damage refinement beyond current gates, and **`simulate:duel-sweep`**-driven tuning of thresholds.

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/engine/combat.ts`

### Add ordnance AI regression fixtures for impossible-shot launches

**Partial (2026-04-18):** `driftingEnemyWouldBeHitByOpenSpaceBallistic` + `EMPTY_SOLAR_MAP` back “no open-space intercept” fixtures; regression tests also cover friendly-lane nuke suppression and grouped anti-nuke EV gating.

**Partial (2026-04-19):** regression tests for **nuke lane** suppression when the ballistic segment crosses **map terrain** or a **pending asteroid hazard** hex (no third ship / ordnance occluder).

**Partial (2026-04-19):** hard **aiOrdnance** determinism smoke on **biplanetary** + `buildSolarSystemMap()` (real sparse gravity map, not `EMPTY_SOLAR_MAP`).

**Still open:** same-stack edge cases beyond launch-hex stacking, deeper gravity-edge assertions beyond determinism, optional `game-engine.test.ts` integration seeds.

**Files:** `src/shared/ai.test.ts`, `src/shared/test-helpers.ts`, `src/shared/test-helpers.test.ts`, optional `src/shared/engine/game-engine.test.ts`

---

## Agent & MCP ergonomics

Findings from a 2026-04-18 agent/MCP experience review. The contract is strong — AGENT_SPEC.md, pre-computed `candidates[]`, labelled observations, two-token auth, ActionGuards forgiveness — but the MCP surface has grown in two places (local stdio MCP in `scripts/delta-v-mcp-server.ts` and hosted `@delta-v/mcp-adapter`) and a handful of per-turn affordances still cost extra round-trips or external doc reads. Ordered by blast radius on agent experience.

### Parallel MCP stdio: host tool pipelining + quick-match pairing

**Partial:** local HTTP MCP, stdio outbound send queue, and operator notes live in [DELTA_V_MCP.md](./DELTA_V_MCP.md). **Still open:** a first-class “pair these two tickets” dev hook for automated two-seat stdio without lobby URLs.

**Files:** `scripts/delta-v-mcp-server.ts`, `src/shared/mcp-stdio-serialized-send.ts`, `src/shared/agent/quick-match.ts`, `docs/DELTA_V_MCP.md`

### Unify local and hosted MCP tool surfaces

**Partial (2026-04-18):** quick-match entry names are aligned (`delta_v_quick_match` ↔ `delta_v_quick_match_connect` on both transports). Local stdio accepts `matchToken` as an alias for `sessionId` on in-match tools and echoes `matchToken` (same value as `sessionId`) in connect/list/get responses so agent code can share identifiers with hosted MCP.

**Still open:** hosted MCP has no `delta_v_list_sessions` / `delta_v_get_events` / `delta_v_close_session`; remote agents on flaky networks still lack server-side event buffering. Legacy hosted `{ code, playerToken }` args remain a wider union than local until retirement (see below).

**Files:** `scripts/delta-v-mcp-server.ts`, `packages/mcp-adapter/src/handlers.ts`, `docs/DELTA_V_MCP.md`, `AGENT_SPEC.md`

### Ship MCP resources: rules, match log, replay

[AGENT_SPEC.md lines 91–96](../AGENT_SPEC.md) lists `game://rules/current`, `game://rules/{scenario}`, `game://matches/{id}/observation`, `game://matches/{id}/log`, `game://matches/{id}/replay`, `game://leaderboard/agents` as first-class MCP resources; none are served yet. The rules resource has the highest payoff — agents currently either bake rules into the skill body (`/play`) or re-read `/.well-known/agent.json` + `/agent-playbook.json` every session. Serving the same content as a listable MCP resource lets hosts cache it and skip repeated fetches.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/delta-v-mcp-server.ts`, `static/.well-known/agent.json`, `src/shared/agent/`

### Structured action-rejection reasons

**Partial (2026-04-19):** `actionRejected` now carries optional **`submitterPlayerId`** (the seat that sent the action) alongside `reason`, `expected`, and `actual`; `validateServerMessage` accepts it; local MCP `delta_v_send_action` echoes it in structured results when `waitForResult` catches a rejection.

`checkActionGuards` in `src/server/game-do/action-guards.ts` still uses a single human `message` string; the smart-forgiveness path (stale `expectedPhase` but action type valid for the real phase) does not emit a rejection at all.

**Still open:** a distinct wire reason when forgiveness applies (vs in-sync), and richer discrimination for engine-level invalidations that still surface as generic `error` today.

**Files:** `src/server/game-do/action-guards.ts`, `src/shared/types/protocol.ts`, `src/shared/protocol.ts`, `scripts/delta-v-mcp-server.ts`, `src/client/game/client-message-plans.ts`

### Retire legacy `{code, playerToken}` tool args once leaderboard stabilises

Hosted MCP tools still accept either `matchToken` or `{code, playerToken}` via `matchTargetSchema` in `packages/mcp-adapter/src/handlers.ts`. Carrying both doubles tool-args surface area and forces every call site to branch on auth mode. Once the public leaderboard is live and all active agents have migrated to `matchToken`, drop the legacy union and simplify the adapter — consistent with the pre-launch-deletions stance elsewhere.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/quick-match-agent.ts`, `scripts/llm-player.ts`, `docs/DELTA_V_MCP.md`

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Baseline controls are documented in [SECURITY.md](./SECURITY.md).

**Still backlog / trigger-gated:** WAF or `[[ratelimits]]` if baseline throttles prove insufficient; Turnstile on human name claim; proof-of-work on bulk agent name claims; spectator delay for serious competition. File hooks sit under [Future features](#future-features-not-currently-planned) where applicable.

---

## Architecture & correctness

### Deterministic initial publication path

Route `initGameSession` through `runPublicationPipeline`, then remove the remaining `getActionRng()` fallbacks to `Math.random` in paths that should already have persistent match identity.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`, `src/shared/prng.ts`

### Replayable turn advancement

Make reinforcement and fleet-conversion side effects fully replayable by either emitting explicit turn-advance events or sharing one mutation implementation between the live engine and the event projector.

**Files:** `src/shared/engine/turn-advance.ts`, `src/shared/engine/victory.ts`, `src/shared/engine/event-projector/lifecycle.ts`, `src/shared/engine/engine-events.ts`

### Cached current-state projection

**Still open:** in-memory cache of current state so reads avoid rebuilding from checkpoint + tail on every wake; invalidate on every event append.

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

### Broaden engine and protocol coverage

**Partial (2026-04-18):** `contracts.json` C2S now covers combat / combatSingle edge shapes (implicit `targetType`, omitted `attackStrength`, ordnance targets, multi-volley `combat`, `guards` passthrough) plus `c2sRejected` rows for invalid `targetType`, empty attackers / blank attacker id / empty `targetId`, non-integer `attackStrength`, and out-of-range strength.

**Partial (2026-04-19):** additional `c2sRejected` rows for unknown `type`, **fleetReady** purchase shape errors, **surrender** `shipIds` shape errors; `transport.json` documents **stateUpdate** with **transferEvents** (asserted in `message-builders.test.ts`); Vitest covers surrender list **>64** ids; `publication.test.ts` locks **`runPublicationPipeline`** ordering (**parity → timer → broadcast**).

**Still open:** optional positive/negative rows for parameterless phase messages beyond current coverage; deeper `transport.json` vs live DO parity.

**Files:** `src/shared/__fixtures__/contracts.json`, `src/shared/protocol.test.ts`, `src/server/game-do/__fixtures__/transport.json`

---

## Future features (not currently planned)

These items are potential future work that depend on product decisions or external triggers. They are not in the active queue.

### Simultaneous or pre-submitted astrogation

**Trigger:** product wants both players to commit astrogation before reveal, or any model other than I-go-you-go `activePlayer` after fleet building.

Requires an explicit engine + protocol change; today astrogation is sequential by `activePlayer` (same contract across engine, action guards, local MCP, and hosted MCP).

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
