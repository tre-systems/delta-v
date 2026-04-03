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

Core architecture work (`17`-`20`) is complete: exhaustive FSM switches, multi-ship E2E coverage, opponent-turn status feedback, and FSM-driven UI visibility. Remaining work below focuses on legal/privacy gates, accessibility, ops hardening, spectator UX polish, and the smaller cleanup items still left in the client/runtime stack.

---

### 2. Legal and user-facing privacy (if applicable) — **Human**

**Status:** partial.

**Baseline shipped:** a brief in-product operational disclosure now exists in the main menu clarifying anonymous diagnostics, completed-match archives, and the "live-only by default" chat posture.

**Remaining:** [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) describes what the code stores; it is **not** a privacy policy. Before broad public launch or regulated regions, complete legal review and publish required notices/consents. Confirm the shipped UI copy is adequate for the jurisdictions and surfaces you care about, and align marketing/site copy with telemetry and retention ([SECURITY.md](./SECURITY.md#data-retention-d1-r2-do)).

**Owner:** you + counsel.

### 7. Manual DOM accessibility audit pass — **Human**

**Status:** partial.

**Baseline shipped:** automated Playwright + axe checks run in `test:e2e:a11y` and `verify`. A best-effort manual pass on **2026-04-03** tightened input naming, live-region semantics, and help-overlay dialog focus handling.

**Remaining:** repeat the manual checklist in [A11Y.md](./A11Y.md) after major UI changes, with special attention to visual contrast and real-device keyboard/touch behavior for DOM controls (menus, HUD chrome, fleet builder, chat input). The Canvas board remains pointer-first unless product mandates otherwise.

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

### 24. Consolidate planning snapshot types

**Status:** not started.

**Remaining:** `planning.ts` defines ~6 snapshot type aliases (`AstrogationPlanningSnapshot`, `HudPlanningSnapshot`, etc.) plus ~12 supporting view/store types that are `Pick` / intersection combinations of a few base types. Consider consolidating further or using `Pick` directly at call sites to reduce cognitive overhead and type-change ripple.

**Files:** `src/client/game/planning.ts`, consumers in `src/client/game/`

### 28. Shared test factory module

**Status:** not started.

**Remaining:** Test files independently redefine `createShip()`, `createState()`, and similar builders with deep boilerplate. Extract a shared test factory with smart defaults to cut repetition across test files.

**Files:** test files across `src/client/game/` and `src/shared/engine/`

### 31. Decompose client kernel composition root

**Status:** partially complete.

**Baseline shipped:** session/network/replay wiring moved into `main-session-shell.ts`; reactive session effects split into `session-planning-effects.ts` and `session-ui-effects.ts`; `client-kernel.ts` is smaller and mostly composition-oriented now.

**Remaining:** continue reducing coordination load in the remaining composition layers, especially runtime/bootstrap orchestration and top-level interaction wiring.

**Files:** `src/client/game/client-kernel.ts`, `src/client/game/client-runtime.ts`, `src/client/game/main-interactions.ts`

### 32. Simplify runtime and input orchestration

**Status:** not started.

**Remaining:** `client-runtime.ts`, `main-interactions.ts`, `command-router.ts`, and `input.ts` still spread one user interaction flow across DOM event handling, keyboard translation, command routing, and gameplay side effects. Define a smaller boundary so browser/UI events become one typed action stream before game logic dispatch.

**Files:** `src/client/game/client-runtime.ts`, `src/client/game/main-interactions.ts`, `src/client/game/command-router.ts`, `src/client/game/input.ts`

### 33. Split logistics UI state from DOM rendering

**Status:** not started.

**Remaining:** `logistics-ui.ts` still mixes store creation, transfer calculations, DOM rendering, and UI event wiring in one large module. Separate the state/model layer from DOM rendering and event handling so logistics changes stop touching one file.

**Files:** `src/client/game/logistics-ui.ts`, related tests
