# Delta-V Architecture & Design Document

Delta-V is an online multiplayer space combat and racing game. This document outlines the high-level architecture, core systems, design patterns, module-level analysis, and guidance for future work including reusability across other hex-based games.

Where the codebase is in transition, this document
distinguishes the current implementation from the
accepted target architecture. In particular, replay and
multiplayer state are currently snapshot-first with
archive helpers, while the next major phase moves the
server toward an event-sourced match log with
projections and checkpoints.

Platform references:
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Durable Objects WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/api/websockets/)
- [MDN Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

Pattern references:
- [MDN `structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [Gary Bernhardt, "Boundaries"](https://www.destroyallsoftware.com/talks/boundaries)
- [Martin Fowler, Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Martin Fowler, CQRS](https://martinfowler.com/bliki/CQRS.html)
- [Martin Fowler, Dependency Injection](https://martinfowler.com/articles/injection.html)
- [Mark Seemann, Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/)
- [Solid Docs, Fine-grained reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)
- [Preact Signals guide](https://preactjs.com/guide/v10/signals/)

## 1. High-Level Architecture

Delta-V employs a full-stack TypeScript architecture
built around a **shared side-effect-free engine with
authoritative edge sessions** model. Today the
authoritative room still persists snapshots directly;
the committed next step is to shift that authority to an
append-only event stream and treat snapshots as derived
checkpoints.

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
- **Narrow class usage.** Pure rules and most
  coordination helpers stay function/factory-based.
  Classes are reserved for platform shells or long-lived
  mutable boundaries such as `GameDO`, `GameClient`,
  `Renderer`, `Camera`, and `InputHandler`.
- **Pure planner + narrow applier flows.** Client screen changes, phase entry, message handling, and game-state application route through pure planners plus a small number of side-effect owners instead of scattering equivalent writes across many call sites.
- **Scenario-driven.** `ScenarioRules` controls behaviour: ordnance types, base sharing, combat enabled, checkpoints, escape edges. New scenarios can vary gameplay without engine changes.
- **Shared rule reuse across layers.** Client ordnance entry, HUD button visibility, and engine validation now all derive from the same shared ordnance-rule helpers, so restricted scenarios do not drift between UI and server authority.
- **Hidden state filtering.** `filterStateForPlayer` hides fugitive identities in escape scenarios — the server never leaks information the client shouldn't have.
- **Migration-friendly boundaries.** Mandatory RNG injection, stable per-match IDs, side-effect-free engine entry points, and narrow server/client contracts make an event-sourced migration feasible without throwing away the whole engine.

### Patterns To Adopt Next

These are patterns the current architecture is already
leaning toward, but has not finished adopting end to end:

- **Versioned event envelopes, not raw event arrays.**
  `EngineEvent[]` is already a solid domain-level seam, but
  the next step is wrapping those events in authoritative
  envelopes with sequence numbers, actor identity,
  timestamps, match identity, and explicit random outcomes.
- **Projection parity tests.** Event-sourced rebuilds should
  be checked against live state via full replay and
  checkpoint-plus-tail replay, not assumed correct by
  architecture alone.
- **Contract fixtures for protocol and replay payloads.**
  The validation layer is strong, but representative
  request/response fixtures would make later event/replay
  changes safer and more observable.
- **Single trusted-HTML boundary.** The client still renders
  some complex markup imperatively. If freeform or external
  content expands, HTML injection should pass through one
  reviewed boundary rather than ad hoc `innerHTML` writes.
- **Decision records for cross-cutting choices.** Protocol,
  auth, and product-shape decisions have historically
  drifted across docs. Small ADR-style records would reduce
  future mismatches.
- **Profiling before renderer optimization.** Performance
  work such as layer caching should be driven by measured
  frame-time or device pain, not by intuition alone.
- **Decompose large client shells before syntax rewrites.**
  Smaller stateful DOM wrappers and telemetry helpers now
  already use the `createXxx()` manager pattern. Keep
  extracting focused helpers from `GameClient`,
  `Renderer`, and `InputHandler` before any further
  class-to-factory rewrite so syntax churn does not
  masquerade as architectural progress.

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
| `types/` | 384 | All interfaces: `GameState`, `Ship`, `Ordnance`, C2S/S2C messages, scenarios (split into `domain.ts`, `protocol.ts`, `scenario.ts`; all imports use bounded files directly, barrel retained for compatibility only) | Game-specific |
| `protocol.ts` | 478 | Shared runtime C2S validation and normalization (trimmed chat, bounded payloads) | Mostly generic |
| `replay.ts` | 56 | Replay archive structure, entry helpers, match identity builder | Game-specific |
| `constants.ts` | 146 | Ship stats, ordnance mass, detection ranges, combat/movement constants | Game-specific |
| `movement.ts` | 435 | Vector movement with gravity, fuel, takeoff/landing, crash detection | Game-specific |
| `combat.ts` | 634 | Gun combat tables, LOS, range/velocity mods, heroism, counterattack | Game-specific |
| `map-data.ts` | 713 | Solar system bodies, gravity rings, bases, 8 scenario definitions | Game-specific |
| `ai.ts` | 688 | Rule-based AI with three difficulty levels and enforcer interception | Game-specific |
| `ai-config.ts` | 250 | Per-difficulty AI scoring weights and strategy parameters | Game-specific |
| `ai-scoring.ts` | 372 | Composable AI course scoring strategies (escape, nav, combat, gravity, race) | Game-specific |
| `engine/game-engine.ts` | 58 | Barrel re-export: public engine API, result types, result classification helpers | Game-specific |
| `engine/engine-events.ts` | 149 | `EngineEvent` discriminated union (22 granular domain event types) | Game-specific |
| `engine/game-creation.ts` | 287 | Game initialization from scenario definition | Game-specific |
| `engine/fleet-building.ts` | 128 | Fleet purchase phase (MegaCredit economy) | Game-specific |
| `engine/astrogation.ts` | 277 | Order validation, ordnance launches, movement dispatch | Game-specific |
| `engine/resolve-movement.ts` | 233 | Movement orchestrator: resolve orders, post-movement checks | Game-specific |
| `engine/combat.ts` | 628 | Combat phase controller: asteroid hazards, attack validation, base defence | Game-specific |
| `engine/ordnance.ts` | 609 | Ordnance launch/movement/detonation, asteroid hazard queuing | Game-specific |
| `engine/logistics.ts` | 334 | Surrender, fuel/cargo transfers, looting, logistics phase | Game-specific |
| `engine/victory.ts` | 763 | Victory conditions, turn advancement, reinforcements, fleet conversion | Game-specific |
| `engine/util.ts` | 271 | Ship state helpers, game rule helpers, ordnance launch eligibility | Game-specific |

#### Key Design Patterns

- **`engine/game-engine.ts`**: A side-effect-free state machine. It takes the current `GameState` and player actions (e.g., astrogation orders, combat declarations) and returns a new `GameState` along with events (movements, combat results). **It has no I/O side effects (no DOM, no network, no storage)** and never mutates the caller's state — see [Engine Mutation Model](#engine-mutation-model).
- **`movement.ts`**: Contains the complex vector math, gravity well logic, and collision detection. Moving a ship is resolved strictly on an axial hex grid (using `hex.ts`).
- **`combat.ts`**: Evaluates line-of-sight, calculates combat odds based on velocity/range modifiers, and resolves damage. Mutates ships directly (e.g., `applyDamage`, updating `ship.lifecycle`, heroism flags).
- **`types/`**: The single source of truth for all data structures (`GameState`, `Ship`, `CombatResult`, network message payloads), split into `domain.ts`, `protocol.ts`, and `scenario.ts` with a barrel re-export. This ensures the client and server never fall out of sync.
- **Dependency injection**: Engine functions accept `map` and `rng` as parameters so they can be tested without global state or non-determinism — see [RNG Injection](#rng-injection).
- **Domain event emission**: All engine entry points emit `EngineEvent[]` (22 granular types: shipMoved, shipCrashed, combatAttack, ordnanceLaunched, phaseChanged, gameOver, etc.) alongside state and animation data. The server reads `result.engineEvents` directly — no server-side event derivation. Movement animation data (`MovementEvent[]`, `ShipMovement[]`) remains separate for client rendering.

#### Engine Mutation Model

The shared engine is **side-effect-free** (no I/O) and **externally immutable**. All 11 engine entry points (`processAstrogation`, `processOrdnance`, `skipOrdnance`, `processFleetReady`, `beginCombatPhase`, `processCombat`, `skipCombat`, `processLogistics`, `skipLogistics`, `processSurrender`, `processEmplacement`) call `structuredClone(inputState)` on entry. Internally, the clone is mutated in place for efficiency, but the caller's state is never touched. Callers must use the returned `result.state`.

This design provides:
- **Rollback safety**: if the engine throws mid-mutation, the server's state is untouched.
- **Snapshot diffing**: before/after state snapshots are naturally available without manual cloning.
- **Speculative branching**: AI search and projection verification can call engine functions without defensive cloning.

Internal mutation patterns (e.g. `applyDamage()`, `ship.lifecycle = 'destroyed'`, phase transitions) remain unchanged — they operate on the cloned state.

`client/game/local.ts` also captures `structuredClone(state)` before combat calls for animation diffing (`previousState`). This is redundant with clone-on-entry but harmless — it may be removed in a future cleanup.

#### RNG Injection

All engine entry points (`processAstrogation`, `processCombat`, `skipCombat`, `beginCombatPhase`, `processOrdnance`, `skipOrdnance`) require a mandatory `rng: () => number` parameter. Internal functions (`rollD6`, `resolveCombat`, `resolveBaseDefense`, `shuffle`, `randomChoice`, `checkRamming`, `moveOrdnance`, `resolvePendingAsteroidHazards`) also require `rng`. There are no `Math.random` fallbacks in the turn-resolution path.

`createGame` and AI functions (`aiAstrogation`, `aiOrdnance`) accept optional `rng` with `Math.random` default, since they are setup/heuristic functions rather than turn-resolution functions.

All server and client callers pass `Math.random` at the API boundary. Tests can pass deterministic RNGs for reproducible results. This enables deterministic debugging, simulation reproducibility, and AI comparison testing. In the planned event-sourced architecture, persisted events should record authoritative random outcomes explicitly rather than relying on replaying a seed through future code.

### B. The Server (`server/`)
The backend leverages Cloudflare's edge network.

#### Module Inventory

| Module | Purpose | Reusability |
|--------|---------|-------------|
| `index.ts` | Worker entry: `/create`, `/join/:code`, `/replay/:code`, `/ws/:code`, `/error`, `/telemetry`, static asset proxy | Generic pattern |
| `protocol.ts` | Room codes, tokens, init payload parsing, seat assignment, shared-validator re-export | **~85% generic** — room/token/seat logic is game-agnostic |
| `game-do/game-do.ts` | Durable Object: WebSocket lifecycle, state persistence, broadcasting | **~70% generic** — multiplayer plumbing is reusable |
| `game-do/archive.ts` | Event log, match-scoped event envelopes (gameId/seq/ts/actor), replay archive, match identity | Game-specific |
| `game-do/match-archive.ts` | Persistent archival of completed matches to R2 + D1 metadata | **Fully generic** |
| `game-do/messages.ts` | S2C message construction from engine results | Game-specific |
| `game-do/session.ts` | Disconnect grace period, alarm scheduling | **Fully generic** |
| `game-do/turns.ts` | Turn timeout auto-advance | Mostly generic |

#### Key Design Patterns

- **[WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/api/websockets/)**: The DO uses Cloudflare's hibernatable WebSocket API (`acceptWebSocket`, `webSocketMessage`, `webSocketClose`) instead of the standard `addEventListener` pattern. This allows the DO to hibernate between messages, reducing costs. Sockets are tagged with `player:${playerId}` on accept, enabling player lookup via `getWebSockets(['player:0'])` without maintaining an in-memory map.

- **`runGameStateAction(ws, action, onSuccess)`**: Generic handler that reduces boilerplate across all 12+ action handlers. Fetches current state from storage → runs engine function in try/catch → on validation error sends error message to the WebSocket → on exception logs with game code/phase/turn and sends error (state is preserved via clone-on-entry) → on success invokes `onSuccess` callback (typically save state + broadcast). `handleTurnTimeout` has equivalent try/catch protection for the alarm-driven code path.

- **Shared protocol validation**: Runtime C2S validation now lives in `shared/protocol.ts` instead of the server shell. The Durable Object still consumes `validateClientMessage()`, but the message-shape ownership sits beside the shared protocol types rather than inside server-only plumbing.

- **Single state-bearing outbound message per action**: `publishStateChange()` currently persists state and events first, then emits exactly one state-bearing message (`movementResult`, `combatResult`, or `stateUpdate`). If the resulting state is terminal, the DO appends a separate `gameOver` notification after that state-bearing message. This one-action / one-update client contract should remain intact through the event-sourced migration even if the server starts projecting that message from appended domain events instead of mutating and saving a snapshot first.

- **Single choke points for coordination**: The current codebase deliberately concentrates high-risk side effects behind a few owner functions rather than spreading them around. On the server, `publishStateChange()` owns persist/archive/broadcast/timer restart for state transitions. On the client, `dispatchGameCommand()`, `applyClientGameState()`, and `applyClientStateTransition()` are the corresponding choke points for command routing, authoritative-state application, and state-entry side effects.

- **Replay archive foundation (transitional)**: The server currently persists a per-match replay archive built from those same authoritative state-bearing outbound messages. `initGame()` allocates a stable match identity (`gameId` like `ROOM1-m2`), archives the initial `gameStart`, and `publishStateChange()` appends each later state-bearing transition in sequence. Replay fetches are authenticated by player token and currently return player-filtered history. This is now a migration foothold, not the intended long-term source of truth.

- **Accepted direction: event-sourced authoritative matches**: The next architectural phase moves the DO from snapshot-first persistence to an append-only authoritative event stream. Each validated command should append versioned domain events with sequence numbers, actor identity, correlation id, match identity, and explicit random outcomes where needed. Authoritative `GameState`, player views, spectator views, replay payloads, and reconnect state then become projections built from the stream and optional checkpoints.

- **Filtered broadcasting (current) and viewer-aware filtering (next)**: `broadcastFiltered()` currently checks whether the current scenario has hidden information (fugitive identities in escape scenarios). If no hidden info, the same state goes to both players. If hidden info, `filterStateForPlayer(state, playerId)` is called separately per player — own ships are fully visible, unrevealed enemy ships show `type: 'unknown'`. The next step is a viewer model that supports player 0, player 1, and spectator / public projections so event-sourced replay and spectator delivery cannot leak hidden data.

- **Single-alarm scheduling**: One alarm per DO, rescheduled after each state change. Three independent deadlines are tracked: `disconnectAt` (30s grace), `turnTimeoutAt` (2 min), `inactivityAt` (5 min). `getNextAlarmAt()` computes the nearest deadline. When the alarm fires, `resolveAlarmAction()` returns a discriminated action (`disconnectExpired`, `turnTimeout`, `inactivityTimeout`) and the handler dispatches accordingly. `inactivityAt` is cached in memory and flushed to storage at most once per 60s to avoid write amplification from frequent pings. Chat rate limiting is also in-memory (not storage-backed).

- **WebSocket throttle**: A per-socket message counter (in-memory `WeakMap`) limits clients to 10 messages per second. Connections exceeding this are closed with code 1008. This prevents garbage-message floods from spiking DO CPU or I/O.

- **Room creation rate limit**: The Worker hashes the client IP and checks `POST /create` against either a configured Cloudflare rate-limit binding or an in-memory fallback (5 requests per IP per 60s window, 429 with `Retry-After`). The fallback protects a single worker isolate; production deployments should still configure a Cloudflare-global rule.

- **Seat assignment**: `resolveSeatAssignment()` in `protocol.ts` implements a multi-step fallback: (1) player token match → returning player gets their original seat, even if the previous socket is still open; (2) tokenless join → allowed when an open seat has no player token (the default guest-join path); (3) no seats available → reject. Duplicate sockets are replaced only after reclaim is accepted, and match start uses unique connected seats rather than raw socket count.

- **Disconnect grace period**: When a player disconnects, the DO stores a disconnect marker (player ID + 30s deadline) and schedules an alarm. If the player reconnects within 30s with a valid player token, the marker is cleared and the game continues. If the alarm fires with an unexpired marker, the game ends by forfeit. The marker is validated on reconnect, and reclaim succeeds during the grace window even if the stale socket has not yet fully torn down.

### C. The Client (`client/`)
The frontend renders the pure hex-grid state into a smooth, continuous graphical experience.

#### Module Inventory

| Directory | Files | LOC | Purpose |
|-----------|-------|-----|---------|
| `client/` (root) | 8 | ~2290 | Entry point (`main.ts` ~890 LOC), raw input, audio, tutorial, DOM helpers, telemetry, viewport, reactive signals |
| `client/game/` | 46 | ~6540 | Game logic: command routing, planning store, game-state store, state transitions, session control, phases, transport, actions, HUD controller, camera controller |
| `client/renderer/` | 13 | ~4590 | Canvas rendering: camera, scene, entities, effects, overlays |
| `client/ui/` | 15 | ~2670 | DOM overlays: menu, HUD, ship list, fleet building, game log, formatters, button bindings, screens |

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

- **`main.ts`**: The client-side coordinator. Manages WebSocket connections, local-AI execution, and top-level composition. It now delegates command dispatch to `game/command-router.ts`, game-state apply/clear ownership to `game/game-state-store.ts`, planning mutations to `game/planning-store.ts`, runtime/session field updates to `game/client-context-store.ts`, client state-entry side effects to `game/state-transition.ts`, and session lifecycle flows to `game/session-controller.ts` instead of keeping those blocks inline.
- **`main.ts` as composition root**: `GameClient` wires together transports, timers, renderer, UI managers, and extracted `*Deps` objects. The goal is to keep construction and ownership centralized there while leaving downstream helpers narrower and easier to test. If class usage is reduced further, the priority is to extract responsibilities first; replacing the shell with a closure is not valuable on its own.
- **`renderer/renderer.ts`**: A highly optimized Canvas 2D renderer. It separates logical hex coordinates from pixel coordinates, while extracted helpers such as `renderer/animation-manager.ts` now own movement-animation lifecycle and trail state. The renderer class remains the canvas shell and per-frame orchestrator.
- **`input.ts`**: Manages user interaction (panning, zooming, clicking). It translates raw browser events into `InputEvent` objects, while `input-interaction.ts` owns pointer drag/pinch/minimap state and math. The input shell now owns its DOM listener lifecycle explicitly, including outside-canvas pointer release and touch-cancel cleanup. Pure `interpretInput()` then maps these to `GameCommand[]`, ensuring the input layer never directly mutates the application state.
- **`game/`**: Command routing, action handlers (astrogation/combat/ordnance), planning-state helpers, runtime/session helpers, phase derivation, game-state helpers, transition helpers, session helpers, transport abstraction, connection management, input interpretation, view-model helpers, and presentation logic. Ordnance-phase auto-selection and HUD legality are derived from shared engine rules instead of client-only cargo heuristics.
- **`renderer/`**: Canvas drawing layers (scene, entities, vectors, effects, overlays), camera, minimap, and animation management.
- **`ui/`**: Screen visibility, HUD view building, button bindings, game log, fleet building, ship list, formatters, layout metrics, and small reactive DOM view models.
- **`reactive.ts` + `ui/ui.ts`**: The overlay layer stays framework-free, but stateful DOM views now use a small signals runtime for derived copy/visibility and explicit disposal. `UIManager` owns long-lived view instances and their teardown, and the smaller overlay/lobby/fleet-building/ship-list/HUD chrome/game log views plus tutorial and turn telemetry all now follow the same factory-manager style used in other client modules.
- **`audio.ts`**: Handles Web Audio API interactions.
- **Visual Polish**: Employs a premium design system with glassmorphism tokens (backdrop-filters), tactile micro-animations (recoil, scaling glows), and pulsing orbital effects for high-end UX.

### D. Progressive Web App (`static/sw.js`, `static/site.webmanifest`)
Delta-V is a fully installable PWA. A lightweight hand-written service worker provides:
- **Precaching** of the app shell (`/`, `client.js`, `style.css`, icons) for instant repeat loads.
- **Offline single-player**: The AI opponent works entirely client-side, so cached assets allow full gameplay without network.
- **Network/API passthrough**: The service worker never intercepts non-`GET` requests and explicitly bypasses multiplayer/reporting routes (`/ws/*`, `/create`, `/join/*`, `/error`, `/telemetry`), ensuring sockets, join validation, and reporting stay authoritative.
- **Stale-while-revalidate** for static assets and **network-first** for navigation, complementing Cloudflare's edge caching rather than fighting it.
- **Automatic cache busting**: The build script (`esbuild.client.mjs`) injects a content hash into the SW cache name, so every deploy with code changes triggers automatic SW update and page reload.

### Library Stance

The architecture currently benefits from a narrow
dependency surface. That remains the default.

- **Do not add framework/state-machine/rendering stacks by
  default.** React, Vue, Redux, Zustand, RxJS, XState, and
  canvas/game frameworks would blur boundaries that are
  currently explicit and testable.
- **Prefer targeted libraries only when they remove a real
  maintenance or security burden.**
- **Potentially good additions later**:
  `DOMPurify` if any user-controlled or external HTML needs
  to be rendered; a schema library such as `Valibot` or
  `Zod` if protocol or event-envelope schemas expand enough
  that handwritten validators become harder to reason
  about.
- **Not worth swapping right now**:
  the custom `reactive.ts` layer. It is small, tested, and
  intentionally scoped. Replacing it with a library would
  only make sense if the project no longer wants to own
  reactive internals.

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

**Server→Client (S2C)**: `welcome`, `matchFound`, `gameStart`, `movementResult`, `combatResult`, `stateUpdate`, `gameOver`, `rematchPending`, `chat`, `error`, `pong`

All messages are discriminated unions validated at the protocol boundary. Chat payloads are trimmed before validation and blank post-trim messages are rejected, so non-UI clients cannot inject empty log entries. In the current implementation, `GameState` snapshots are the live source of truth — clients never mutate them, and the server owns all state mutations. The planned event-sourced migration keeps server authority, but shifts persisted truth to the match event stream.

### Multiplayer Session Lifecycle

```
POST /create → Worker generates room code + creator token → DO /init
GET /join/{code}?playerToken=X → optional preflight join validation
GET /replay/{code}?playerToken=X&gameId=Y → authenticated replay / history fetch (currently archive-backed)
WebSocket /ws/{code}[?playerToken=X] → DO accepts, tags socket with player ID
Both unique seats connected → createGame() → broadcast gameStart
Game loop: C2S action → engine → save state/events → restart timer → broadcast S2C result
Disconnect → 30s grace period → reconnect with token or forfeit
```

### Planned Event-Sourced Match Lifecycle

The current implementation still persists snapshots
directly. The accepted target flow is:

1. Client submits a validated command.
2. The Durable Object appends canonical, versioned
   domain events to a per-match stream.
3. Authoritative state is rebuilt or incrementally
   projected from checkpoint plus event tail.
4. Player and spectator/public views are derived from
   that projection.
5. The server broadcasts one state-bearing update plus
   any animation/log summaries needed by the client.

Under that model, `GameState` snapshots become cached
checkpoints and transport payloads rather than the
authoritative persisted truth.

---

## 4. Dependency Map

```
main.ts (GameClient)
  ├→ renderer/renderer.ts (draw canvas, reads planningState by reference)
  ├→ input.ts (parse mouse/keyboard → InputEvent)
  ├→ ui/ui.ts (manage screens, accept UIEvent)
  ├→ game/command-router.ts (GameCommand → state mutation or network)
  ├→ game/client-context-store.ts (apply shared runtime/session field updates)
  ├→ game/game-state-store.ts (apply/clear authoritative game state + renderer sync)
  ├→ game/planning-store.ts (apply shared planning-state mutations)
  ├→ game/session-controller.ts (create/join/local-start/exit session lifecycle)
  ├→ game/session-api.ts (HTTP create/join + token persistence)
  ├→ game/action-deps.ts (lazy-cached deps for action handlers + presentation)
  ├→ game/state-transition.ts (client-state entry effects and screen changes)
  ├→ game/network.ts, game/messages.ts (handle S2C)
  ├→ game/transport.ts (WebSocket, Local, and LocalGame transport factories)
  ├→ game/phase.ts (derive ClientState from GameState)
  ├→ game/keyboard.ts (KeyboardAction → GameCommand)
  ├→ game/helpers.ts (derive HUD view models)
  ├→ game/[combat|burn|ordnance]-actions.ts (phase-specific actions)
  ├→ game/planning.ts (user input accumulation)
  ├→ shared/types/{domain,protocol,scenario} (bounded shared type ownership)
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
| ALL → shared/types/* | **Very High** | Shared types remain the integration point; all imports use bounded modules (`domain` / `protocol` / `scenario`) directly |

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

## 6. Current Decisions and Planned Shifts

See [BACKLOG.md](BACKLOG.md) for open work. Below
captures the main architectural stances and why they
currently exist.

- **User accounts / auth**: Adds login friction that hurts adoption during user testing. The current anonymous token model is sufficient. Revisit for native app store distribution or payment integration.
- **N-player generalisation**: Delta-V is a 2-player game. `[PlayerState, PlayerState]` is clearer and more type-safe than `PlayerState[]`. Generalise when a second game actually needs it.
- **Generic hex engine extraction**: Designing a framework from N=1 games is premature abstraction. Fork Delta-V when game #2 starts and build the framework from two concrete implementations.
- **Serialisation codec**: `GameState` is plain JSON. A codec adds overhead with zero current benefit.
- **Replay architecture / event sourcing**: Accepted as the target direction. Match-scoped event streams with versioned envelopes (`EventEnvelope`: gameId, seq, ts, actor, event) are now implemented alongside the existing snapshot-based replay archive. The next steps are explicit RNG outcome capture, projection rebuilds, and checkpoints. The snapshot persistence is transitional scaffolding that should be downgraded to cache once projections are verified.
- **UI framework adoption**: The DOM UI layer is still small enough to own directly. The current compromise is a tiny local signals layer for view-local state and cleanup, without paying the cost of adopting a full framework (Preact, etc.) across the entire client.
- **Structural sharing / Immer**: Reconsidered alongside the event-sourcing shift. Immer is still not a prerequisite and should not block the migration. The immediate value is in stable event schemas, append ordering, explicit RNG facts, and projector correctness, not in rewriting the whole engine around Proxy-based updates. Revisit only if projector reducers or future command handlers become materially clearer with Immer; if adopted at all, it should start at the projection layer rather than as an all-at-once engine rewrite.
