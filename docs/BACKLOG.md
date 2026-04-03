# Delta-V Backlog

Remaining work only. Completed items are in git history.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

**How this list is ordered**

Items below are ordered **top-to-bottom by current recommended execution priority**. Higher-leverage architecture work comes first, then quality/compliance follow-up, then optional or trigger-based work.

Numeric labels are **stable IDs**, not ranking numbers. They may be non-contiguous when shipped items are removed.

Write backlog items so an agent can make best-effort progress directly from the repo. If a task still depends on an external decision, approval, or launch condition, make the in-repo draft/implementation work explicit and note the dependency separately.

**Triage format**

Each item should use: **Status**, **Remaining**, and (when useful) **Depends / Files / Trigger**.

### Current execution order

Core architecture work (`17`-`20`) is complete: exhaustive FSM switches, multi-ship E2E coverage, opponent-turn status feedback, and FSM-driven UI visibility. The remaining list starts with the highest-leverage client/runtime cleanup, then the smaller type/test hygiene tasks, then the best-effort accessibility/privacy follow-up, then conditional launch or product work.

---

### 32. Simplify runtime and input orchestration

**Status:** not started.

**Remaining:** `client-runtime.ts`, `main-interactions.ts`, `command-router.ts`, and `input.ts` still spread one user interaction flow across DOM event handling, keyboard translation, command routing, and gameplay side effects. Define a smaller boundary so browser/UI events become one typed action stream before game logic dispatch.

**Files:** `src/client/game/client-runtime.ts`, `src/client/game/main-interactions.ts`, `src/client/game/command-router.ts`, `src/client/game/input.ts`

### 33. Split logistics UI state from DOM rendering

**Status:** not started.

**Remaining:** `logistics-ui.ts` still mixes store creation, transfer calculations, DOM rendering, and UI event wiring in one large module. Separate the state/model layer from DOM rendering and event handling so logistics changes stop touching one file.

**Files:** `src/client/game/logistics-ui.ts`, related tests

### 31. Decompose client kernel composition root

**Status:** partially complete.

**Baseline shipped:** session/network/replay wiring moved into `main-session-shell.ts`; reactive session effects split into `session-planning-effects.ts` and `session-ui-effects.ts`; `client-kernel.ts` is smaller and mostly composition-oriented now.

**Remaining:** continue reducing coordination load in the remaining composition layers, especially runtime/bootstrap orchestration and top-level interaction wiring.

**Files:** `src/client/game/client-kernel.ts`, `src/client/game/client-runtime.ts`, `src/client/game/main-interactions.ts`

### 24. Consolidate planning snapshot types

**Status:** not started.

**Remaining:** `planning.ts` still defines several snapshot aliases (`AstrogationPlanningSnapshot`, `HudPlanningSnapshot`, etc.) plus supporting `Pick` / intersection helper types. Collapse redundant aliases where possible or use narrower `Pick`s directly at call sites to reduce type-surface churn.

**Files:** `src/client/game/planning.ts`, consumers in `src/client/game/`

### 28. Shared test factory module

**Status:** not started.

**Remaining:** test files independently redefine `createShip()`, `createState()`, and similar builders with deep boilerplate. Extract a shared test factory with smart defaults to cut repetition across client and engine tests.

**Files:** test files across `src/client/game/` and `src/shared/engine/`

### 7. Best-effort DOM accessibility follow-up

**Status:** partial.

**Baseline shipped:** automated Playwright + axe checks run in `test:e2e:a11y` and `verify`. A best-effort manual pass on **2026-04-03** tightened input naming, live-region semantics, and help-overlay dialog focus handling.

**Remaining:** rerun the checklist in [A11Y.md](./A11Y.md) after major UI changes, verify keyboard flow and DOM semantics for menus, HUD chrome, fleet builder, and chat, fix obvious issues in-repo, and record results. Treat visual contrast and real-device touch behavior as best-effort checks from the available environment, not blockers on their own.

