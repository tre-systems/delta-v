# Client Patterns

Supplement to `docs/CODING_STANDARDS.md`. That document covers naming conventions, function prefixes, `el()`/`listen()`/`visible()`/`text()`/`cls()` helper APIs, `setTrustedHTML`/`clearHTML` boundary rules, string-key serialization (`hexKey`/`parseHexKey`), derive/plan pattern, factory conventions, `Pick<T,K>` narrowing, and discriminated union style. This file documents gap analyses, consistency findings, known weaknesses, and implementation details not covered there.

Source pattern files: 08, 09, 10, 13, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 64, 65.

---

## Input & Commands

### Command Pattern
Key files: `game/commands.ts`, `game/command-router.ts`, `game/keyboard.ts`, `game/input-events.ts`, `game/main-interactions.ts`, `input.ts`

**Flow**: DOM event -> `InputEvent`/`KeyboardAction` -> `GameCommand` -> `dispatchGameCommand` -> domain handler. No game logic reads raw DOM events directly.

**Exhaustiveness**: The handler map uses `satisfies CommandHandlerMap` to guarantee compile-time coverage of every `GameCommand` type. Handler groups are split by domain (astrogation, combat, ordnance, logistics, fleet/navigation, UI/lifecycle) and spread into one object.

**Gaps**:
- Camera drag/pan, pinch zoom, double-click centering, and minimap clicks in `input.ts` mutate camera state directly, bypassing commands. Defensible for continuous interactions but means camera behaviour is not replayable.
- `handleMinimapClick` writes `camera.targetX`/`camera.targetY` directly.
- Some UI state changes in `session-signals.ts` are reactive derivations rather than commands -- appropriate since they are not user-initiated.

### 3-Layer Input Pipeline
Key files: `input.ts` (Layer 1: capture), `game/input-events.ts` (Layer 2: interpretation), `game/command-router.ts` (Layer 3: dispatch)

Layer 1 knows camera transforms and pointer state but not planning or turn rules. Layer 2 (`interpretInput`) is pure -- takes snapshots, returns `GameCommand[]`. Layer 3 routes to domain handlers.

Keyboard shortcuts and UI button clicks enter directly at Layer 3 by emitting `GameCommand` values. This is a sibling path, not a violation -- they share the same dispatch sink.

---

## State Management

### State Machine
Key files: `game/phase.ts`, `game/interaction-fsm.ts`, `game/phase-entry.ts`, `game/state-transition.ts`, `game/session-model.ts`

`ClientState` is a flat string union (11 values). Transitions are derived, not imperative -- `derivePhaseTransition` examines authoritative `GameState` and produces a `PhaseTransitionPlan`. `deriveInteractionMode` maps `ClientState` to a coarser `InteractionMode` with exhaustive `never` guard.

`CLIENT_STATE_ENTRY_RULES` is a `Record<ClientState, ClientStateEntryRule>` ensuring every state has an entry rule.

**Gaps**:
- `playing_movementAnim` is set imperatively by the animation system (client-only concept with no server phase).
- `connecting` and `waitingForOpponent` are set imperatively from connection lifecycle code (no corresponding `GameState`).
- No compile-time enforcement of which transitions are legal. `menu` -> `playing_combat` is representable but prevented in practice by `derivePhaseTransition` only returning sensible next states.
- A typed adjacency map (`Record<ClientState, Set<ClientState>>`) could add runtime validation but is not currently needed.

### Reactive Signals (Zero-Dependency)
Key files: `reactive.ts` (213 lines, zero imports), `reactive.test.ts`

Four primitives: `signal`, `computed`, `effect`, `batch`. Plus `DisposalScope` and `withScope`/`registerDisposer` for lifecycle management. No other reactivity system exists in the codebase.

**Implementation details**:
- Auto-tracking via module-level `active` context that records which subscriber sets are accessed during evaluation.
- `computed` is eager (evaluates at creation, stays live via internal effect). Simpler than lazy memo but does more work if rarely read.
- `batch` coalesces signal writes into one flush. Used in `applyClientStateTransition` for multi-signal updates.
- Reference equality (`===`) for change detection. Replacing `gameState` with a new object (every server update) always triggers effects even if logically identical. Effects must be cheap or guard internally.
- No `untrack` utility -- use `peek()` to read without subscribing.
- Diamond dependencies may fire effects more than once outside `batch`. The test suite explicitly allows this, verifying only final-state correctness.
- No error boundaries -- thrown errors in effects propagate uncaught.
- No debug tooling (signal graph visualizer or dependency logger).

**Leak prevention**: Bare `effect()` calls outside any scope or parent effect have no automatic disposal path. The `ownerCleanups` stack handles nested effects. `peek()` prevents accidental subscriptions in init code.

