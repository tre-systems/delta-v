# Delta-V Backlog

Remaining work only. Completed items are in git history.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

**How this list is ordered**

A **single global priority** (lower number ≈ tackle sooner): **cost and abuse** first, then **compliance** before a broad public launch, then **core gameplay** unlocks, then **defense in depth**, then **large content** (after dependencies), then **ops and hygiene**, then **conditional or ongoing** work.

If the product stays **private friend matches only**, treat the early security items and some throttles as **optional** until traffic or cost forces them.

Priority numbers are stable IDs and may be non-contiguous when shipped items are removed.

**Human** means not automated in CI — maintainer, QA, counsel, or ops. See [REVIEW_PLAN.md](./REVIEW_PLAN.md).

**Triage format**

Each item should use: **Status**, **Remaining**, and (when useful) **Depends / Files / Owner / Trigger**.

### Next engineering work

Core architecture work (`17`-`20`) is complete: exhaustive FSM switches, multi-ship E2E coverage, opponent-turn status feedback, and FSM-driven UI visibility. Remaining work below focuses on legal/privacy gates, accessibility, ops hardening, and spectator UX polish.

---

### 2. Legal and user-facing privacy (if applicable) — **Human**

**Status:** not started (human/legal gate).

**Remaining:** [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) describes what the code stores; it is **not** a privacy policy. Before broad public launch or regulated regions, complete legal review and publish required notices/consents. Align marketing/site copy with telemetry and retention ([SECURITY.md](./SECURITY.md#data-retention-d1-r2-do)).

**Owner:** you + counsel.

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

---

### 22. Replace planning store property aliasing with plain object

**Status:** not started.

**Remaining:** `planning.ts` uses ~400 lines of `definePlanningAlias()` / `defineHiddenPlanningMember()` via `Object.defineProperty` to wrap a hidden `PlanningData` object. Replace with a plain object and a single `notifyPlanningChanged()` call. The property descriptor ceremony adds no safety — state is mutated throughout anyway.

**Files:** `src/client/game/planning.ts`

### 23. Data-driven phase dispatch tables

**Status:** not started.

**Remaining:** `phase-entry.ts` and `phase.ts` contain ~200 lines of switch statements returning near-identical config objects differing in 1–2 fields. Replace with lookup tables keyed by phase, merging per-phase overrides onto shared defaults.

**Files:** `src/client/game/phase-entry.ts`, `src/client/game/phase.ts`

### 24. Consolidate planning snapshot types

**Status:** not started.

**Remaining:** `planning.ts` defines 23+ snapshot type aliases (`AstrogationPlanningSnapshot`, `HudPlanningSnapshot`, etc.) that are `Pick` / intersection combinations of 4–5 base types. Consolidate into fewer types or use `Pick` directly at call sites to reduce cognitive overhead and type-change ripple.

**Files:** `src/client/game/planning.ts`, consumers in `src/client/game/`

### 25. Generic combat target finder

**Status:** not started.

**Remaining:** `combat.ts` has 7 similar filter/find functions for locating ships and ordnance targets, each differing by one predicate. Replace with a single `findTargets(state, filter)` utility.

**Files:** `src/client/game/combat.ts`

### 26. Message handler registry

**Status:** not started.

**Remaining:** `message-handler.ts` dispatches 12+ message types via a switch with inconsistent patterns (some inline, some delegated). Replace with a handler registry mapping message kind to handler function.

**Files:** `src/client/game/message-handler.ts`

### 27. Break up HUD view model construction

**Status:** not started.

**Remaining:** `deriveHudViewModel()` in `hud-orders.ts` builds a 28-field object with inline IIFEs computing individual booleans. Extract mixed concerns (objective calculation, ordnance validation, fleet status) into smaller testable helper functions.

**Files:** `src/client/game/hud-orders.ts`

### 28. Shared test factory module

**Status:** not started.

**Remaining:** Test files independently redefine `createShip()`, `createState()`, and similar builders with deep boilerplate. Extract a shared test factory with smart defaults to cut repetition across test files.

**Files:** test files across `src/client/game/` and `src/shared/engine/`

### 29. Remove helpers.ts re-export indirection

**Status:** not started.

**Remaining:** `helpers.ts` is a pure re-export file adding import indirection without value. Update consumers to import directly from source modules and delete the file.

**Files:** `src/client/game/helpers.ts`, importing modules

### 30. Event projector handler registry

**Status:** not started.

**Remaining:** `event-projector/index.ts` uses a switch with manual case grouping to route events to 3 category handlers. Replace with a registry keyed by event type to reduce fragility when adding new events.

**Files:** `src/shared/engine/event-projector/index.ts`

---
### 21. Spectator UX Hardening

**Status:** baseline support shipped.

**Remaining:** review and polish the "spectator" experience. Currently, spectators use a stripped-down HUD. Ensure they have clear "Spectating" status indicators, can see all ship stats without interactive controls appearing, and have a unique "Game Over" summary that reflects the global outcome rather than personal fleet stats.

**Files:** `src/client/game/selection.ts`, `src/client/game/hud-orders.ts`, `src/client/ui/hud.ts`
