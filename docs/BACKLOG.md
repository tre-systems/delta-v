# Delta-V Backlog

Unfinished actionable work, in one global priority order. Shipped history lives in git; recurring review procedures live in [REVIEW_PLAN.md](./REVIEW_PLAN.md); architecture rationale lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

The sections below are grouped by theme but ordered within each group by priority. Gameplay-feel items (P1) translate most directly into a better player experience; architecture-solidity items (P2) unblock confident iteration on P1.

---

## Gameplay UX & matchmaking integrity

Findings from exploratory live-session testing on 2026-04-17 using paired quick-match queues, MCP sessions, and browser-driven player flows. Ordered by user impact and regression risk.

### Unify in-game state messaging with actual phase/turn state

During active matches, stale pregame content (e.g. "Game Created", "Waiting for opponent...") can remain in the semantic tree while in-turn controls are already active. This causes user confusion and weakens accessibility semantics.

**Tasks:**
- Make one authoritative game-state presenter drive both visible labels and accessibility text.
- Hide or unmount pregame headings/content once `gameStart` is received and gameplay controls are active.
- Add UI-state tests that assert phase-specific headings/status do not coexist with stale pregame messaging.
- Add a compact always-visible phase/status banner (`phase`, `active player`, `pending/confirmed`) for clarity.

**Acceptance criteria:**
- In active gameplay phases, no stale pregame status strings appear in the visible UI or accessibility snapshot.
- Phase/turn ownership is discoverable from one consistent status region on desktop and mobile layouts.

**Files:** home/lobby state rendering, in-game HUD/status components, accessibility labeling, UI tests

---

## Cost & abuse hardening

Findings from a 2026-04-17 cost-surface review. Ordered by expected blast radius on billing and auth integrity. See [SECURITY.md](./SECURITY.md) for the posture these close.

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

### Cached current-state projection and checkpoint cleanup

Avoid rebuilding current state from checkpoint + tail on every wake/read, and prune completed-match checkpoints once the durable archive is written.

**Files:** `src/server/game-do/archive.ts`, `src/server/game-do/projection.ts`, `src/server/game-do/archive-storage.ts`, `src/server/game-do/game-do.ts`

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

Add property tests for ordnance-launch and logistics-transfer invariants, complete the missing positive C2S fixtures, and add negative protocol fixtures for invalid payloads.

**Files:** `src/shared/ordnance.property.test.ts`, `src/shared/logistics.property.test.ts`, `src/shared/__fixtures__/contracts.json`, `src/shared/protocol.test.ts`, `src/server/game-do/__fixtures__/transport.json`

### Consolidated DO test helpers and hibernation seed coverage

Extract a shared Durable Object storage mock helper with one `put` contract, then add an explicit test that `matchSeed` survives checkpoint/replay and DO hibernation paths.

**Files:** `src/server/game-do/archive.test.ts`, `src/server/game-do/game-do.test.ts`, `src/server/game-do/alarm.test.ts`, `src/server/game-do/match.test.ts`, `src/server/game-do/turn-timeout.test.ts`

### Extend coverage thresholds beyond shared engine code

Ratchet coverage onto `src/server/game-do/**/*.ts` and a small set of high-value client modules so plumbing regressions stop slipping in under the unscoped threshold.

**Files:** `vitest.config.ts`, selected `src/server/game-do/**/*.test.ts`, selected `src/client/**/*.test.ts`

### Client consistency cleanup

Make unsupported local-transport methods explicit, route local emplacement through the same resolution path as other local actions, and add error containment/reporting for reactive effects.

**Files:** `src/client/game/transport.ts`, `src/client/game/local.ts`, `src/client/reactive.ts`

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

### OpenClaw SKILL.md on ClawHub

**Trigger:** OpenClaw platform ready for external skill publishing.

Publish a `SKILL.md` gated on `DELTA_V_AGENT_TOKEN` so any OpenClaw agent auto-acquires Delta-V capability. Depends on the remote MCP endpoint and `agentToken` issuance above.

**Files:** external publish; skill body references remote MCP endpoint
