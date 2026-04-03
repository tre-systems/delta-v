# Delta-V Backlog

Remaining work only. Completed work belongs in git history.

Use this file for unfinished actionable work only. Do not duplicate shipped history, recurring review procedures, or long-form architecture rationale here; keep those in git history, [REVIEW_PLAN.md](./REVIEW_PLAN.md), and [ARCHITECTURE.md](./ARCHITECTURE.md) respectively.

## How to read this file

Items below are ordered **top-to-bottom by current recommended execution order**. Put the most important or most blocking work near the top. Reorder freely when priorities change.

Write backlog items so an agent can make best-effort progress directly from the repo. If a task still depends on an external decision, approval, or launch condition, make the in-repo draft or implementation work explicit and note the dependency separately.

Each item should use: **Status**, **Remaining**, and, when useful, **Files**, **Trigger**, or **Depends**.

Core architecture work such as the major FSM cleanup, multi-ship E2E coverage, opponent-turn feedback, and FSM-driven UI visibility is complete. The list below starts with the highest-leverage remaining runtime and client-architecture work, then smaller correctness and hygiene tasks, then optional or trigger-based work, then ongoing discipline items.

---

### 55. Enable `noImplicitReturns` in tsconfig

**Status:** not started.

**Remaining:** TypeScript's `noImplicitReturns` flag catches switch statements that silently return `undefined` for unhandled union variants. Enabling it will surface many of the 16 exhaustiveness gaps identified in item 49 as compile errors, making `never` guards mandatory rather than optional. Enable the flag, fix any resulting errors, and verify the build passes.

**Files:** `tsconfig.json`, any files that fail to compile after enabling
**Found by:** pattern audit: enforcement gaps

### 56. Add pre-commit grep checks for pattern violations

**Status:** not started.

**Remaining:** Add lightweight grep-based checks to `.husky/pre-commit` that catch the most impactful pattern violations before they land:
- Ban `innerHTML` assignment in `src/client/` outside `dom.ts` (enforces trusted HTML boundary)
- Ban `Math.random` in `src/shared/engine/` (enforces deterministic RNG injection)
- Ban `console.log` / `console.warn` / `console.error` in `src/shared/` (enforces engine purity)

These are ~5 lines of shell script per check. They complement the existing Biome lint step.

**Files:** `.husky/pre-commit`
**Found by:** pattern audit: enforcement gaps

### 57. Add import boundary tests for all layer directions

**Status:** not started.

**Remaining:** Only the server-to-client boundary has an existing test. Add tests that verify:
- `src/shared/` never imports from `src/client/` or `src/server/`
- `src/shared/engine/` never imports from platform code
- `src/client/` never imports from `src/server/`

Can be implemented as a simple grep/dependency-scan test or via Biome/ESLint import restrictions. Complements the existing lint boundary rule work in the backlog.

**Files:** test file (new), or lint config
**Found by:** pattern audit: enforcement gaps

### 58. Remove dead `ErrorCode.INVALID_PLAYER`

**Status:** not started.

**Remaining:** `ErrorCode.INVALID_PLAYER` is defined in `domain.ts` line ~64 but never used anywhere in the codebase. Remove it to keep the error code enum honest, or add it to the validation paths that should use it (e.g., `processFleetReady` which currently lacks player identity validation, see item 46).

**Files:** `src/shared/types/domain.ts`
**Found by:** pattern audit: error handling

### Simplify runtime and input orchestration

**Status:** not started.

**Remaining:** `client-runtime.ts`, `main-interactions.ts`, `command-router.ts`, and `input.ts` still spread one user interaction flow across DOM event handling, keyboard translation, command routing, and gameplay side effects. Define a smaller boundary so browser and UI events become one typed action stream before game-logic dispatch.

**Files:** `src/client/game/client-runtime.ts`, `src/client/game/main-interactions.ts`, `src/client/game/command-router.ts`, `src/client/game/input.ts`

### Split logistics UI state from DOM rendering

**Status:** not started.

