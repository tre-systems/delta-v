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
- **Side-effect-free engine.** The shared engine has no I/O: no DOM, no network, no storage. The DO wraps it with persistence and WebSocket plumbing. This makes everything testable and portable. All engine entry points clone the input state on entry (`structuredClone`) — callers' state is never mutated. See [Engine Mutation Model](#engine-mutation-model) for details.
- **Transport abstraction.** `GameTransport` decouples the client from WebSocket vs local (AI) play. The client doesn't know or care where state comes from.
- **Functional style throughout.** Pure derivation functions (`deriveHudViewModel`, `deriveKeyboardAction`, `deriveBurnChangePlan`), mandatory injectable RNG, `cond()` for branching.
- **Scenario-driven.** `ScenarioRules` controls behaviour: ordnance types, base sharing, combat enabled, checkpoints, escape edges. New scenarios can vary gameplay without engine changes.
- **Shared rule reuse across layers.** Client ordnance entry, HUD button visibility, and engine validation now all derive from the same shared ordnance-rule helpers, so restricted scenarios do not drift between UI and server authority.
- **Hidden state filtering.** `filterStateForPlayer` hides fugitive identities in escape scenarios — the server never leaks information the client shouldn't have.

---

## 2. Core Systems Design

The architecture is divided into three distinct layers: Shared Logic, Server, and Client.

### A. Shared Game Engine (`shared/`)
This is the heart of the project. All game rules live in a shared folder, making the system robust and completely unit-testable.

#### Module Inventory

| Module | LOC | Purpose | Reusability |
|--------|-----|---------|-------------|
| `hex.ts` | 306 | Axial hex math: distance, neighbours, line draw, pixel conversion | **Fully generic** — zero game knowledge |
| `util.ts` | 170 | Functional collection helpers (`sumBy`, `minBy`, `indexBy`, `cond`, etc.) | **Fully generic** — no game knowledge |
| `types/` | 389 | All interfaces: `GameState`, `Ship`, `Ordnance`, C2S/S2C messages, scenarios (split into `domain.ts`, `protocol.ts`, `scenario.ts` with barrel re-export) | Game-specific |
| `protocol.ts` | 433 | Shared runtime C2S validation and normalization (trimmed chat, bounded payloads) | Mostly generic |
| `constants.ts` | 135 | Ship stats, ordnance mass, detection ranges, animation timing | Game-specific |
| `movement.ts` | 435 | Vector movement with gravity, fuel, takeoff/landing, crash detection | Game-specific |
| `combat.ts` | 627 | Gun combat tables, LOS, range/velocity mods, heroism, counterattack | Game-specific |
| `map-data.ts` | 712 | Solar system bodies, gravity rings, bases, 8 scenario definitions | Game-specific |
| `ai.ts` | 860 | Rule-based AI with three difficulty levels | Game-specific |
| `engine/game-engine.ts` | 798 | Pure state machine: game creation, phase orchestration, state filtering | Game-specific |
| `engine/combat.ts` | 537 | Combat phase controller: asteroid hazards, attack validation, base defence | Game-specific |
| `engine/ordnance.ts` | 522 | Ordnance launch/movement/detonation, asteroid hazard queuing | Game-specific |
| `engine/logistics.ts` | 284 | Surrender, fuel/cargo transfers, looting, logistics phase | Game-specific |
| `engine/victory.ts` | 634 | Victory conditions, turn advancement, reinforcements, fleet conversion | Game-specific |
| `engine/util.ts` | 226 | Game rule helpers: base ownership, escape checks, ordnance launch eligibility | Game-specific |

#### Key Design Patterns

