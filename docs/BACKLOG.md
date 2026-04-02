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

The core architecture has been formalized with a library-free **Interaction FSM** (`17`-`20`). Remaining engineering work focuses on expanding test coverage for complex fleet scenarios (`18`) and polishing phase-transition UX (`19`). See individual items below for details.

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
### 17. Interaction FSM Exhaustiveness — **SHIPPED**

Exhaustive `never` checks enforce compile-time coverage across all FSM switches: `applyInteractionEvent`, `deriveClientScreenPlan`, `buildScreenVisibility`, and `mapInteractionModeToUIScreenMode`. Adding a new `ClientState` or `InteractionMode` now causes a type error until every switch is updated.

### 18. Expanded E2E Multiplayer Lifecycle Coverage

**Status:** baseline coverage in `e2e/gameplay-lifecycle.spec.ts`.

**Remaining:** add a new E2E spec for a 3+ ship scenario (e.g. `blockadeRunner` or `escape`) to verify the `acknowledgedShips` rotation and `confirmBtn` visibility logic remains robust under complex fleet states.

**Files:** `e2e/gameplay-lifecycle.spec.ts`

### 19. Phase Transition "Synchronizing" Overlay

**Status:** not started.

**Remaining:** add a subtle UI overlay (e.g. "Synchronizing...") that appears during the brief interaction gap between `movementAnim` and the next playable phase. This improves UX by explaining why inputs are temporarily disabled while the server resolves results.

**Files:** `src/client/ui/ui.ts`, `src/client/ui/screens.ts`
### 20. Direct UI visibility from Interaction FSM

**Status:** plan created; synchronization pending.

**Remaining:** replace the dual-signal system in `src/client/ui/ui.ts` (which uses both `screenModeSignal` and `interactionStateSignal`) with a single source of truth. The `InteractionState.mode` should directly drive the `applyUIVisibility` logic in `src/client/ui/visibility.ts`, ensuring perfect synchronization between game logic and DOM states.

**Files:** `src/client/ui/ui.ts`, `src/client/ui/visibility.ts`, `src/client/game/state-transition.ts`

### 21. Spectator UX Hardening

**Status:** baseline support shipped.

**Remaining:** review and polish the "spectator" experience. Currently, spectators use a stripped-down HUD. Ensure they have clear "Spectating" status indicators, can see all ship stats without interactive controls appearing, and have a unique "Game Over" summary that reflects the global outcome rather than personal fleet stats.

**Files:** `src/client/game/selection.ts`, `src/client/game/hud-orders.ts`, `src/client/ui/hud.ts`