**Remaining:** `logistics-ui.ts` still mixes store creation, transfer calculations, DOM rendering, and UI event wiring in one large module. Separate the state and model layer from DOM rendering and event handling so logistics changes stop touching one file.

**Files:** `src/client/game/logistics-ui.ts`, related tests

### Decompose the remaining client kernel composition layers

**Status:** partially complete.

**Baseline shipped:** session, network, and replay wiring moved into `main-session-shell.ts`; reactive session effects split into `session-planning-effects.ts` and `session-ui-effects.ts`; `client-kernel.ts` is smaller and mostly composition-oriented now.

**Remaining:** continue reducing coordination load in the remaining composition layers, especially runtime and bootstrap orchestration and top-level interaction wiring.

**Files:** `src/client/game/client-kernel.ts`, `src/client/game/client-runtime.ts`, `src/client/game/main-interactions.ts`

### Consolidate planning snapshot types

**Status:** not started.

**Remaining:** `planning.ts` still defines several snapshot aliases such as `AstrogationPlanningSnapshot` and `HudPlanningSnapshot`, plus supporting `Pick` and intersection helper types. Collapse redundant aliases where possible or use narrower `Pick`s directly at call sites to reduce type-surface churn.

**Files:** `src/client/game/planning.ts`, consumers in `src/client/game/`

### Extract a shared test factory module

**Status:** not started.

**Remaining:** test files independently redefine `createShip()`, `createState()`, and similar builders with deep boilerplate. Extract a shared test factory with smart defaults to cut repetition across client and engine tests.

**Files:** test files across `src/client/game/` and `src/shared/engine/`

### Route all HTML writes through the trusted HTML boundary

**Status:** not started.

**Remaining:** `soundBtn.innerHTML = ...` in `hud-chrome-view.ts` bypasses the `setTrustedHTML()` boundary established in `dom.ts`. Route this through `setTrustedHTML()`. Consider adding a lint rule that bans direct `innerHTML` assignment so the boundary does not regress.

**Files:** `src/client/ui/hud-chrome-view.ts`, `src/client/dom.ts`

**Found by:** pattern catalogue: Trusted HTML Boundary

### Add exhaustive `never` guards to command routing and protocol validation

**Status:** superseded by item 49 (broader audit found 16 switches lacking guards, not just 2).

### Standardize on `engineFailure()` helper usage

**Status:** not started.

**Remaining:** `processCombat` mixes inline `{ error: { code, message } }` construction with the `engineFailure()` helper used elsewhere. Standardize on the helper. Consider a combined validation helper if it removes repeated guard-clause boilerplate at engine entry points.

**Files:** `src/shared/engine/combat.ts`, `src/shared/engine/game-engine.ts`

**Found by:** pattern catalogue: Engine Error Return; Guard Clause Validation

### Unify game initialization with the standard publication pipeline

**Status:** not started.

**Remaining:** `initGameSession` in `match.ts` has its own publication path calling `verifyProjectionParity` and `broadcastFiltered` directly rather than routing through `publishStateChange`. Unify it with the standard pipeline to reduce the number of state-change paths to audit.

**Files:** `src/server/game-do/match.ts`, `src/server/game-do/publication.ts`

**Found by:** pattern catalogue: SRP Choke Points

### Align parity normalization with the actual fields that diverge

**Status:** not started.

**Remaining:** `normalizeStateForParity` in production only strips the `connected` field, but the test suite also filters `ready` and `detected`. If those fields legitimately diverge between live and projected state, extend the production normalizer to match. Consider structured field-level diff logging on mismatch instead of only logging turn and phase.

**Files:** `src/server/game-do/publication.ts`, related tests

**Found by:** pattern catalogue: Parity Check

### Move remaining AI behavior behind config

**Status:** not started.

**Remaining:** several AI behaviors still bypass the config-driven scoring pattern:
- map boundary avoidance uses hardcoded constants instead of config weights
- easy-mode random burn override uses a hardcoded probability
- hard-mode target distribution is gated by a string check rather than a config flag
- `combatStayLandedPenalty` is applied inline rather than via a dedicated scorer
- passenger escort and emergency scoring still use hardcoded weights

