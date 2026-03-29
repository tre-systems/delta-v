# Delta-V Backlog

Remaining work only. Completed items are in git history.

**How this list is ordered**

A **single global priority** (lower number ≈ tackle sooner): **cost and abuse** first, then **compliance** before a broad public launch, then **core gameplay** unlocks, then **defense in depth**, then **large content** (after dependencies), then **ops and hygiene**, then **conditional or ongoing** work.

If the product stays **private friend matches only**, treat the early security items and some throttles as **optional** until traffic or cost forces them.

Priority numbers are stable IDs and may be non-contiguous when shipped items are removed.

**Human** means not automated in CI — maintainer, QA, counsel, or ops. See [REVIEW_PLAN.md](./REVIEW_PLAN.md).

**Triage format**

Each item should use: **Status**, **Remaining**, and (when useful) **Depends / Files / Owner / Trigger**.

**Next engineering work**

All architecture simplification tasks (`19`-`29`) are shipped. The remaining backlog items are human-gated, conditional, product-dependent, or ongoing discipline. See individual items below for triggers and owners.

---

### 2. Legal and user-facing privacy (if applicable) — **Human**

**Status:** not started (human/legal gate).

**Remaining:** [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) describes what the code stores; it is **not** a privacy policy. Before broad public launch or regulated regions, complete legal review and publish required notices/consents. Align marketing/site copy with telemetry and retention ([SECURITY.md](./SECURITY.md#data-retention-d1-r2-do)).

**Owner:** you + counsel.

### 6. Spectator mode — UX polish

**Status:** baseline shipped; UX follow-up open.

**Baseline shipped:** Live spectator WebSocket upgrades: the worker proxies `GET /ws/:code?viewer=spectator` to the room DO (no player token). The DO tags sockets as `spectator`, sends `spectatorWelcome` plus optional `gameStart` using the same spectator-filtered `GameState` projection as broadcasts, and only answers `ping` on those sockets. Client: open `/?code=CODE&viewer=spectator` to spectate (`spectatorMode` session), WebSocket URL includes `viewer=spectator`, message plan handles `spectatorWelcome` with `playerId` -1, phase routing avoids seat-specific action states, game-over copy is neutral for spectators.

**Remaining:** Lobby affordance (copy/share spectate link), clearer read-only treatment in the fleet builder and action surfaces, optional rate limits or abuse controls for unauthenticated spectator upgrades, any protocol tidy-ups.

**Depends on:** can ship in parallel with passenger work.

**Files:** `src/server/index.ts`, `src/server/game-do/fetch.ts`, `src/server/game-do/ws.ts`, `src/shared/types/protocol.ts`, `src/client/game/session-controller.ts`, `src/client/game/main-composition.ts`, `src/client/game/connection.ts`, `src/client/game/session.ts`, `src/client/game/messages.ts`, `src/client/game/message-handler.ts`, `src/client/game/phase.ts`, `src/client/game/endgame.ts`, `src/client/game/client-kernel.ts`, lobby/UI

### 7. Manual DOM accessibility audit pass — **Human**

**Status:** automation shipped; manual audit follow-up open.

**Baseline shipped:** automated Playwright + axe checks run in `test:e2e:a11y` and `verify`.

**Remaining:** execute the manual checklist in [A11Y.md](./A11Y.md) after major UI changes: keyboard-only pass through create/join/play/game-over, focus behavior, and contrast review for DOM controls (menus, HUD chrome, fleet builder, chat input). The Canvas board remains pointer-first unless product mandates otherwise.

**Owner:** maintainer / QA. **Deliverable:** fix obvious issues or file scoped tasks; record results with the A11Y audit template.

### 8. Global edge limits for join/replay probes — **optional**

**Status:** baseline shipped.

**Baseline shipped:** shared per-isolate window per hashed IP — **100** combined `GET /join/:code` + `GET /replay/:code` per **60s**.

**Remaining:** WAF or `[[ratelimits]]` if distributed scans still wake DOs or cost too much.

**Files:** `wrangler.toml`, Cloudflare dashboard; tune constants in `src/server/index.ts` if needed

### 10. Observability dashboards and alerts — **Human**

**Status:** not started (optional ops layer).

**Remaining:** [OBSERVABILITY.md](./OBSERVABILITY.md) maps data sources but does not configure Cloudflare. Optionally add saved D1 queries, Workers log filters, or alerts on spikes in `client_error`, `engine_error`, or `projection_parity_mismatch`.

**Owner:** you / ops.

### 11. `GameState` schema version and replay compatibility

**Status:** ongoing discipline; required on schema bumps.

`GameState` carries `schemaVersion`. When bumping it, document the migration path: projector behavior, replay of older archived matches, and any client assumptions. Add or extend tests around `event-projector` and recovery paths when versions change.

**Rationale:** Critical **when you bump** schema; routine discipline between bumps.

**Files:** `src/shared/types/domain.ts`, `src/shared/engine/event-projector.ts`, `docs/ARCHITECTURE.md`, relevant tests

### 15. Public matchmaking prep (longer room identifiers)

**Status:** not started; product-dependent.

If the product moves beyond shared short codes, implement longer opaque IDs or signed invites (see [SECURITY.md](./SECURITY.md) competitive risks).

**Rationale:** Largest product and protocol surface change in the abuse/matchmaking cluster.

**Files:** `src/server/protocol.ts`, client lobby/join UX, any link/share format

### 16. Trusted HTML path for user-controlled content (when needed)

**Status:** not started; trigger-based.

Today markup is internal/trusted. If chat, player names, or modded scenarios ever render as HTML, add a single sanitizer boundary (e.g. DOMPurify inside `dom.ts`) per [SECURITY.md](./SECURITY.md) and [CODING_STANDARDS.md](./CODING_STANDARDS.md).

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### 18. Scenario balance and timeout tuning from simulation evidence

**Status:** ongoing monitoring. The severe outliers found in the early 2026-03-28 review pass were materially improved by later AI tuning.

**Baseline shipped:** the current full 25-game `--ci` sweep is back inside the configured scenario bands, including previously noisy cases such as `biplanetary`, `blockade`, `fleetAction`, and `interplanetaryWar`.

**Remaining:** keep rerunning `npm run simulate -- all 100 -- --ci` after major AI, scenario, map, or victory-condition changes; only reopen targeted balance work if scenarios drift back out of band, produce excessive timeouts, or show obviously non-human AI behavior.

**Files:** `scripts/simulate-ai.ts`, `src/shared/ai.ts`, `src/shared/ai-scoring.ts`, `src/shared/map-data.ts`, scenario-specific rules in `src/shared/engine/`

**Trigger:** after AI heuristic, scenario setup, or victory-condition changes, rerun `npm run simulate -- all 100 -- --ci` and track trend.


---