### Session Model (Aggregate Root)
Key files: `game/session-model.ts`

`ClientSession` is the single source of truth. Every piece of client state lives on it or is reachable through it.

**Reactive property pairs**: `defineReactiveSessionProperty` uses `Object.defineProperty` (non-configurable) so `session.state = 'menu'` transparently updates the backing signal. Companion `stateSignal` exposes `ReadonlySignal` for explicit subscriptions.

**Owned sub-stores**: `planningState: PlanningStore`, `logisticsState: LogisticsStore | null`.

**Narrowing**: `ClientSessionMessageContext`, `ClientSessionStateTransitionContext`, etc. use `Pick` to limit what each module can access.

**Test support**: `stubClientSession(overrides)` for partial overrides.

Non-reactive fields (`spectatorMode`, `scenario`, `aiDifficulty`, `transport`, `reconnectAttempts`) are plain properties -- they change infrequently or are not observed reactively.

### Planning Store
Key files: `game/planning.ts`

Centralized ephemeral client-side planning state. Four sub-domains: selection, astrogation, ordnance, combat. All stored as `Map<string, ...>` or `Set<string>`.

**Revision signal**: Single `revisionSignal` counter incremented on every mutation. Coarse-grained -- any change notifies all subscribers. Sufficient for current UI complexity; per-domain signals could be added if needed.

**Phase reset**: `enterPhase()` resets all sub-domains via `Object.assign(planningStore, createXxxState())`.

**Narrow view types**: `AstrogationPlanningView`, `CombatPlanningView`, etc. use `Pick<>` for read-only consumer access. No runtime enforcement -- relies on TypeScript's type system.

**Consistency**: No scattered planning state found outside this store. Renderer receives `PlanningState` (read-only), command router receives `PlanningStore` (with mutations).

---

## Rendering

### Canvas Renderer Factory
Key files: `renderer/renderer.ts`, `renderer/static-scene.ts`, `renderer/static-layer.ts`, and ~15 drawing modules under `renderer/`

`createRenderer(canvas, planningState)` composes 17 rendering layers drawn in specific order each frame. Each layer's logic lives in its own module exporting pure drawing functions that receive `CanvasRenderingContext2D` and data.

**Static scene caching**: Hex grids, stars, asteroids, gravity, and bodies render to an offscreen canvas. Cache key includes camera pos/zoom, canvas dims, body animation bucket (250ms), and destroyed asteroids. Avoids re-rendering thousands of hexes per frame. Falls back to regular canvas if `OffscreenCanvas` unavailable.

**Animation loop**: `requestAnimationFrame`-based. Computes delta time, checks canvas resize, updates camera, renders frame, completes elapsed animations.

**Permanent listeners**: `document.addEventListener('visibilitychange')` and `window.addEventListener('resize')` are added without removal. Acceptable for app-lifetime renderer but noted.

**`HEX_SIZE`** (28) defined in `renderer.ts` and imported centrally.

### Camera/Viewport Transform
Key files: `renderer/camera.ts`

`createCamera()` returns a `Camera` with current/target position+zoom, shake state, and canvas dimensions. Core operations: `applyTransform`, `screenToWorld`, `worldToScreen`, `zoomAt`, `pan`, `frameBounds`, `isVisible`, `shake`, `snapToTarget`.

**Consistency**: All coordinate transforms go through the camera. No raw pixel calculations for screen/world conversion found outside it. `hexToPixel`/`pixelToHex` in `shared/hex.ts` operate in world space only.

**Zoom-at-point**: Adjusts target position so the point under the cursor stays fixed. Clamps to `[minZoom, maxZoom]`.

**Culling**: `isVisible` uses rectangular check with margin -- appropriate for flat hex grid, would need updating for rotated/perspective views.

**Private state**: `CameraPrivate` is separate from public `Camera` interface.

### Animation Manager
Key files: `renderer/animation.ts`

`createMovementAnimationManager()` handles ship/ordnance movement animations. Game state is updated to post-movement before animation starts -- animation is purely cosmetic interpolation.

**Completion guarantees**:
- Fallback timer fires at `duration + 500ms`.
- Hidden tab: completes immediately on start or mid-animation via `handleVisibilityChange`.
- `completeAnimation()` clears state before calling `onComplete()` to prevent re-entrant issues.

**Trail accumulation**: `shipTrails` and `ordnanceTrails` (`Map<string, HexCoord[]>`) accumulate across turns with deduplication at join points. Cleared on game reset.

**DI for testing**: Accepts optional `now`, `setTimeout`, `clearTimeout`, `isDocumentHidden`, `durationMs` for deterministic tests.

---

## DOM & HTML

### Smart DOM Helpers
Key files: `dom.ts`

**Signal overloads**: `visible()`, `text()`, `cls()` accept either static values or `ReadonlySignal`, automatically creating effects for signals. Clean dual-mode API.