Add corresponding fields to `AIDifficultyConfig` and route these decisions through the config system.

**Files:** `src/shared/ai/config.ts`, `src/shared/ai/scoring.ts`, `src/shared/ai/index.ts`

**Found by:** pattern catalogue: Strategy Config Scoring

### Add type-safe scenario keys

**Status:** not started.

**Remaining:** `SCENARIOS` still uses an open `string` key unlike `AI_CONFIG`, which uses a closed union. Add a `ScenarioKey` union for compile-time safety. Consider typed `ScenarioTag` and `BodyName` unions to replace magic strings throughout scenario and map definitions, and add an `isValidScenario` guard for network and URL inputs.

**Files:** `src/shared/map-data.ts`, `src/shared/types/scenario.ts`, consumers

**Found by:** pattern catalogue: Multiton Preset Registries

### Extend branded types to ship, ordnance, and game IDs

**Status:** not started.

**Remaining:** ship IDs, ordnance IDs, and game IDs are still plain `string` throughout the codebase. Brand these, similar to `HexKey`, `RoomCode`, and `PlayerToken`, to prevent accidental mixing. Also add an `isHexKey` runtime validation guard for parsing boundaries, and change `lastSelectedHex` from `string` to `HexKey`.

**Files:** `src/shared/types/domain.ts`, `src/shared/hex.ts`, `src/shared/ids.ts`, consumers throughout

**Found by:** pattern catalogue: Branded Types; String-Key Serialization

### Enforce layer boundaries with lint rules

**Status:** not started.

**Remaining:** the `shared` to `server` and `shared` to `client` import boundaries are enforced mostly by convention and one test. Add lint import restriction rules to catch violations earlier, and add a sub-layer boundary test verifying `shared/engine/` imports only from other `shared/` modules.

**Files:** ESLint config, boundary test files

**Found by:** pattern catalogue: Layered Architecture

### Continue best-effort DOM accessibility follow-up

**Status:** partial.

**Baseline shipped:** automated Playwright plus axe checks run in `test:e2e:a11y` and `verify`. A best-effort manual pass on **2026-04-03** tightened input naming, live-region semantics, and help-overlay dialog focus handling.

**Remaining:** rerun the checklist in [A11Y.md](./A11Y.md) after major UI changes, verify keyboard flow and DOM semantics for menus, HUD chrome, fleet builder, and chat, fix obvious issues in-repo, and record results. Treat visual contrast and real-device touch behavior as best-effort checks from the available environment, not blockers on their own.

**Files:** `docs/A11Y.md`, `static/index.html`, `static/style.css`, `src/client/ui/`, `e2e/a11y.spec.ts`

### Keep privacy disclosure and copy aligned with actual behavior

**Status:** partial.

**Baseline shipped:** a brief in-product operational disclosure now exists in the main menu clarifying anonymous diagnostics, completed-match archives, and the live-only-by-default chat posture.

**Remaining:** keep user-facing product and repo copy aligned with actual telemetry, retention, and replay behavior; draft plain-language disclosure text from [PRIVACY_TECHNICAL.md](./PRIVACY_TECHNICAL.md) where needed; and avoid launch or site copy that overstates guarantees. If formal legal review is later required, treat that as an approval step on top of drafted copy, not as the backlog task itself.

**Files:** `docs/PRIVACY_TECHNICAL.md`, `README.md`, `static/index.html`, future site or launch copy

### Add global edge limits for join and replay probes if abuse warrants it

**Status:** baseline shipped.

**Baseline shipped:** shared per-isolate window per hashed IP: **100** combined `GET /join/:code` and `GET /replay/:code` per **60s**.

**Remaining:** add WAF or `[[ratelimits]]` only if distributed scans still wake durable objects or cost too much.

**Files:** `wrangler.toml`, Cloudflare dashboard, `src/server/index.ts`

### Prepare public matchmaking with longer room identifiers