**Files:** `docs/A11Y.md`, `static/index.html`, `static/style.css`, `src/client/ui/`, `e2e/a11y.spec.ts`

### 2. Privacy disclosure and copy alignment

**Status:** partial.

**Baseline shipped:** a brief in-product operational disclosure now exists in the main menu clarifying anonymous diagnostics, completed-match archives, and the "live-only by default" chat posture.

**Remaining:** keep user-facing product and repo copy aligned with actual telemetry, retention, and replay behavior; draft plain-language disclosure text from [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) where needed; and avoid launch/site copy that overstates guarantees. If formal legal review is later required, treat that as an approval step on top of the drafted copy, not as the backlog task itself.

**Files:** `docs/PRIVACY_TECHNICAL.md`, `README.md`, `static/index.html`, future site/launch copy

### 8. Global edge limits for join/replay probes — optional

**Status:** baseline shipped.

**Baseline shipped:** shared per-isolate window per hashed IP — **100** combined `GET /join/:code` + `GET /replay/:code` per **60s**.

**Remaining:** add WAF or `[[ratelimits]]` only if distributed scans still wake DOs or cost too much.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### 15. Public matchmaking prep (longer room identifiers)

**Status:** not started; product-dependent.

**Remaining:** if the product moves beyond shared short codes, implement longer opaque room IDs or signed invites and update the join/share UX accordingly.

**Files:** `src/server/protocol.ts`, lobby/join UI, share-link format

### 16. Trusted HTML path for user-controlled content

**Status:** not started; trigger-based.

**Remaining:** if chat, player names, or modded scenarios ever render as HTML, add a single sanitizer boundary (for example DOMPurify inside `dom.ts`) and route all user-controlled markup through it.

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### 34. Trusted HTML boundary violation

**Status:** not started.

**Remaining:** `soundBtn.innerHTML = ...` in `hud-chrome-view.ts` bypasses the `setTrustedHTML()` boundary established in `dom.ts`. Route this through `setTrustedHTML()`. Consider adding an ESLint `no-restricted-properties` rule banning direct `innerHTML` assignment to prevent future violations.

**Files:** `src/client/ui/hud-chrome-view.ts` (line ~368), `src/client/dom.ts`
**Found by:** pattern catalogue #40 (Trusted HTML Boundary)

### 35. Extend branded types to ship, ordnance, and game IDs

**Status:** not started.

**Remaining:** ship IDs, ordnance IDs, and game IDs are plain `string` throughout the codebase. Branding these (like `HexKey`, `RoomCode`, `PlayerToken`) would prevent accidental mixing. Also add an `isHexKey` runtime validation guard for parsing boundaries, and fix `lastSelectedHex` typing from `string` to `HexKey`.

**Files:** `src/shared/types/domain.ts`, `src/shared/hex.ts`, `src/shared/ids.ts`, consumers throughout
**Found by:** pattern catalogue #27 (Branded Types), #45 (String-Key Serialization)

### 36. Consistent `engineFailure()` helper usage

**Status:** not started.

**Remaining:** `processCombat` mixes inline `{ error: { code, message } }` construction (~10 occurrences) with the `engineFailure()` helper used everywhere else. Standardize on the helper. Also consider a combined `validatePhaseAction` + `engineFailure` helper to reduce the 2-line boilerplate repeated at every engine entry point.

**Files:** `src/shared/engine/combat.ts`, `src/shared/engine/game-engine.ts`
**Found by:** pattern catalogue #25 (Engine Error Return), #26 (Guard Clause Validation)

### 37. Add exhaustive `never` guards to command router and protocol validator

**Status:** not started.

**Remaining:** the event projector uses exhaustive `never` checks for compile-time safety, but `dispatchGameCommand` in `command-router.ts` and `validateClientMessage` in `protocol.ts` use `default` fallbacks instead. Adding `never` guards would catch unhandled command/message types at compile time when new variants are added.

