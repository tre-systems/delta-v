# Delta-V Architecture & Design Document

Delta-V is an online multiplayer space combat and racing game. This document outlines the high-level architecture, core systems, design patterns, module-level analysis, and guidance for future work including reusability across other hex-based games.

## 1. High-Level Architecture

Delta-V employs a full-stack TypeScript architecture built around a **shared side-effect-free engine with authoritative edge sessions** model.

```
shared/          → Game logic (no I/O, fully testable, side-effect-free)
server/          → Thin Durable Object multiplayer shell
client/          → State machine + Canvas renderer + DOM UI
```

### Key Technologies
- **Language**: TypeScript (strict mode) across the entire stack.
- **Frontend**: HTML5 Canvas 2D API for rendering (`client/renderer/renderer.ts`), raw DOM/Events for UI and Input. No heavy frameworks (React/Vue/etc.) are used, ensuring maximum performance for the game loop.
- **Backend**: Cloudflare Workers for HTTP routing and Cloudflare Durable Objects for authoritative game state and WebSocket management.
- **Build & Tools**: `esbuild` for lightning-fast client bundling, `wrangler` for local testing and deployment, and `vitest` for unit testing.

### Key Architectural Strengths
- **Side-effect-free engine.** The shared engine has no I/O: no DOM, no network, no storage. The DO wraps it with persistence and WebSocket plumbing. This makes everything testable and portable. Note: the engine mutates `GameState` in place rather than returning new immutable objects — see [Engine Mutation Model](#engine-mutation-model) for details and implications.
- **Transport abstraction.** `GameTransport` decouples the client from WebSocket vs local (AI) play. The client doesn't know or care where state comes from.
- **Functional style throughout.** Pure derivation functions (`deriveHudViewModel`, `deriveKeyboardAction`, `deriveBurnChangePlan`), mandatory injectable RNG, `cond()` for branching.
- **Scenario-driven.** `ScenarioRules` controls behaviour: ordnance types, base sharing, combat enabled, checkpoints, escape edges. New scenarios can vary gameplay without engine changes.
- **Hidden state filtering.** `filterStateForPlayer` hides fugitive identities in escape scenarios — the server never leaks information the client shouldn't have.

---

## 2. Core Systems Design

The architecture is divided into three distinct layers: Shared Logic, Server, and Client.

### A. Shared Game Engine (`shared/`)
This is the heart of the project. All game rules live in a shared folder, making the system robust and completely unit-testable.

#### Module Inventory

| Module | LOC | Purpose | Reusability |
|--------|-----|---------|-------------|
| `hex.ts` | 245 | Axial hex math: distance, neighbours, line draw, pixel conversion | **Fully generic** — zero game knowledge |
| `util.ts` | 110 | Functional collection helpers (`sumBy`, `minBy`, `indexBy`, `cond`, etc.) | **Fully generic** — no game knowledge |
| `types.ts` | 300 | All interfaces: `GameState`, `Ship`, `Ordnance`, C2S/S2C messages, scenarios | Game-specific |
| `constants.ts` | 65 | Ship stats, ordnance mass, detection ranges, animation timing | Game-specific |
| `movement.ts` | 320 | Vector movement with gravity, fuel, takeoff/landing, crash detection | Game-specific |
| `combat.ts` | 490 | Gun combat tables, LOS, range/velocity mods, heroism, counterattack | Game-specific |
| `map-data.ts` | 535 | Solar system bodies, gravity rings, bases, 8 scenario definitions | Game-specific |
| `ai.ts` | 725 | Rule-based AI with three difficulty levels | Game-specific |
| `engine/game-engine.ts` | 720 | Pure state machine: game creation, phase orchestration, state filtering | Game-specific |
| `engine/combat.ts` | 400 | Combat phase controller: asteroid hazards, attack validation, base defence | Game-specific |
| `engine/ordnance.ts` | 420 | Ordnance launch/movement/detonation, asteroid hazard queuing | Game-specific |
| `engine/victory.ts` | 385 | Victory conditions, turn advancement, checkpoint tracking | Game-specific |
| `engine/util.ts` | 105 | Game rule helpers: base ownership, escape checks, ordnance capacity | Game-specific |

#### Key Design Patterns

- **`engine/game-engine.ts`**: A side-effect-free state machine. It takes the current `GameState` and player actions (e.g., astrogation orders, combat declarations) and returns the mutated `GameState` along with events (movements, combat results). **It has no I/O side effects (no DOM, no network, no storage)**, but it does mutate `GameState` and its entities in place — see [Engine Mutation Model](#engine-mutation-model).
- **`movement.ts`**: Contains the complex vector math, gravity well logic, and collision detection. Moving a ship is resolved strictly on an axial hex grid (using `hex.ts`).
- **`combat.ts`**: Evaluates line-of-sight, calculates combat odds based on velocity/range modifiers, and resolves damage. Mutates ships directly (e.g., `applyDamage`, `target.destroyed = true`, heroism flags).
- **`types.ts`**: The single source of truth for all data structures (`GameState`, `Ship`, `CombatResult`, network message payloads). This ensures the client and server never fall out of sync.
- **Dependency injection**: Engine functions accept `map` and `rng` as parameters so they can be tested without global state or non-determinism — see [RNG Injection](#rng-injection).
- **Event-driven resolution**: Movement produces events (crashes, mine hits, captures) that flow to the client for animation and logging.

#### Engine Mutation Model

The shared engine is **side-effect-free** (no I/O) but **not immutable**. Engine functions mutate `GameState` and its contained entities in place:

- `game-engine.ts` directly mutates `state.phase`, `state.pendingAstrogationOrders`, `state.ordnance`, player objects, and ship fields.
- `combat.ts` mutates ships via `applyDamage()`, sets `target.destroyed = true`, toggles heroism flags.
- `engine/combat.ts` mutates phase and state during combat progression.

This works correctly because:
- The server holds a single reference to state, processes one action at a time, and persists after each mutation.
- Tests construct fresh state per test case.

**Mitigation**: `client/game/local.ts` uses `structuredClone(state)` to capture a true pre-mutation snapshot before engine calls, making `previousState` semantics honest for animation diffing.

**Future improvement**: Switching to clone-on-entry at all engine entry points (not just local.ts) would enable state diffing, undo, replay, and spectator mode. See BACKLOG.md item 2k.

#### RNG Injection

All engine entry points (`processAstrogation`, `processCombat`, `skipCombat`, `beginCombatPhase`, `processOrdnance`, `skipOrdnance`) require a mandatory `rng: () => number` parameter. Internal functions (`rollD6`, `resolveCombat`, `resolveBaseDefense`, `shuffle`, `randomChoice`, `checkRamming`, `moveOrdnance`, `resolvePendingAsteroidHazards`) also require `rng`. There are no `Math.random` fallbacks in the turn-resolution path.

`createGame` and AI functions (`aiAstrogation`, `aiOrdnance`) accept optional `rng` with `Math.random` default, since they are setup/heuristic functions rather than turn-resolution functions.

All server and client callers pass `Math.random` at the API boundary. Tests can pass deterministic RNGs for reproducible results. This enables reproducible replays, deterministic debugging, and AI comparison testing.

### B. The Server (`server/`)
The backend leverages Cloudflare's edge network.

#### Module Inventory

| Module | Purpose | Reusability |
|--------|---------|-------------|
| `index.ts` | Worker entry: `/create`, `/ws/:code`, static asset proxy | Generic pattern |
| `protocol.ts` | Room codes, tokens, seat assignment, message validation | **~80% generic** — room/token/seat logic is game-agnostic |
| `game-do/game-do.ts` | Durable Object: WebSocket lifecycle, state persistence, broadcasting | **~70% generic** — multiplayer plumbing is reusable |
| `game-do/messages.ts` | S2C message construction from engine results | Game-specific |
| `game-do/session.ts` | Disconnect grace period, alarm scheduling | **Fully generic** |
| `game-do/turns.ts` | Turn timeout auto-advance | Mostly generic |

#### Key Design Patterns

- **`runGameStateAction()`**: Fetch current state → run pure engine function → on error send error message → on success save state and broadcast. Reduces boilerplate for each action handler.
- **Filtered broadcasting**: `broadcastFiltered()` checks if state has hidden info. If no hidden info, same state to both players. If hidden info, calls `filterStateForPlayer()` separately per player.
- **Single alarm**: One alarm per DO, rescheduled on each state change. Handler checks multiple deadlines (disconnect, turn timeout, inactivity) and acts on the nearest.
- **Seat assignment**: Token-based with 30s disconnect grace period. Invite tokens consumed on first use, preventing replay attacks.

### C. The Client (`client/`)
The frontend renders the pure hex-grid state into a smooth, continuous graphical experience.

#### Module Inventory

| Directory | Files | LOC | Purpose |
|-----------|-------|-----|---------|
| `client/` (root) | 5 | ~1900 | Entry point (`main.ts` ~1025 LOC), raw input, audio, tutorial, DOM helpers |
| `client/game/` | 34 | ~3700 | Game logic: planning, commands, phases, transport, presentation, connection, actions |
| `client/renderer/` | 14 | ~3500 | Canvas rendering: camera, scene, entities, effects, overlays |
| `client/ui/` | 8 | ~1400 | DOM overlays: menu, HUD, ship list, fleet shop, formatters |

#### Three-Layer Input Architecture

1. **Raw Input** (`input.ts`): Mouse/touch/keyboard → `InputEvent` (clickHex, hoverHex). No game knowledge.
2. **Game Interpretation** (`game/input-events.ts`): `InputEvent` + phase + state → `GameCommand[]`. Pure function.
3. **Command Dispatch** (`main.ts`): `GameCommand` → local state update or network transmission.

#### Client State Machine (`ClientState`)
- `menu` → `connecting` → `waitingForOpponent` → `playing_*` → `gameOver`
- Playing substates: `fleetBuilding`, `astrogation`, `ordnance`, `combat`, `movementAnim`, `opponentTurn`
- Phase-locked: input only processed when phase matches active player.

#### Rendering Pipeline (per frame)
1. **Scene layer** (world coords): starfield, hex grid, gravity indicators, bodies, asteroids, bases
2. **Entity layer** (animated): ship trails, velocity vectors, ships, ordnance, combat effects
3. **Overlay layer** (screen coords): ordnance guidance, combat highlights, minimap

#### Key Design Patterns

- **`main.ts`**: The client-side controller. Manages WebSocket connections, local-AI execution, and phase transitions. It orchestrates the Renderer, Input, and UI through a centralized **`ClientContext`** and a single **`dispatch(GameCommand)`** entry point.
- **`renderer/renderer.ts`**: A highly optimized Canvas 2D renderer. It separates logical hex coordinates from pixel coordinates. It features smooth camera interpolation, persistent trails, and movement/combat animations that occur *between* turn phases.
- **`input.ts`**: Manages user interaction (panning, zooming, clicking). It translates raw browser events into `InputEvent` objects. Pure `interpretInput()` then maps these to `GameCommand[]`, ensuring the input layer never directly mutates the application state.
- **`game/` / `renderer/` / `ui/` subfolders**: Pure client-side helpers for combat selection, input planning, minimap geometry, phase derivation, formatting, and tooltip/view-model logic.
- **`ui/ui.ts`** / **`audio.ts`**: Handles the HTML overlay (menus, HUD) and Web Audio API interactions.
- **Visual Polish**: Employs a premium design system with glassmorphism tokens (backdrop-filters), tactile micro-animations (recoil, scaling glows), and pulsing orbital effects for high-end UX.

### D. Progressive Web App (`static/sw.js`, `static/site.webmanifest`)
Delta-V is a fully installable PWA. A lightweight hand-written service worker provides:
- **Precaching** of the app shell (`/`, `client.js`, `style.css`, icons) for instant repeat loads.
- **Offline single-player**: The AI opponent works entirely client-side, so cached assets allow full gameplay without network.
- **WebSocket passthrough**: The service worker explicitly skips `/ws/*` and `/create` routes, ensuring multiplayer connections are never intercepted.
- **Stale-while-revalidate** for static assets and **network-first** for navigation, complementing Cloudflare's edge caching rather than fighting it.
- **Automatic cache busting**: The build script (`esbuild.client.mjs`) injects a content hash into the SW cache name, so every deploy with code changes triggers automatic SW update and page reload.

---

## 3. Data Flow

### A Movement Turn
1. During the Astrogation phase, players select their burn (acceleration) vectors via `client/input.ts`.
2. The client sends a `type: 'astrogation'` WebSocket message to the server.
3. The Durable Object (`game-do.ts`) gathers orders from both players.
4. When both players have submitted (or the turn timer expires), the server calls `processAstrogation()` in the shared engine.
5. The engine calculates the new physics vectors, resolves gravity effects, and detects crashes.
6. The Durable Object saves the new state and broadcasts a `movementResult` to both clients.
7. The clients receive the result, pause input, and `client/renderer.ts` smoothly interpolates the ships along their calculated paths. Once the animation finishes, the game proceeds to the Ordnance/Combat phase.

### WebSocket Protocol

**Client→Server (C2S)**: `fleetReady`, `astrogation`, `ordnance`, `emplaceBase`, `combat`, `skipOrdnance`, `beginCombat`, `skipCombat`, `chat`, `rematch`, `ping`

**Server→Client (S2C)**: `welcome`, `matchFound`, `gameStart`, `movementResult`, `combatResult`, `stateUpdate`, `gameOver`, `chat`, `rematchPending`, `opponentDisconnected`, `error`, `pong`

All messages are discriminated unions validated at the protocol boundary. `GameState` is the single source of truth — clients never mutate it; server owns all state mutations.

### Multiplayer Session Lifecycle

```
POST /create → Worker generates room code + tokens → DO /init
WebSocket /ws/{code}?playerToken=X → DO accepts, tags socket with player ID
Both players connected → createGame() → broadcast gameStart
Game loop: C2S action → engine → broadcast S2C result → save state → restart timer
Disconnect → 30s grace period → reconnect with token or forfeit
```

---

## 4. Dependency Map

```
main.ts (GameClient)
  ├→ renderer/renderer.ts (draw canvas, reads planningState by reference)
  ├→ input.ts (parse mouse/keyboard → InputEvent)
  ├→ ui/ui.ts (manage screens, accept UIEvent)
  ├→ game/network.ts, game/messages.ts (handle S2C)
  ├→ game/transport.ts (choose WebSocket or Local)
  ├→ game/phase.ts (derive ClientState from GameState)
  ├→ game/keyboard.ts (KeyboardAction → GameCommand)
  ├→ game/helpers.ts (derive HUD view models)
  ├→ game/[combat|burn|ordnance].ts (game-specific UI logic)
  ├→ game/planning.ts (user input accumulation)
  ├→ shared/types.ts (GameState, Ship, Ordnance, etc.)
  ├→ shared/engine/game-engine.ts (createGame, local resolution)
  ├→ shared/hex.ts (coordinate math)
  └→ shared/constants.ts (ship stats, animation timing)

renderer/renderer.ts
  ├→ renderer/camera.ts (viewport transform)
  ├→ renderer/[scene|entities|vectors|effects|overlay|...].ts (pure drawing)
  └→ shared/ (types, hex, constants)

game-do.ts (Durable Object)
  ├→ protocol.ts (validation, seat assignment)
  ├→ session.ts, turns.ts (lifecycle management)
  ├→ messages.ts (S2C construction)
  └→ shared/engine/game-engine.ts (pure game logic)
```

### Coupling Characteristics

| Boundary | Coupling | Notes |
|----------|----------|-------|
| Input → GameCommand | **Minimal** | Pure function, no state mutation |
| GameClient → Transport | **Minimal** | Abstraction hides WebSocket vs Local |
| Renderer → GameState | **High** | Reads full state for entity positions, damage, etc. |
| Renderer → PlanningState | **High** | Reads by reference for UI overlays (previews, selections) |
| UI → GameState | **High** | HUD needs ship stats, phase, fuel, objective |
| Client → Shared Engine | **Medium** | Local transport delegates to shared engine; types must align |
| ALL → shared/types | **Very High** | All modules import from shared types — this is the integration point |

---

## 5. Reusability Analysis: Generic Hex Game Engine

An analysis of what could be extracted as a reusable hex-grid multiplayer game framework for building other games on top of.

### What Is Already Generic

| Component | LOC | Reusability | Notes |
|-----------|-----|-------------|-------|
| `shared/hex.ts` | 245 | **100%** | Zero game knowledge. Axial coords, line draw, pixel conversion. |
| `shared/util.ts` | 110 | **100%** | Pure FP collection helpers. |
| `renderer/camera.ts` | 85 | **95%** | Pan/zoom/lerp. Only tie: `HEX_SIZE` constant. |
| `client/input.ts` | 185 | **90%** | Mouse/touch/pinch → clickHex/hoverHex. No game knowledge. |
| Server multiplayer plumbing | ~400 | **80%** | Room codes, tokens, seat assignment, disconnect grace, alarms. |
| `game/transport.ts` | 150 | **70%** | Command submission pattern. Interface is game-specific but pattern is generic. |
| Renderer orchestration | ~200 | **60%** | Render loop, effect management, animation interpolation. |
| Everything else | ~8000 | **0–20%** | Deeply game-specific. |

### What a Generic Framework Would Look Like

```
hex-engine/
├── hex/           → Axial coord math, line draw, pixel conversion
├── camera/        → Pan/zoom/lerp, world↔screen transforms
├── input/         → Mouse/touch/pinch → { clickHex, hoverHex }
├── multiplayer/   → DO-based room management
│   ├── room.ts        → Room codes, tokens, seat assignment
│   ├── session.ts     → Disconnect grace, reconnection
│   ├── protocol.ts    → Message validation framework
│   └── game-do.ts     → Generic DO lifecycle (fetch/alarm/websocket)
├── renderer/      → Hex grid drawing, animation loop
└── types.ts       → HexCoord, HexVec, PixelCoord, generic Phase/Player
```

A game implementation would provide:
- Game-specific entity types extending a base `HexEntity { id, position, owner }`
- Phase handlers conforming to a `GameEngine<State, Action>` interface
- Entity renderers and layer renderers for game-specific visuals
- Scenario/map definitions

### Assessment

**The extractable core is ~1000 LOC** — enough to avoid rewriting for a second game, but small enough that copy-paste is also viable.

**Arguments for extraction:**
- `hex.ts` + `camera.ts` + `input.ts` are immediately reusable with zero changes
- The DO multiplayer plumbing (rooms, tokens, reconnection) would otherwise be rewritten verbatim
- Forces cleaner boundaries, which would improve Delta-V itself
- ROI is positive after game #2

**Arguments against:**
- Game-specific logic is ~80% of the codebase. The "generic" part is small.
- Abstraction has a cost: type parameters and trait interfaces make code harder to read. `processAstrogation` is crystal clear because it knows exactly what a Ship is.
- Designing a framework from N=1 games is the classic premature abstraction. The right abstractions only emerge after building game #2.
- The game-specific parts (gravity, vector movement, combat tables) are the interesting and hard parts. The generic hex plumbing is straightforward.

**Recommendation:** Don't extract a framework yet. When starting game #2, fork Delta-V and gut the game-specific parts. The pure engine, transport abstraction, and clean shared/server/client split make forking straightforward. Build the framework *from two concrete implementations*, not from one.

---

## 6. Open Improvement Opportunities

See BACKLOG.md for the full prioritised list including completed items. Below are the open items relevant to architecture decisions.

### Reduce In-Place Mutation in the Engine (BACKLOG 2k)
Engine functions mutate `GameState` in place. This works for current usage but prevents: state diffing, undo, replay, spectator mode, and speculative AI branching. The pragmatic path is clone-on-entry at engine entry points, not a rewrite to persistent data structures.

### Other Considerations
- **Add browser-side tests around input/UI/orchestration**: Shared rules are well covered. The bigger refactor risk sits in client coordination code.
- **Public lobby hardening**: Longer opaque identifiers, rate limiting, and optional identity/account binding.

### Event Log / Event Sourcing for Network Protocol
The server currently sends full `GameState` snapshots over WebSocket. A lightweight event log — or a full event-sourcing model where the server sends a snapshot on join and then broadcasts only deterministic events (`SHIP_MOVED`, `COMBAT_RESOLVED`, etc.) — would reduce payload sizes and implicitly create a log for replays, reconnect catch-up, and spectator mode. Since the client shares the same engine, it can apply events locally to stay synchronised. Snapshots should remain the source of truth; the event log complements rather than replaces them. Worth pursuing when replays or spectator mode are prioritised.

### Server-Side State Rollback
If the engine throws mid-mutation, the DO's in-memory `GameState` could be left in an inconsistent state, permanently breaking the room. A lightweight guard — cloning state before engine entry points and restoring on exception — would prevent this. Currently mitigated by high test coverage, but worth adding as a safety net if the engine grows in complexity.

### Explicitly Deferred (Not Worth Doing Yet)
- **N-player generalisation**: Delta-V is a 2-player game. `[PlayerState, PlayerState]` is clearer and more type-safe than `PlayerState[]`. Generalise when a second game actually needs it.
- **Generic `RuleSet<S, C, E, P>` interface**: Designing a framework from N=1 games is premature abstraction. The current code is readable because it knows what a Ship is.
- **Full package extraction** (`hex-core`, `match-runtime`, `delta-v-rules`): Wait until game #2 exists. Build the framework from two concrete implementations, not one.