**Status:** not started. Product-dependent.

**Remaining:** if the product moves beyond shared short codes, implement longer opaque room IDs or signed invites and update the join and share UX accordingly.

**Files:** `src/server/protocol.ts`, lobby and join UI, share-link format

### Add a trusted HTML path for any future user-controlled markup

**Status:** not started. Trigger-based.

**Remaining:** if chat, player names, or modded scenarios ever render as HTML, add a single sanitizer boundary, for example DOMPurify inside `dom.ts`, and route all user-controlled markup through it.

**Files:** `src/client/dom.ts`, client call sites, optional dependency add

### Parallelize chunk reads during event stream recovery if match size grows

**Status:** not started. Optimization.

**Remaining:** `readChunkedEventStream` currently loads chunks sequentially. For long matches with many chunks, `Promise.all` would be faster. Low priority unless archive size or recovery time becomes a real problem.

**Files:** `src/server/game-do/archive-storage.ts`

**Found by:** pattern catalogue: Chunked Event Storage

### 44. Renderer addEventListener leaks

**Status:** not started.

**Remaining:** `renderer.ts` attaches three event listeners with no cleanup path:
- `document.addEventListener('visibilitychange', ...)` (line ~107)
- `window.addEventListener('resize', resize)` (line ~542)
- `window.visualViewport?.addEventListener('resize', resize)` (line ~543)

If the renderer is ever torn down and recreated these will leak. Add cleanup to the renderer's dispose path or track via `listen()` helper.

**Files:** `src/client/renderer/renderer.ts`
**Found by:** pattern audit: DOM/disposal

### 45. `applyDisconnectForfeit` mutates state without cloning

**Status:** not started.

**Remaining:** Unlike all other exported engine functions, `applyDisconnectForfeit` in `util.ts` mutates its `state` parameter directly without `structuredClone`. It is designed for external use by the server. The server caller should either clone before calling, or the function should follow the clone-on-entry convention.

**Files:** `src/shared/engine/util.ts` (line ~380)
**Found by:** pattern audit: engine purity

### 46. `processFleetReady` skips standard validation and transition

**Status:** not started.

**Remaining:** `processFleetReady` manually checks `state.phase !== 'fleetBuilding'` instead of using `validatePhaseAction`, so it does not validate player identity. It also directly assigns `state.phase = 'astrogation'` instead of using `transitionPhase()`, bypassing the phase transition validation table.

**Files:** `src/shared/engine/fleet-building.ts` (lines ~33, ~193)
**Found by:** pattern audit: error handling / validation

### 47. `createGame` throws instead of returning Result

**Status:** not started.

**Remaining:** Two `throw new Error(...)` calls in `game-creation.ts` (scenario player count assertion at line ~66, starting hex placement failure at line ~124) crash rather than returning a `Result`. Convert `createGame` to return `Result<GameState, EngineError>` for consistency with the rest of the engine.

**Files:** `src/shared/engine/game-creation.ts`
**Found by:** pattern audit: error handling

### 48. WebSocket upgrade path has no HTTP-level rate limit

**Status:** not started.

**Remaining:** The `/ws/:code` endpoint at `index.ts` line ~169 forwards directly to the Durable Object with no IP-based rate check. A client could rapidly open and close WebSocket connections. The per-message rate limit only applies after establishment. Consider adding a connection-establishment rate limit alongside the existing per-message throttle.

**Files:** `src/server/index.ts` (line ~169), `src/server/reporting.ts`
**Found by:** pattern audit: rate limiting

### 49. Add `never` exhaustiveness guards to 16 switch statements

**Status:** not started.

**Remaining:** 16 switch/dispatch sites on discriminated unions lack compile-time `never` guards. Highest priority:
- `validateClientMessage` and `validateServerMessage` in `protocol.ts` — network boundary, silently rejects unknown types
- `deriveClientMessagePlan` in `client-message-plans.ts` — silently returns undefined for new S2C types
- `resolveUIEventPlan` in `ui-event-router.ts` — silently ignores new UI events
- `formatMovementEventEntry`/`formatMovementEventToast` in `formatters.ts`/`toast.ts`
- `runGameDoAlarm` in `alarm.ts`
- Various input interpretation switches in `input-events.ts`