**Files:** `src/client/game/command-router.ts`, `src/shared/protocol.ts`
**Found by:** pattern catalogue #23 (Discriminated Unions)

### 38. AI config completeness — eliminate hardcoded behavior

**Status:** not started.

**Remaining:** several AI behaviors bypass the config-driven scoring pattern:
- Map boundary avoidance uses hardcoded constants (`severity * severity * 25`, `edgeDist < 5`) instead of config weights.
- Easy-mode random burn override uses hardcoded probability (`rng() < 0.25`).
- Hard-mode target distribution is gated by `difficulty === 'hard'` string check rather than a config flag.
- `combatStayLandedPenalty` is applied inline in `scoreCourse` rather than in a dedicated scorer.
- Passenger escort and emergency scoring use hardcoded weights not in `AIDifficultyConfig`.

Add corresponding fields to `AIDifficultyConfig` and route through the config system.

**Files:** `src/shared/ai/config.ts`, `src/shared/ai/scoring.ts`, `src/shared/ai/index.ts`
**Found by:** pattern catalogue #11 (Strategy Config Scoring)

### 39. Parity check normalization alignment

**Status:** not started.

**Remaining:** `normalizeStateForParity` in production only strips the `connected` field, but the test suite also filters `ready` and `detected`. If these fields legitimately diverge between live and projected state, the production normalizer should be extended to match. Also consider structured field-level diff logging on mismatch instead of only logging turn/phase.

**Files:** `src/server/game-do/publication.ts`, related test files
**Found by:** pattern catalogue #32 (Parity Check)

### 40. Type-safe scenario keys

**Status:** not started.

**Remaining:** `SCENARIOS` uses an open `string` key unlike `AI_CONFIG` which uses a closed `AIDifficulty` union. Add a `ScenarioKey` union type for compile-time safety. Also consider typed `ScenarioTag` and `BodyName` unions to replace magic strings throughout scenario and map definitions. Add an `isValidScenario(key): key is ScenarioKey` guard for network/URL input validation.

**Files:** `src/shared/map-data.ts`, `src/shared/types/scenario.ts`, consumers
**Found by:** pattern catalogue #22 (Multiton Preset Registries)

### 41. Game initialization publication bypass

**Status:** not started.

**Remaining:** `initGameSession` in `match.ts` has its own publication path calling `verifyProjectionParity` and `broadcastFiltered` directly rather than routing through `publishStateChange`. Unifying this with the standard pipeline would reduce the number of state-change paths to audit.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`
**Found by:** pattern catalogue #06 (SRP Choke Points)

### 42. Layer boundary enforcement via ESLint

**Status:** not started.

**Remaining:** the `shared/` → `server/` and `shared/` → `client/` import boundaries are enforced by convention and one test (server→client). Add ESLint import restriction rules to catch violations at the IDE level. Also add a sub-layer boundary test verifying `shared/engine/` only imports from other `shared/` modules (not platform code).

**Files:** `.eslintrc.*` or `eslint.config.*`, boundary test files
**Found by:** pattern catalogue #03 (Layered Architecture)

### 43. Parallel chunk reads in event stream recovery

**Status:** not started; optimization.

**Remaining:** `readChunkedEventStream` loads chunks sequentially with `await` per iteration. For long matches (5+ chunks), `Promise.all` would be faster. Low priority since typical matches produce 2–5 chunks.

**Files:** `src/server/game-do/archive-storage.ts`
**Found by:** pattern catalogue #33 (Chunked Event Storage)

### 11. `GameState` schema version and replay compatibility

**Status:** ongoing discipline; required on schema bumps.

**Remaining:** when bumping `GameState.schemaVersion`, document the migration path, replay compatibility, projector behavior, and any client assumptions. Extend tests around `event-projector` and recovery paths as part of the same change.

**Files:** `src/shared/types/domain.ts`, `src/shared/engine/event-projector.ts`, `docs/ARCHITECTURE.md`, relevant tests