**Where raw DOM is justified**:
- Renderer: `document.createElement('canvas')` for canvas elements.
- Audio: `document.addEventListener` for one-time click/touchstart resume.
- Viewport: `addEventListener` for resize/orientationchange (infrastructure-level).
- Telemetry: global error handlers.

**Missing helpers**: No `attr()` for arbitrary reactive attribute setting. `el()` handles `disabled`, `title`, `data` but direct `setAttribute` calls exist where needed.

### Trusted HTML Boundary
Key files: `dom.ts` (lines 98-120)

**Known violation**: `hud-chrome-view.ts` sets `soundBtn.innerHTML` directly with static SVG markup instead of using `setTrustedHTML()`. Not a security risk (hardcoded SVG) but breaks auditability. Should use `setTrustedHTML(soundBtn, ...)`.

**Enforcement gap**: No lint rule (e.g., ESLint `no-restricted-properties` on `innerHTML`) to catch boundary violations automatically.

### Disposal Scope
Key files: `reactive.ts` (lines 7-12, 30-48, 91-127)

`createDisposalScope()` collects disposables (effects, computeds, plain functions) and disposes LIFO on `scope.dispose()`. Late registration guard: if scope is already disposed, new resources are immediately disposed.

**`withScope`**: Sets module-level `activeScope` so nested `effect()` and `listen()` calls auto-register. Used in input handler and UI manager setup.

**Owner cleanup within effects**: On re-run, nested effects and `registerDisposer` calls from the previous run are cleaned up before the new run. Prevents stacking subscriptions.

**No scope hierarchy**: Flat scopes only. Nesting via `scope.add(childScope)` or `scope.add(childDispose)`. Sufficient for current architecture.

**Thread safety**: `withScope` context is module-level global state. Could theoretically interleave in concurrent async tests, but client is single-threaded so not a real risk.

---

## Data Structures

### String-Key Serialization
Key files: `shared/hex.ts`

**Typing gap**: `PlanningState.lastSelectedHex` is typed `string | null` instead of `HexKey | null`. The value is always produced by `hexKey()` but the type does not enforce the brand.

**Logistics pair key**: `logistics-ui.ts` uses `"sourceId->targetId"` format -- same string-key principle, different serialization.

### Record-Based Type Mapping

**Data structure selection**:

| Structure | Use | Examples |
|-----------|-----|---------|
| `Map<K,V>` | Mutable runtime state | Planning maps, logistics amounts, trails, hex map |
| `Record<K,V>` | Static config, serialized data | Phase transitions, gravity choices, ship stats |
| `Set<K>` | Membership testing | Landing ships, acknowledged ships, gravity bodies |
| `Array<T>` | Ordered collections, small lists | Ships, ordnance, bases |

**Minor inefficiencies** (acceptable at current scale):
- `GameState.ships` uses `find()` for ID lookup -- under 20 ships per game.
- `destroyedAsteroids: HexKey[]` uses `includes()` instead of Set -- small arrays.
- `combatTargetedThisPhase?: string[]` used for membership checks -- typically very short.

---

## Architecture Stance

### Minimal Framework / Zero-Dependency Reactive

The entire client has zero runtime UI framework dependencies. The 213-line `reactive.ts` is the sole reactivity primitive. No React, MobX, RxJS, or any other reactivity system.

**What replaces frameworks**: Custom signals for reactivity, `el()` for DOM creation, factory functions for composition, esbuild for bundling, Vitest with raw DOM assertions for testing.

**Scaling considerations**:
- As UI grows (settings, lobby, chat), `el()` plus manual effects can become verbose compared to JSX. The `setTrustedHTML` boundary is the acknowledged improvement point.
- No component lifecycle -- disposal scopes serve this purpose but require manual wiring.
- No first-class `aria-*` support in `el()` -- accessibility attributes must be added manually.
- Only production `class` is `GameDO` (Cloudflare Durable Object requirement).

---

## Builder Pattern
Key files: `renderer/vectors.ts`, `renderer/map.ts`, `renderer/entities.ts`, `renderer/combat-fx.ts`, `renderer/minimap.ts`, `ui/hud.ts`, `ui/screens.ts`, `ui/ship-list.ts`, `game/astrogation-orders.ts`

30+ functions follow `build*` naming. All are pure -- take inputs, return new objects. The renderer uses "build then draw": `buildBodyView` computes positions/styles, then `renderBodies` draws them. Makes view computation testable without a Canvas.

**Naming boundary with `derive*`**: `derive*` computes decisions/transitions, `build*` constructs data structures. Some functions straddle the line (e.g., `deriveHudViewModel` both derives state and builds a view model). The `create*` prefix is reserved for stateful object construction, distinct from `build*` which produces immutable data.
