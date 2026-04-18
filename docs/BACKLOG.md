# Delta-V Backlog

Outstanding tasks only — **no release log** (use `git log` for shipped work). Recurring review procedures: [REVIEW_PLAN.md](./REVIEW_PLAN.md). Architecture rationale: [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

## Gameplay UX & matchmaking integrity

Exploratory live-session notes (2026-04-17) plus UX/a11y review (2026-04-18). Each **###** is **remaining** work only (shipped details live in `git log` and tests).

### Contrast audit (quantified)

Run WCAG contrast / readability measurements each release using [MANUAL_TEST_PLAN.md](./MANUAL_TEST_PLAN.md) § **Contrast & readability** and [A11Y.md](./A11Y.md); tune CSS from findings.

**Files:** `static/styles/*.css`, `docs/MANUAL_TEST_PLAN.md`, `docs/A11Y.md`

### Stronger high-contrast modes

Spot-check remaining HUD / systems chrome if playtesters still see flat contrast. **Done for this slice:** `#scenarioSelect` / `#waiting` panels aligned with `#menu` under **prefers-contrast: more** and **forced-colors**; game-over shell, card, kicker, and replay strip use explicit Canvas/contrast-friendly panels.

**Files:** `static/styles/base.css`, `static/styles/components.css`, `static/styles/hud.css`, `static/styles/overlays.css`, `static/styles/systems.css`

### Tutorial: deepen task-first flow

Spotlight-driven steps and tighter coupling to HUD hints. **Done for this slice:** per-step **Help** opens the overlay and scrolls to the matching rules section.

**Files:** `src/client/tutorial.ts`, `src/client/ui/hud-chrome-view.ts`, `static/index.html`, `static/styles/overlays.css`

### Help overlay: active-section highlighting (optional)

Highlight the section in view on scroll, or collapse long groups with `<details>`.

**Files:** `static/index.html`, `static/styles/overlays.css`, optional small script in `src/client/ui/`

### Enforce notification channel precedence in code

Remaining audit: session UI effects / reactive wiring, telemetry-driven copy, and any logistics paths that still mirror the game log as a toast. Turn timer, local emplacement success, “no enemies” camera hint, and local-only replay now use HUD/sound or the game log instead of stacking toasts. Connection, reconnect, and session errors stay on the toast channel per policy.

**Files:** `src/client/ui/overlay-view.ts`, `src/client/game/session-ui-effects.ts`, `src/client/game/session-signals.ts`, `src/client/ui/hud-chrome-view.ts`, `src/client/ui/game-log-view.ts`, `src/client/game/command-router.ts`, `src/client/telemetry.ts`

### Digital-input parity for map selection and targeting

**Done (phase 1):** combat **[`]` / `[`]** cycles eligible enemy ships/nukes (same visibility rules as pointer targeting), updates planning via `cycleCombatTarget` → `setCombatPlan`, centers the camera on the new target, and shows **Target: …** on the HUD status line (desktop hint includes `[ ]`).

**Remaining:** mixed-hex attacker cycling without pointer, richer gamepad binding on the same command path, and other tactical picks still pointer-first.

**Files:** `src/client/game/keyboard.ts`, `src/client/game/input-events.ts`, `src/client/game/input.ts`, `src/client/game/combat.ts`, `src/client/ui/hud.ts`, `static/index.html`

### Burn-arrow tap targets (verification)

Revisit burn/overload hit targets only if playtesting reports misses at very small `hexSize` (picks resolve by neighboring hex cell, not only the painted disk — `resolveBurnToggle` / `resolveOverloadToggle` in `input.ts`).

**Files:** `src/client/renderer/course.ts`, `src/client/renderer/vectors.ts`, `src/client/game/input.ts`, `src/client/input-interaction.ts`

---

## AI behavior & rules conformance

Further AI ordnance work vs the [2018 Triplanetary rulebook](../Triplanetary2018.pdf) (pp. 5–6): simulation-backed thresholds, EV refinement, and deeper regression fixtures.

### `recommendedIndex` over-suggests consecutive ordnance launches

Tune candidate thresholds with simulation outcomes (especially scenario-specific target velocities / gravity lanes).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/agent/observation.ts`, `src/shared/agent/candidates.ts`, `src/shared/agent/candidate-labels.ts`

### Tighten Hard-difficulty nuke gates with cost and intercept probability

**Done for this slice:** raised hard `nukeMinReachProbability` and the nuke score floor when a torpedo is also viable so marginal lanes prefer the cheaper weapon; duel-sweep remains the harness for follow-up EV tuning.

**Remaining:** expected-damage refinement beyond current gates, and **`simulate:duel-sweep`**-driven threshold tables tied to measurement runs (rulebook: nuke **300 MCr** vs torpedo **20 MCr**, **2:1** anti-nuke table, detonation on lane contacts).

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/config.ts`, `src/shared/engine/combat.ts`

### Add ordnance AI regression fixtures for impossible-shot launches

**Done for this slice:** `evaluateOrdnanceLaunchIntercept` wired to the same open-map drift geometry as the existing impossible-shot ordnance fixtures.

**Remaining:** same-stack edge cases beyond launch-hex stacking, deeper gravity-edge assertions (beyond open-map determinism smoke), optional `game-engine.test.ts` integration seeds.

**Files:** `src/shared/ai.test.ts`, `src/shared/test-helpers.ts`, `src/shared/test-helpers.test.ts`, optional `src/shared/engine/game-engine.test.ts`

---

## Agent & MCP ergonomics

Gaps in local vs hosted MCP parity, first-class resources, and structured rejection surfaces for autonomous play.

### Parallel MCP stdio: host tool pipelining + quick-match pairing

First-class “pair these two tickets” dev hook for automated two-seat stdio without lobby URLs.

**Files:** `scripts/delta-v-mcp-server.ts`, `src/shared/mcp-stdio-serialized-send.ts`, `src/shared/agent/quick-match.ts`, `docs/DELTA_V_MCP.md`

### Unify local and hosted MCP tool surfaces

Hosted MCP: add `delta_v_list_sessions` / `delta_v_get_events` / `delta_v_close_session` parity with local; server-side event buffering for flaky networks.

**Files:** `scripts/delta-v-mcp-server.ts`, `packages/mcp-adapter/src/handlers.ts`, `docs/DELTA_V_MCP.md`, `AGENT_SPEC.md`

### Ship MCP resources: rules, match log, replay

[AGENT_SPEC.md lines 91–96](../AGENT_SPEC.md) lists `game://rules/current`, `game://rules/{scenario}`, `game://matches/{id}/observation`, `game://matches/{id}/log`, `game://matches/{id}/replay`, `game://leaderboard/agents` as first-class MCP resources; none are served yet. The rules resource has the highest payoff — agents currently either bake rules into the skill body (`/play`) or re-read `/.well-known/agent.json` + `/agent-playbook.json` every session. Serving the same content as a listable MCP resource lets hosts cache it and skip repeated fetches.

**Files:** `packages/mcp-adapter/src/handlers.ts`, `scripts/delta-v-mcp-server.ts`, `static/.well-known/agent.json`, `src/shared/agent/`

### Structured action-rejection reasons

Distinct wire reason when ActionGuards **phase** mismatch is forgiven (action type already valid for the real phase) vs when the client is simply in sync. Richer discrimination for engine-level invalidations that still surface as generic `error` today.

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

**Done for this slice:** `initGameSession` already publishes via the same `GameDO.publishStateChange` → `runPublicationPipeline` path as post-init actions; `getActionRng()` breach fallbacks now use fixed-seed `mulberry32` streams instead of `Math.random` so any accidental call stays replayable while warnings surface the bug.

**Remaining:** optional further deduplication if `match.ts` should call `runPublicationPipeline` without the `publishStateChange` indirection.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`, `src/server/game-do/game-do.ts`, `src/shared/prng.ts`

### Replayable turn advancement

Make reinforcement and fleet-conversion side effects fully replayable by either emitting explicit turn-advance events or sharing one mutation implementation between the live engine and the event projector.

**Files:** `src/shared/engine/turn-advance.ts`, `src/shared/engine/victory.ts`, `src/shared/engine/event-projector/lifecycle.ts`, `src/shared/engine/engine-events.ts`

### Cached current-state projection

In-memory cache of current state so reads avoid rebuilding from checkpoint + tail on every wake; invalidate on every event append.

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

Tighten scenario/body registries around closed keys; brand ship / ordnance identifiers so lookup-heavy paths stop depending on plain `string` (wire `isHexKey` coverage exists in Vitest — extend to call sites and registries).

**Files:** `src/shared/hex.ts`, `src/shared/ids.ts`, `src/shared/map-data.ts`, `src/shared/types/domain.ts`, `src/server/room-routes.ts`, `src/server/game-do/http-handlers.ts`, `src/client/game/main-session-network.ts`

### Scenario and map validation

**Done for this slice:** `createGame` rejects unknown `player.targetBody` names when the map declares bodies (same policy as `homeBody`).

**Remaining:** conflicting rule combinations, invalid spawn hexes, overlapping bodies, unreachable bases, and bounds that should be derived from body placement instead of hardcoded constants.

**Files:** `src/shared/map-data.ts`, `src/shared/map-layout.ts`, `src/shared/engine/game-creation.ts`, `src/shared/types/domain.ts`

### Standardized error surfaces and client recovery messaging

Prefer `engineFailure()` everywhere, then surface typed rate-limit / validation handling in the client so user-facing error behavior can branch on error code instead of generic text alone.

**Files:** `src/shared/engine/util.ts`, `src/shared/engine/astrogation.ts`, `src/shared/engine/ordnance.ts`, `src/shared/engine/logistics.ts`, `src/shared/engine/combat.ts`, `src/shared/types/domain.ts`, `src/server/game-do/socket.ts`, `src/client/game/connection.ts`, `src/client/game/message-handler.ts`

---

## Testing & client consistency

### Broaden engine and protocol coverage

Optional positive/negative `contracts.json` rows for parameterless phase one-shots (`skipOrdnance`, `endCombat`, …) beyond current coverage. Deeper `transport.json` vs live Durable Object message parity.

**Files:** `src/shared/__fixtures__/contracts.json`, `src/shared/protocol.test.ts`, `src/server/game-do/__fixtures__/transport.json`, `src/server/game-do/publication.test.ts`

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
