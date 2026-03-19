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
- **Functional style throughout.** Pure derivation functions (`deriveHudViewModel`, `deriveKeyboardAction`, `deriveBurnChangePlan`), partially injectable RNG, `cond()` for branching.
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
| `hex.ts` | 250 | Axial hex math: distance, neighbours, line draw, pixel conversion | **Fully generic** — zero game knowledge |
| `util.ts` | 110 | Functional collection helpers (`sumBy`, `minBy`, `indexBy`, `cond`, etc.) | **Fully generic** — no game knowledge |
| `types.ts` | 300 | All interfaces: `GameState`, `Ship`, `Ordnance`, C2S/S2C messages, scenarios | Game-specific |
| `constants.ts` | 70 | Ship stats, ordnance mass, detection ranges, animation timing | Game-specific |
| `movement.ts` | 320 | Vector movement with gravity, fuel, takeoff/landing, crash detection | Game-specific |
| `combat.ts` | 490 | Gun combat tables, LOS, range/velocity mods, heroism, counterattack | Game-specific |
| `map-data.ts` | 545 | Solar system bodies, gravity rings, bases, 8 scenario definitions | Game-specific |
| `ai.ts` | 250 | Rule-based AI with three difficulty levels | Game-specific |
| `engine/game-engine.ts` | 730 | Pure state machine: game creation, phase orchestration, state filtering | Game-specific |
| `engine/combat.ts` | 400 | Combat phase controller: asteroid hazards, attack validation, base defence | Game-specific |
| `engine/ordnance.ts` | 420 | Ordnance launch/movement/detonation, asteroid hazard queuing | Game-specific |
| `engine/victory.ts` | 200 | Victory conditions, turn advancement, checkpoint tracking | Game-specific |
| `engine/util.ts` | 105 | Game rule helpers: base ownership, escape checks, ordnance capacity | Game-specific |

#### Key Design Patterns