Subsumes and expands backlog item 37 (which only covered command router and protocol validator). Remove item 37 in favor of this broader item.

**Files:** `src/shared/protocol.ts`, `src/client/game/client-message-plans.ts`, `src/client/game/ui-event-router.ts`, `src/client/ui/formatters.ts`, `src/client/renderer/toast.ts`, `src/server/game-do/alarm.ts`, `src/client/game/input-events.ts`, `src/client/game/commands.ts`, `src/client/game/local-game-flow.ts`, `src/client/renderer/ship-decor.ts`
**Found by:** pattern audit: discriminated unions

### 50. Remove `Math.random` default parameters from shared code

**Status:** not started.

**Remaining:** Three exported functions in shared code have `rng: () => number = Math.random` default parameters, meaning callers can accidentally skip RNG injection and break determinism:
- `src/shared/ai/ordnance.ts` line ~21
- `src/shared/ai/astrogation.ts` line ~376
- `src/shared/engine/game-creation.ts` line ~144

Make `rng` mandatory (no default) to force callers to be explicit.

**Files:** `src/shared/ai/ordnance.ts`, `src/shared/ai/astrogation.ts`, `src/shared/engine/game-creation.ts`
**Found by:** pattern audit: engine purity / deterministic RNG

### 51. Add `Readonly` wrappers to major lookup tables

**Status:** not started.

**Remaining:** Five core lookup tables are mutable at runtime despite being logically constant:
- `SHIP_STATS` (`constants.ts`)
- `ORDNANCE_MASS` (`constants.ts`)
- `GUN_COMBAT_TABLE` (`combat.ts`) — should be `readonly (readonly number[])[]`
- `OTHER_DAMAGE_TABLES` (`combat.ts`)
- `AI_CONFIG` (`ai/config.ts`)

Wrap each in `Readonly<>` or use `as const` / `Object.freeze` to prevent accidental mutation.

**Files:** `src/shared/constants.ts`, `src/shared/combat.ts`, `src/shared/ai/config.ts`
**Found by:** pattern audit: data-driven lookup tables

### 52. Fix `computeBaseVelocityMod` hardcoded threshold

**Status:** not started.

**Remaining:** `computeBaseVelocityMod` in `combat.ts` line ~325 hardcodes the velocity modifier threshold as `2` instead of using the existing `VELOCITY_MODIFIER_THRESHOLD` constant that the sibling function `computeVelocityModToTarget` correctly uses. This is a consistency bug.

**Files:** `src/shared/combat.ts`
**Found by:** pattern audit: data-driven lookup tables

### 53. Extract protocol validation magic numbers to named constants

**Status:** not started.

**Remaining:** Three inline magic numbers in `protocol.ts` validation should be named constants:
- `99` — max attack strength (line ~269)
- `9999` — max transfer amount (line ~342)
- `200` — max chat message length (line ~382)

**Files:** `src/shared/protocol.ts`
**Found by:** pattern audit: data-driven lookup tables

### 54. Widen `HexKey` branding to movement.ts parameters

**Status:** not started.

**Remaining:** Several parameters in `movement.ts` accept `string` or `Set<string>` where the values are hex keys:
- `destroyedBases` parameter typed `Set<string>` (lines ~101, 167, 189, 289) — domain type is `HexKey[]`
- `weakGravityChoices` typed `Record<string, boolean>` (lines ~24, 288) — should be `Record<HexKey, boolean>`
- Same issue propagates to `ai/astrogation.ts` (lines ~566, 588, 707, 720)

Also `getOwnedPlanetaryBases` in `util.ts` line ~127 widens `HexKey` to `string` in its return type.

**Files:** `src/shared/movement.ts`, `src/shared/ai/astrogation.ts`, `src/shared/engine/util.ts`
**Found by:** pattern audit: branded types