- **`engine/game-engine.ts`**: A side-effect-free state machine. It takes the current `GameState` and player actions (e.g., astrogation orders, combat declarations) and returns a new `GameState` along with events (movements, combat results). **It has no I/O side effects (no DOM, no network, no storage)** and never mutates the caller's state — see [Engine Mutation Model](#engine-mutation-model).
- **`movement.ts`**: Contains the complex vector math, gravity well logic, and collision detection. Moving a ship is resolved strictly on an axial hex grid (using `hex.ts`).
- **`combat.ts`**: Evaluates line-of-sight, calculates combat odds based on velocity/range modifiers, and resolves damage. Mutates ships directly (e.g., `applyDamage`, `target.destroyed = true`, heroism flags).
- **`types/`**: The single source of truth for all data structures (`GameState`, `Ship`, `CombatResult`, network message payloads), split into `domain.ts`, `protocol.ts`, and `scenario.ts` with a barrel re-export. This ensures the client and server never fall out of sync.
- **Dependency injection**: Engine functions accept `map` and `rng` as parameters so they can be tested without global state or non-determinism — see [RNG Injection](#rng-injection).
- **Event-driven resolution**: Movement produces events (crashes, mine hits, captures) that flow to the client for animation and logging.

#### Engine Mutation Model

The shared engine is **side-effect-free** (no I/O) and **externally immutable**. All 11 engine entry points (`processAstrogation`, `processOrdnance`, `skipOrdnance`, `processFleetReady`, `beginCombatPhase`, `processCombat`, `skipCombat`, `processLogistics`, `skipLogistics`, `processSurrender`, `processEmplacement`) call `structuredClone(inputState)` on entry. Internally, the clone is mutated in place for efficiency, but the caller's state is never touched. Callers must use the returned `result.state`.

This design provides:
- **Rollback safety**: if the engine throws mid-mutation, the server's state is untouched (see BACKLOG 1b).
- **Snapshot diffing**: before/after state snapshots are naturally available without manual cloning.
- **Speculative branching**: AI search and replay can call engine functions without defensive cloning.

Internal mutation patterns (e.g. `applyDamage()`, `ship.destroyed = true`, phase transitions) remain unchanged — they operate on the cloned state.

`client/game/local.ts` also captures `structuredClone(state)` before combat calls for animation diffing (`previousState`). This is redundant with clone-on-entry but harmless — it may be removed in a future cleanup.

#### RNG Injection

All engine entry points (`processAstrogation`, `processCombat`, `skipCombat`, `beginCombatPhase`, `processOrdnance`, `skipOrdnance`) require a mandatory `rng: () => number` parameter. Internal functions (`rollD6`, `resolveCombat`, `resolveBaseDefense`, `shuffle`, `randomChoice`, `checkRamming`, `moveOrdnance`, `resolvePendingAsteroidHazards`) also require `rng`. There are no `Math.random` fallbacks in the turn-resolution path.

`createGame` and AI functions (`aiAstrogation`, `aiOrdnance`) accept optional `rng` with `Math.random` default, since they are setup/heuristic functions rather than turn-resolution functions.

All server and client callers pass `Math.random` at the API boundary. Tests can pass deterministic RNGs for reproducible results. This enables reproducible replays, deterministic debugging, and AI comparison testing.

### B. The Server (`server/`)
The backend leverages Cloudflare's edge network.

#### Module Inventory

| Module | Purpose | Reusability |
|--------|---------|-------------|
| `index.ts` | Worker entry: `/create`, `/ws/:code`, `/error`, `/telemetry`, static asset proxy | Generic pattern |
| `protocol.ts` | Room codes, tokens, init payload parsing, seat assignment, shared-validator re-export | **~85% generic** — room/token/seat logic is game-agnostic |
| `game-do/game-do.ts` | Durable Object: WebSocket lifecycle, state persistence, broadcasting | **~70% generic** — multiplayer plumbing is reusable |
| `game-do/messages.ts` | S2C message construction from engine results | Game-specific |
| `game-do/session.ts` | Disconnect grace period, alarm scheduling | **Fully generic** |
| `game-do/turns.ts` | Turn timeout auto-advance | Mostly generic |

#### Key Design Patterns

- **[WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/api/websockets/)**: The DO uses Cloudflare's hibernatable WebSocket API (`acceptWebSocket`, `webSocketMessage`, `webSocketClose`) instead of the standard `addEventListener` pattern. This allows the DO to hibernate between messages, reducing costs. Sockets are tagged with `player:${playerId}` on accept, enabling player lookup via `getWebSockets(['player:0'])` without maintaining an in-memory map.

- **`runGameStateAction(ws, action, onSuccess)`**: Generic handler that reduces boilerplate across all 12+ action handlers. Fetches current state from storage → runs engine function in try/catch → on validation error sends error message to the WebSocket → on exception logs with game code/phase/turn and sends error (state is preserved via clone-on-entry) → on success invokes `onSuccess` callback (typically save state + broadcast). `handleTurnTimeout` has equivalent try/catch protection for the alarm-driven code path.

- **Shared protocol validation**: Runtime C2S validation now lives in `shared/protocol.ts` instead of the server shell. The Durable Object still consumes `validateClientMessage()`, but the message-shape ownership sits beside the shared protocol types rather than inside server-only plumbing.

- **Single state-bearing outbound message per action**: `publishStateChange()` persists state and events first, then emits exactly one state-bearing message (`movementResult`, `combatResult`, or `stateUpdate`). If the resulting state is terminal, the DO appends a separate `gameOver` notification after that state-bearing message. This keeps client phase transitions aligned with a one-action/one-update contract.

- **Filtered broadcasting**: `broadcastFiltered()` checks whether the current scenario has hidden information (fugitive identities in escape scenarios). If no hidden info, the same state goes to both players. If hidden info, `filterStateForPlayer(state, playerId)` is called separately per player — own ships are fully visible, unrevealed enemy ships show `type: 'unknown'`. When adding new hidden state, extend `filterStateForPlayer()` and the check in `broadcastFiltered()`.

- **Single-alarm scheduling**: One alarm per DO, rescheduled after each state change. Three independent deadlines are stored: `disconnectAt` (30s grace), `turnTimeoutAt` (2 min), `inactivityAt` (5 min). `getNextAlarmAt()` computes the nearest deadline. When the alarm fires, `resolveAlarmAction()` returns a discriminated action (`disconnectExpired`, `turnTimeout`, `inactivityTimeout`) and the handler dispatches accordingly.

- **Seat assignment**: `resolveSeatAssignment()` in `protocol.ts` implements a multi-step fallback: (1) player token match → returning player gets their original seat; (2) invite token match → new player consumes the token and gets the open seat; (3) tokenless join → safety net for future open lobbies; (4) no seats available → reject. Invite tokens are consumed on first use, preventing replay attacks.

- **Disconnect grace period**: When a player disconnects, the DO stores a disconnect marker (player ID + 30s deadline) and schedules an alarm. If the player reconnects within 30s with a valid player token, the marker is cleared and the game continues. If the alarm fires with an unexpired marker, the game ends by forfeit. The marker is validated on reconnect — only the original player can reclaim the seat.

### C. The Client (`client/`)
The frontend renders the pure hex-grid state into a smooth, continuous graphical experience.

#### Module Inventory

| Directory | Files | LOC | Purpose |
|-----------|-------|-----|---------|
| `client/` (root) | 8 | ~2300 | Entry point (`main.ts` ~1040 LOC), raw input, audio, tutorial, DOM helpers, telemetry, viewport, reactive signals |
| `client/game/` | 39 | ~5600 | Game logic: command routing, planning, phases, transport, presentation, connection, actions |
| `client/renderer/` | 13 | ~4600 | Canvas rendering: camera, scene, entities, effects, overlays |
| `client/ui/` | 15 | ~2200 | DOM overlays: menu, HUD, ship list, fleet building, game log, formatters, button bindings, screens |

#### Three-Layer Input Architecture

1. **Raw Input** (`input.ts`): Mouse/touch/keyboard → `InputEvent` (clickHex, hoverHex). No game knowledge.
2. **Game Interpretation** (`game/input-events.ts`): `InputEvent` + phase + state → `GameCommand[]`. Pure function.
3. **Command Dispatch** (`game/command-router.ts`): `GameCommand` → local state update or network transmission.

#### Client State Machine (`ClientState`)
- `menu` → `connecting` → `waitingForOpponent` → `playing_*` → `gameOver`
- Playing substates: `fleetBuilding`, `astrogation`, `ordnance`, `logistics`, `combat`, `movementAnim`, `opponentTurn`
- Phase-locked: input only processed when phase matches active player.

#### Rendering Pipeline (per frame)
1. **Scene layer** (world coords): starfield, hex grid, gravity indicators, bodies, asteroids, bases
2. **Entity layer** (animated): ship trails, velocity vectors, ships, ordnance, combat effects
3. **Overlay layer** (screen coords): ordnance guidance, combat highlights, minimap

#### Key Design Patterns

- **`main.ts`**: The client-side coordinator. Manages WebSocket connections, local-AI execution, and phase transitions. Orchestrates the Renderer, Input, and UI through a centralized **`ClientContext`**. Commands are dispatched via `dispatchGameCommand()` in `game/command-router.ts`.
- **`renderer/renderer.ts`**: A highly optimized Canvas 2D renderer. It separates logical hex coordinates from pixel coordinates. It features smooth camera interpolation, persistent trails, and movement/combat animations that occur *between* turn phases.
- **`input.ts`**: Manages user interaction (panning, zooming, clicking). It translates raw browser events into `InputEvent` objects. Pure `interpretInput()` then maps these to `GameCommand[]`, ensuring the input layer never directly mutates the application state.
- **`game/`**: Command routing, action handlers (astrogation/combat/ordnance), phase derivation, transport abstraction, connection management, input interpretation, view-model helpers, and presentation logic. Ordnance-phase auto-selection and HUD legality are derived from shared engine rules instead of client-only cargo heuristics.
- **`renderer/`**: Canvas drawing layers (scene, entities, vectors, effects, overlays), camera, minimap, and animation management.
- **`ui/`**: Screen visibility, HUD view building, button bindings, game log, fleet building, ship list, formatters, and layout metrics.
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

**Client→Server (C2S)**: `fleetReady`, `astrogation`, `ordnance`, `emplaceBase`, `skipOrdnance`, `beginCombat`, `combat`, `skipCombat`, `logistics`, `skipLogistics`, `surrender`, `rematch`, `chat`, `ping`

**Server→Client (S2C)**: `welcome`, `matchFound`, `gameStart`, `movementResult`, `combatResult`, `stateUpdate`, `gameOver`, `rematchPending`, `opponentDisconnected`, `chat`, `error`, `pong`

All messages are discriminated unions validated at the protocol boundary. Chat payloads are trimmed before validation and blank post-trim messages are rejected, so non-UI clients cannot inject empty log entries. `GameState` is the single source of truth — clients never mutate it; server owns all state mutations.

### Multiplayer Session Lifecycle

```
POST /create → Worker generates room code + tokens → DO /init
WebSocket /ws/{code}?playerToken=X → DO accepts, tags socket with player ID
Both players connected → createGame() → broadcast gameStart
Game loop: C2S action → engine → save state/events → restart timer → broadcast S2C result
Disconnect → 30s grace period → reconnect with token or forfeit
```

---

## 4. Dependency Map

```
main.ts (GameClient)
  ├→ renderer/renderer.ts (draw canvas, reads planningState by reference)
  ├→ input.ts (parse mouse/keyboard → InputEvent)
  ├→ ui/ui.ts (manage screens, accept UIEvent)
  ├→ game/command-router.ts (GameCommand → state mutation or network)
  ├→ game/network.ts, game/messages.ts (handle S2C)
  ├→ game/transport.ts (choose WebSocket or Local)
  ├→ game/phase.ts (derive ClientState from GameState)
  ├→ game/keyboard.ts (KeyboardAction → GameCommand)
  ├→ game/helpers.ts (derive HUD view models)
  ├→ game/[combat|burn|ordnance]-actions.ts (phase-specific actions)
  ├→ game/planning.ts (user input accumulation)
  ├→ shared/types/ (GameState, Ship, Ordnance, etc.)
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
| `shared/hex.ts` | 306 | **100%** | Zero game knowledge. Axial coords, line draw, pixel conversion. |
| `shared/util.ts` | 170 | **100%** | Pure FP collection helpers. |
| `renderer/camera.ts` | 96 | **95%** | Pan/zoom/lerp. Only tie: `HEX_SIZE` constant. |
| `client/input.ts` | 234 | **90%** | Mouse/touch/pinch → clickHex/hoverHex. No game knowledge. |
| Server multiplayer plumbing | ~400 | **80%** | Room codes, tokens, seat assignment, disconnect grace, alarms. |
| `game/transport.ts` | 211 | **70%** | Command submission pattern. Interface is game-specific but pattern is generic. |
| Renderer orchestration | ~200 | **60%** | Render loop, effect management, animation interpolation. |
| Everything else | ~12000 | **0–20%** | Deeply game-specific. |

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

**The extractable core is ~1400 LOC** — enough to avoid rewriting for a second game, but small enough that copy-paste is also viable.

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

## 6. Remaining Architectural Decisions

See [BACKLOG.md](BACKLOG.md) for open work. Below captures deferred decisions and their rationale.

- **User accounts / auth**: Adds login friction that hurts adoption during user testing. The current anonymous token model is sufficient. Revisit for native app store distribution or payment integration.
- **N-player generalisation**: Delta-V is a 2-player game. `[PlayerState, PlayerState]` is clearer and more type-safe than `PlayerState[]`. Generalise when a second game actually needs it.
- **Generic hex engine extraction**: Designing a framework from N=1 games is premature abstraction. Fork Delta-V when game #2 starts and build the framework from two concrete implementations.
- **Serialisation codec**: `GameState` is plain JSON. A codec adds overhead with zero current benefit.
- **UI framework adoption**: The DOM UI layer is ~2200 LOC across 15 files. A framework (Preact, etc.) adds build complexity and migration risk for a layer that works and is small enough to iterate on directly.