- **`engine/game-engine.ts`**: A side-effect-free state machine. It takes the current `GameState` and player actions (e.g., astrogation orders, combat declarations) and returns the mutated `GameState` along with events (movements, combat results). **It has no I/O side effects (no DOM, no network, no storage)**, but it does mutate `GameState` and its entities in place — see [Engine Mutation Model](#engine-mutation-model).
- **`movement.ts`**: Contains the complex vector math, gravity well logic, and collision detection. Moving a ship is resolved strictly on an axial hex grid (using `hex.ts`).
- **`combat.ts`**: Evaluates line-of-sight, calculates combat odds based on velocity/range modifiers, and resolves damage. Mutates ships directly (e.g., `applyDamage`, `target.destroyed = true`, heroism flags).
- **`types.ts`**: The single source of truth for all data structures (`GameState`, `Ship`, `CombatResult`, network message payloads). This ensures the client and server never fall out of sync.
- **Dependency injection**: Engine functions accept `map` as a parameter so they can be tested without global state. RNG is partially injectable — see [RNG Injection](#rng-injection).
- **Event-driven resolution**: Movement produces events (crashes, mine hits, captures) that flow to the client for animation and logging.

#### Engine Mutation Model

The shared engine is **side-effect-free** (no I/O) but **not immutable**. Engine functions mutate `GameState` and its contained entities in place:

- `game-engine.ts` directly mutates `state.phase`, `state.pendingAstrogationOrders`, `state.ordnance`, player objects, and ship fields.
- `combat.ts` mutates ships via `applyDamage()`, sets `target.destroyed = true`, toggles heroism flags.
- `engine/combat.ts` mutates phase and state during combat progression.

This works correctly because:
- The server holds a single reference to state, processes one action at a time, and persists after each mutation.
- Tests construct fresh state per test case.

**Known risk**: In `client/game/local.ts`, some local resolution paths alias state before calling the engine (`const previousState = state`). Because the engine mutates in place, `previousState` may not actually represent the pre-mutation state. This can make before/after animation logic subtly wrong.

**Future improvement**: Switching to clone-on-entry (or Immer) at engine entry points would enable state diffing, undo, replay, spectator mode, and safer client-side animation. See BACKLOG.md item 2k.

#### RNG Injection

Randomness is partially injectable. Most combat and ordnance functions accept an optional `rng?` parameter, falling back to `Math.random` when omitted:

- `combat.ts`: `rollD6(rng?)` falls back to `Math.random`
- `util.ts`: `randomChoice(..., rng = Math.random)`
- `createGame()` uses `randomChoice` for hidden-role assignment without exposing RNG at the API boundary
- `simulate-ai.ts` uses `Math.random` directly

This means game execution is **not fully deterministic** — the same inputs can produce different outputs depending on which code paths use the fallback. Making `rng` a required parameter at all engine entry points would enable reproducible replays, deterministic debugging, and AI comparison testing. See BACKLOG.md item 2m.

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
| `client/` (root) | 5 | ~1800 | Entry point (`main.ts`), raw input, audio, tutorial, DOM helpers |
| `client/game/` | 20+ | ~3000 | Game logic: planning state, commands, phase transitions, transport |
| `client/renderer/` | 14 | ~3000 | Canvas rendering: camera, scene, entities, effects, overlays |
| `client/ui/` | 8 | ~1500 | DOM overlays: menu, HUD, ship list, fleet shop, formatters |

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

**Client→Server (C2S)**: `fleetReady`, `astrogation`, `ordnance`, `emplaceBase`, `combat`, `skipOrdnance`, `beginCombat`, `skipCombat`, `rematch`, `ping`

**Server→Client (S2C)**: `welcome`, `matchFound`, `gameStart`, `movementResult`, `combatResult`, `stateUpdate`, `gameOver`, `rematchPending`, `opponentDisconnected`, `error`, `pong`

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
| `shared/hex.ts` | 250 | **100%** | Zero game knowledge. Axial coords, line draw, pixel conversion. |
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

## 6. Known Improvement Opportunities

These are architectural improvements that would benefit Delta-V directly, independent of any extraction effort. Ordered by impact and effort.

### Priority 1: Make RNG Fully Injectable (small scope, high value)
Remove all `rng?` optional parameters and make RNG required at every engine entry point. This is a bounded change (update function signatures and callers) that immediately enables reproducible replays and deterministic debugging. See BACKLOG.md item 2m.

### Priority 2: Investigate `local.ts` State Aliasing (bug risk)
`client/game/local.ts` aliases `GameState` before calling engine functions, then uses both the "previous" and "current" state for animation. Because the engine mutates in place, the alias may point to already-mutated data. This should be investigated for correctness and fixed with explicit cloning if needed. See BACKLOG.md item 2n.

### Priority 3: Reduce In-Place Mutation in the Engine (large scope, unlocks future features)
Engine functions mutate `GameState` in place and return it. This works for current usage but prevents: safely diffing old vs new state, undo, replay, spectator mode, and speculative AI branching. The pragmatic path is clone-on-entry at engine entry points (or Immer), not a full rewrite to persistent data structures. See BACKLOG.md item 2k.

### Priority 4: Decompose `main.ts` (~1400 LOC)
`GameClient` owns rendering, input, UI, networking, game logic, audio, and tutorials — a classic "fat controller". A cleaner pattern: decompose into a thin dispatcher that delegates to focused handlers per phase. This doesn't affect correctness but improves readability and extensibility. See BACKLOG.md item 2j.

### Priority 5: Remove Map Singleton
`getSolarSystemMap()` returns a lazy-cached global. This couples the engine to a single map topology. The map is already passed as a parameter to most engine functions, but the singleton is a lingering escape hatch that should be eliminated. See BACKLOG.md item 2l.

### Other Ongoing Priorities
- **Continue extracting pure helpers from `main.ts`**: Phase derivation, HUD view models, and local/remote result application should keep moving out of the main controller.
- **Renderer is now decomposed by visual responsibility** (`renderer/renderer.ts` plus `combat.ts`, `entities.ts`, `vectors.ts`, `effects.ts`, etc.): Further splits should follow the same pattern.
- **Add browser-side tests around input/UI/orchestration**: Shared rules are well covered. The bigger refactor risk sits in client coordination code.
- **Avoid premature ECS migration**: The current rules engine has a small, stable entity set and turn-based processing. An ECS would make the rules harder to follow without meaningful flexibility gain.
- **Prefer a lightweight event log over full event sourcing**: Replays, reconnect catch-up, and spectator mode would benefit from an append-only turn log, but snapshots should remain the source of truth.
- **`game-do/` is now split by concern** (`game-do.ts`, `messages.ts`, `session.ts`, `turns.ts`): Features like spectators or replay catch-up can be added without bloating one class.
- **Public lobby hardening remains future work**: Longer opaque identifiers, rate limiting, and optional identity/account binding.
- **Persistence beyond active rooms is still optional**: Durable Object storage is a good fit for live matches; D1 or another store only becomes necessary once match history or player progression matters.

### Explicitly Deferred (Not Worth Doing Yet)
- **N-player generalisation**: Delta-V is a 2-player game. `[PlayerState, PlayerState]` is clearer and more type-safe than `PlayerState[]`. Generalise when a second game actually needs it.
- **Generic `RuleSet<S, C, E, P>` interface**: Designing a framework from N=1 games is premature abstraction. The current code is readable because it knows what a Ship is.
- **Split `map-data.ts` into `world/`, `scenarios/`, `rules/`**: Four files instead of one, for a single game, with no reuse target. This is fragmentation, not simplification.
- **Full package extraction** (`hex-core`, `match-runtime`, `delta-v-rules`): Wait until game #2 exists. Build the framework from two concrete implementations, not one.