### Maintain `GameState` schema version and replay compatibility discipline

**Status:** ongoing discipline. Required on schema bumps.

**Remaining:** whenever `GameState.schemaVersion` changes, document the migration path, replay compatibility, projector behavior, and any client assumptions. Extend tests around `event-projector` and recovery paths as part of the same change.

**Files:** `src/shared/types/domain.ts`, `src/shared/engine/event-projector.ts`, `docs/ARCHITECTURE.md`, relevant tests

### 59. Thread `matchSeed` through initial game creation and `gameCreated` projection

**Status:** not started.

**Remaining:** `initGameSession` allocates and stores `matchSeed`, and the `gameCreated` event carries it, but the authoritative setup path still calls `createGame(...)` without passing a seeded RNG and the lifecycle projector rebuilds `gameCreated` with `() => 0`. Use the same deterministic seed for both authoritative setup and projection so hidden-identity designation and any future setup randomness are reproducible directly from the event stream instead of being corrected by follow-up events.

**Files:** `src/server/game-do/match.ts`, `src/shared/engine/event-projector/lifecycle.ts`, `src/shared/engine/game-creation.ts`, `src/shared/prng.ts`, related tests
**Depends:** item 50 if `createGame` RNG is made mandatory first
**Found by:** pattern catalogue: Deterministic RNG Injection; Event Sourcing; Visitor Event Projection

### 60. Emit or replay turn-advance scenario-rule mutations explicitly

**Status:** not started.

**Remaining:** `advanceTurn()` applies reinforcements and fleet conversion in memory, but the event stream only records `turnAdvanced`, and the lifecycle projector only replays player rotation and damage recovery. Either emit dedicated events for reinforcement arrival and fleet conversion, or refactor the projector to share the same turn-advance mutation logic, so replay and parity remain correct once those scenario rules are used.

**Files:** `src/shared/engine/turn-advance.ts`, `src/shared/engine/engine-events.ts`, `src/shared/engine/event-projector/lifecycle.ts`, related tests
**Trigger:** any scenario enabling `scenarioRules.reinforcements` or `scenarioRules.fleetConversion`
**Found by:** pattern catalogue: Event Sourcing; Visitor Event Projection; Parity Check

### 61. Add coverage thresholds for server and client hotspots

**Status:** not started.

**Remaining:** `vitest.config.ts` currently enforces coverage floors only for `src/shared/**/*.ts`. Add selective thresholds for high-value non-shared paths so regressions outside the engine fail CI too. Good first candidates are `src/server/game-do/**/*.ts` and focused client modules with existing unit tests such as `src/client/game/**/*.ts` or the custom reactive / DOM helpers.

**Files:** `vitest.config.ts`
**Found by:** pattern catalogue: Coverage Thresholds

### 62. Use `ErrorCode` for client-side error handling, not just telemetry

**Status:** not started.

**Remaining:** incoming S2C `error` messages already carry optional `ErrorCode`, but `applyErrorPlan` in `message-handler.ts` only logs the code to telemetry and shows the raw message toast. Add code-aware handling for common cases such as invalid input, turn/phase mistakes, and state conflicts so the client can provide clearer recovery guidance without parsing strings.

**Files:** `src/client/game/message-handler.ts`, `src/client/game/client-message-plans.ts`, related UI tests
**Found by:** pattern catalogue: Error Code Enum

### 63. Reuse the shared `AIDifficulty` type through the UI event flow

**Status:** not started.

**Remaining:** the shared AI registry uses a single `AIDifficulty` union, but the UI flow weakens that by redefining the same union in `src/client/ui/events.ts` and restating it inline in `src/client/game/ui-event-router.ts` and `src/client/game/main-interactions.ts`. Import the shared alias end-to-end so difficulty keys stay coupled to the canonical registry type.

**Files:** `src/client/ui/events.ts`, `src/client/game/ui-event-router.ts`, `src/client/game/main-interactions.ts`, any affected tests
**Found by:** pattern catalogue: Multiton Preset Registries
