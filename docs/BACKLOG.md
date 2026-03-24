# Delta-V Backlog

Remaining work only. Completed items are in git history.

**How this list is ordered**

A **single global priority** (lower number ≈ tackle sooner): **cost and abuse** first, then **compliance** before a broad public launch, then **core gameplay** unlocks, then **defense in depth**, then **large content** (after dependencies), then **ops and hygiene**, then **conditional or ongoing** work.

If the product stays **private friend matches only**, treat the early security items and some throttles as **optional** until traffic or cost forces them.

**Human** means not automated in CI — maintainer, QA, counsel, or ops. See [REVIEW_PLAN.md](./REVIEW_PLAN.md).

---

### 1. Global edge limits for reporting (`/telemetry`, `/error`) — **optional**

**Baseline shipped:** `src/server/index.ts` applies per-isolate sliding windows per hashed IP: **120** `POST /telemetry` and **40** `POST /error` per **60s** (plus 4KB JSON cap and `waitUntil` D1 writes).

**Remaining:** If traffic is **distributed across many edges** or you need **tighter** ceilings, add Cloudflare **WAF** rules and/or extra `[[ratelimits]]` namespaces (same pattern as `CREATE_RATE_LIMITER`).

**Files:** `wrangler.toml`, Cloudflare dashboard; tune constants in `src/server/index.ts` if product needs change

### 2. Legal and user-facing privacy (if applicable) — **Human**

[PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) describes what the code stores; it is **not** a privacy policy. Before broad public launch or regulated regions, have **legal review** and publish whatever notices or consents are required. Align marketing/site copy with telemetry and retention ([SECURITY.md](./SECURITY.md#data-retention-d1-r2-do)).

**Owner:** you + counsel.

### 3. Direction-to-objective indicator on the HUD — **shipped**

**Done:** Gold minimap arrow from the **selected** ship toward the current objective (Grand Tour next checkpoint / return home, escape edge hint, fugitive transport when inspection rules apply, `targetBody` center, else nearest **detected** enemy). Logic: `getObjectiveBearingTargetHex` in `src/client/game/navigation.ts`; draw: `src/client/renderer/minimap.ts`, `src/client/renderer/minimap-draw.ts` (renderer passes `planningState.selectedShipId`).

**Remaining (optional):** Extra HUD compass near the objective line in `src/client/ui/hud.ts` if you want the cue off the minimap.

### 4. Crash warning on course preview — **shipped**

**Done:** `crashHex` on `CourseResult` (`src/shared/movement.ts`, `src/shared/types/domain.ts`); course preview draws a red disk + **X** at the impact hex (`src/client/renderer/course.ts`, `src/client/renderer/course-draw.ts`).

### 5. Passenger rescue mechanics — **partially shipped**

**Done (baseline):** `passengersAboard` on ships, `initialPassengers` on scenario ships, `passengerRescueEnabled` + `targetWinRequiresPassengers` on `ScenarioRules`, logistics transfers (`transferType: 'passengers'`) with shared cargo capacity, Convoy updated (liner + colonists, win requires passengers on target landing), `passengersTransferred` events and projector support, logistics UI “Passengers” row, local/AI game log lines for fuel/cargo/passenger transfers via `formatLogisticsTransferLogLines`.

**Remaining:** Additional scenarios (e.g. dedicated rescue-only setups), richer objectives (partial delivery, pirate-side rules), and **online** game-log wiring if transfer lines should appear for network games (today they apply as `stateUpdate` only).

**Files:** same as before, plus `src/client/ui/formatters.ts`, `src/client/game/local.ts`, `src/client/game/local-game-flow.ts`

**Depends on:** nothing that blocks starting (foundational for some future scenarios).

### 6. Spectator mode — client UI and live stream

Server-side spectator transport is complete: viewer-aware filtering, spectator replay delivery, spectator-tagged broadcasts, and WebSocket boundary enforcement are all wired and tested. Live spectator WebSocket joins are explicitly rejected (501) for now.

Remaining work is client-side: a spectator join flow, real-time spectator state display during live games, and the protocol extension to accept live spectator WebSocket connections.

**Depends on:** can ship in parallel with passenger work.

**Files:** `src/server/game-do/game-do.ts`, `src/server/protocol.ts`, `src/client/game/client-kernel.ts`, client spectator UI

### 7. Run DOM accessibility audit — **Human**

Execute [A11Y.md](./A11Y.md): Lighthouse (or axe) on the SPA shell, manual **keyboard-only** pass through create/join/play/game-over for **DOM** controls (menus, HUD chrome, fleet builder, chat input). The Canvas board remains pointer-first unless product mandates otherwise.

**Owner:** maintainer / QA. **Deliverable:** fix obvious issues or file scoped tasks; update A11Y checklist with dates.

### 8. Global edge limits for join/replay probes — **optional**

**Baseline shipped:** shared per-isolate window per hashed IP — **100** combined `GET /join/:code` + `GET /replay/:code` per **60s**.

**Remaining:** WAF or `[[ratelimits]]` if distributed scans still wake DOs or cost too much.

**Files:** `wrangler.toml`, Cloudflare dashboard; tune constants in `src/server/index.ts` if needed

### 9. Scenario expansion

Implement Lateral 7, Fleet Mutiny, and Retribution.

These depend on mechanics that are not fully present yet: concealment / dummy counters, passenger rescue, fleet mutiny triggers, and more advanced reinforcement waves.

**Depends on:** passenger rescue and other mechanics (do not start as a thin reskin).

**Files:** `src/shared/map-data.ts`, `src/shared/engine/`, client scenario presentation

### 10. Observability dashboards and alerts — **Human**

[OBSERVABILITY.md](./OBSERVABILITY.md) maps data sources but does not configure Cloudflare. Optionally add: saved D1 queries, Workers log filters, or alerts on spikes in `client_error`, `engine_error`, or `projection_parity_mismatch`.

**Owner:** you / ops.

### 11. `GameState` schema version and replay compatibility

`GameState` carries `schemaVersion`. When bumping it, document the migration path: projector behavior, replay of older archived matches, and any client assumptions. Add or extend tests around `event-projector` and recovery paths when versions change.

**Rationale:** Critical **when you bump** schema; routine discipline between bumps.

**Files:** `src/shared/types/domain.ts`, `src/shared/engine/event-projector.ts`, `docs/ARCHITECTURE.md`, relevant tests

### 12. Optional Turnstile on `POST /create`

Bot-driven room creation can spin many Durable Objects and archive writes. Turnstile validation on `/create` is described in [SECURITY.md](./SECURITY.md).

**Rationale:** Needs UI + server verification; address when automated create spam is observed.

**Files:** client create-game UI, `src/server/index.ts` (`handleCreate`), Turnstile siteverify call

### 13. Renderer performance baseline before major Canvas work

Capture measured frame cost (Chrome Performance or equivalent, optional per-frame timing hooks) before large renderer refactors or layer caching. Drive optimization from data, not guesswork (see [ARCHITECTURE.md](./ARCHITECTURE.md) “Next improvements”).

**Files:** `src/client/renderer/renderer.ts`, profiling notes in `docs/` if useful

### 14. Re-baseline client bundle size — **Human**

After large renderer or dependency changes, re-measure `dist/client.js` (raw + gzip) and update the **Client bundle and release hygiene** table in [ARCHITECTURE.md](./ARCHITECTURE.md#7-client-bundle-and-release-hygiene) (or append a dated row there).

**Owner:** whoever ships the change.

**Last routine measure:** 2026-03-24 — ~518 KB raw, ~108 KB gzip (see table in ARCHITECTURE §7).

### 15. Public matchmaking prep (longer room identifiers)

If the product moves beyond shared short codes, implement longer opaque IDs or signed invites (see [SECURITY.md](./SECURITY.md) competitive risks).

**Rationale:** Largest product and protocol surface change in the abuse/matchmaking cluster.

**Files:** `src/server/protocol.ts`, client lobby/join UX, any link/share format

### 16. Trusted HTML path for user-controlled content (when needed)

Today markup is internal/trusted. If chat, player names, or modded scenarios ever render as HTML, add a single sanitizer boundary (e.g. DOMPurify inside `dom.ts`) per [SECURITY.md](./SECURITY.md) and [CODING_STANDARDS.md](./CODING_STANDARDS.md).

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### 17. Windows-friendly pre-commit (if needed) — **Human**

Husky is a **POSIX** shell script (`rm`, `export`, dynamic `E2E_PORT` via Node). If **Windows CMD** users cannot commit, add `cross-env` or reinforce **Git Bash / WSL** in [CONTRIBUTING.md](./CONTRIBUTING.md).

**Owner:** you when the first report lands.

---
