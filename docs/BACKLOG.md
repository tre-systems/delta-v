# Delta-V Backlog

Remaining work only. Completed items are in git history.

**How this list is ordered**

A **single global priority** (lower number ≈ tackle sooner): **cost and abuse** first, then **compliance** before a broad public launch, then **core gameplay** unlocks, then **defense in depth**, then **large content** (after dependencies), then **ops and hygiene**, then **conditional or ongoing** work.

If the product stays **private friend matches only**, treat the early security items and some throttles as **optional** until traffic or cost forces them.

Priority numbers are stable IDs and may be non-contiguous when shipped items are removed.

**Human** means not automated in CI — maintainer, QA, counsel, or ops. See [REVIEW_PLAN.md](./REVIEW_PLAN.md).

**Triage format**

Each item should use: **Status**, **Remaining**, and (when useful) **Depends / Files / Owner / Trigger**.

---

### 1. Global edge limits for reporting (`/telemetry`, `/error`) — **optional**

**Status:** baseline shipped.

**Baseline shipped:** `src/server/index.ts` applies per-isolate sliding windows per hashed IP: **120** `POST /telemetry` and **40** `POST /error` per **60s** (plus 4KB JSON cap and `waitUntil` D1 writes).

**Remaining:** If traffic is **distributed across many edges** or you need **tighter** ceilings, add Cloudflare **WAF** rules and/or extra `[[ratelimits]]` namespaces (same pattern as `CREATE_RATE_LIMITER`).

**Files:** `wrangler.toml`, Cloudflare dashboard; tune constants in `src/server/index.ts` if product needs change

### 2. Legal and user-facing privacy (if applicable) — **Human**

**Status:** not started (human/legal gate).

**Remaining:** [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) describes what the code stores; it is **not** a privacy policy. Before broad public launch or regulated regions, complete legal review and publish required notices/consents. Align marketing/site copy with telemetry and retention ([SECURITY.md](./SECURITY.md#data-retention-d1-r2-do)).

**Owner:** you + counsel.

### 5. Passenger rescue mechanics — **partially shipped**

**Status:** partially shipped.

**Baseline shipped:** `passengersAboard` on ships, `initialPassengers` on scenario ships, `passengerRescueEnabled` + `targetWinRequiresPassengers` on `ScenarioRules`, logistics transfers (`transferType: 'passengers'`) with shared cargo capacity, Convoy updated (liner + colonists, win requires passengers on target landing), `passengersTransferred` events and projector support, logistics UI “Passengers” row, game log lines for fuel/cargo/passenger transfers via `formatLogisticsTransferLogLines` (local/AI via `local-game-flow.ts`; **online** via optional `transferEvents` on `stateUpdate` in `protocol.ts`, `toStateUpdateMessage` in `messages.ts`, `message-handler.ts`).

**Remaining:** More scenarios (e.g. variants on evacuation / convoy), richer objectives (partial delivery, pirate-side rules). **Shipped:** compact `evacuation` (Luna → Terra transport + corvette vs corsair) in `map-data.ts`.

**Files:** same as before, plus `src/client/ui/formatters.ts`, `src/client/game/local.ts`, `src/client/game/local-game-flow.ts`, `src/shared/engine/transfer-log-events.ts`, `src/server/game-do/messages.ts`, `src/server/game-do/actions.ts`, `src/client/game/messages.ts`, `src/client/game/message-handler.ts`

**Depends on:** nothing that blocks starting (foundational for some future scenarios).

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

### 9. Scenario expansion

**Status:** not started.

**Remaining:** implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present yet: concealment/dummy counters, passenger rescue, fleet mutiny triggers, and more advanced reinforcement waves.

**Depends on:** passenger rescue and other mechanics (do not start as a thin reskin).

**Files:** `src/shared/map-data.ts`, `src/shared/engine/`, client scenario presentation

### 10. Observability dashboards and alerts — **Human**

**Status:** not started (optional ops layer).

**Remaining:** [OBSERVABILITY.md](./OBSERVABILITY.md) maps data sources but does not configure Cloudflare. Optionally add saved D1 queries, Workers log filters, or alerts on spikes in `client_error`, `engine_error`, or `projection_parity_mismatch`.

**Owner:** you / ops.

### 11. `GameState` schema version and replay compatibility

**Status:** ongoing discipline; required on schema bumps.

`GameState` carries `schemaVersion`. When bumping it, document the migration path: projector behavior, replay of older archived matches, and any client assumptions. Add or extend tests around `event-projector` and recovery paths when versions change.

**Rationale:** Critical **when you bump** schema; routine discipline between bumps.

**Files:** `src/shared/types/domain.ts`, `src/shared/engine/event-projector.ts`, `docs/ARCHITECTURE.md`, relevant tests

### 12. Optional Turnstile on `POST /create`

**Status:** not started; conditional.

Bot-driven room creation can spin many Durable Objects and archive writes. Turnstile validation on `/create` is described in [SECURITY.md](./SECURITY.md).

**Rationale:** Needs UI + server verification; address when automated create spam is observed.

**Files:** client create-game UI, `src/server/index.ts` (`handleCreate`), Turnstile siteverify call

### 13. Renderer performance baseline before major Canvas work

**Status:** ongoing discipline.

Capture measured frame cost (Chrome Performance or equivalent, optional per-frame timing hooks) before large renderer refactors or layer caching. Drive optimization from data, not guesswork (see [ARCHITECTURE.md](./ARCHITECTURE.md) “Next improvements”).

**Files:** `src/client/renderer/renderer.ts`, profiling notes in `docs/` if useful

### 14. Re-baseline client bundle size — **Human**

**Status:** ongoing hygiene.

After large renderer or dependency changes, re-measure `dist/client.js` (raw + gzip) and update the **Client bundle and release hygiene** table in [ARCHITECTURE.md](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene) (or append a dated row there).

**Owner:** whoever ships the change.

**Last routine measure:** 2026-03-24 — ~518 KB raw, ~108 KB gzip (see table in ARCHITECTURE §7).

### 15. Public matchmaking prep (longer room identifiers)

**Status:** not started; product-dependent.

If the product moves beyond shared short codes, implement longer opaque IDs or signed invites (see [SECURITY.md](./SECURITY.md) competitive risks).

**Rationale:** Largest product and protocol surface change in the abuse/matchmaking cluster.

**Files:** `src/server/protocol.ts`, client lobby/join UX, any link/share format

### 16. Trusted HTML path for user-controlled content (when needed)

**Status:** not started; trigger-based.

Today markup is internal/trusted. If chat, player names, or modded scenarios ever render as HTML, add a single sanitizer boundary (e.g. DOMPurify inside `dom.ts`) per [SECURITY.md](./SECURITY.md) and [CODING_STANDARDS.md](./CODING_STANDARDS.md).

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### 17. Windows-friendly pre-commit (if needed) — **Human**

**Status:** not started; trigger-based.

Husky is a **POSIX** shell script (`rm`, `export`, dynamic `E2E_PORT` via Node). If **Windows CMD** users cannot commit, add `cross-env` or reinforce **Git Bash / WSL** in [CONTRIBUTING.md](./CONTRIBUTING.md).

**Owner:** you when the first report lands.

---
