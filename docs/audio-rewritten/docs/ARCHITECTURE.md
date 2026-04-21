# Delta-V Architecture & Design Document

Delta-V is an online multiplayer space combat and racing game. This document describes the current architecture, core systems, major design patterns, and the highest-value follow-ups.

The authoritative server model is event-sourced: the Durable Object persists a match-scoped event stream plus checkpoints, and recovers authoritative state from the checkpoint plus event tail — not from a separate persisted game-state snapshot slot.

Document boundary: gameplay rules and protocol examples live in the spec document, coding conventions live in the coding standards document, contributor workflow lives in the contributing guide, open work lives in the backlog, and the deeper walk-through of why patterns look the way they do lives in the patterns directory.

## Quick Navigation

- [1. High-Level Architecture](#1-high-level-architecture)
- [2. Core Systems Design](#2-core-systems-design)
- [3. Data Flow](#3-data-flow)
- [4. Dependency Map](#4-dependency-map)
- [5. Current Decisions and Planned Shifts](#5-current-decisions-and-planned-shifts)
- [6. Client bundle and release hygiene](#6-client-bundle-and-release-hygiene)

Deployment assumption: the client and Worker ship as a single version line, meaning one deploy updates the Worker and static assets together. Staggered old-client / new-server configurations are not supported. Breaking protocol changes require a coordinated deploy; additive JSON fields are preferred. When bumping the game-state schema version, a coordinated release checklist applies.

## 1. High-Level Architecture

Delta-V uses a full-stack TypeScript architecture built around a shared side-effect-free engine with authoritative edge sessions. The authoritative room persists an append-only match stream and derives current state from that stream plus optional checkpoints.

The codebase is divided into three top-level areas. The shared folder holds all game logic with no I/O — it is fully testable and side-effect-free. The server folder contains the Cloudflare Workers (HTTP-Requests — "Workers" is Cloudflare's term for serverless edge functions) entry point plus three Durable Object classes. The client folder holds the state machine, the Canvas renderer, and the DOM UI.

### Cloudflare Durable Objects

Three Durable Object classes back the server. The first, called the game binding, runs one instance per active match and is responsible for the event stream, checkpoints, WebSocket connections, and alarms. The second, called the matchmaker binding, is a singleton running a single global instance that manages quick-match ticket queues and seat pairing. The third, called the live-registry binding, is also a singleton that powers the live-matches listing endpoint.

The flow between these components works as follows. The Cloudflare Worker handles incoming HTTP requests and routes them. Quick-match requests go to the matchmaker; room creation, joining, replay, and WebSocket upgrade requests go to the game binding; and the live-matches query goes to the live registry. Once the matchmaker pairs two players it hands off to the game binding. When a game starts or ends, the game binding notifies the live registry. Completed matches are archived to object storage, and telemetry and error data are written to a relational database.

The game Durable Object carries nearly all game state and is the focus of the rest of this document. The two support Durable Objects are small and each runs as a single instance in the cluster.

### Diagrams (Mermaid)

The following paragraphs describe the runtime layers and action flows that diagrams in the source document illustrate visually.

**Runtime layers:** The browser contains a DOM UI with reactive signals, a Canvas renderer, and a client kernel that coordinates them. Both the UI and renderer talk to the kernel. The kernel communicates outward through a transport abstraction over a WebSocket connection. On the other side of that connection sits the Cloudflare Worker, which delegates to the game Durable Object, which in turn calls the shared engine. The Durable Object also persists data to Durable Object storage, optional object storage, and a telemetry database.

**Authoritative action path (multiplayer):** A client opens a WebSocket connection to a room. When the client sends a message, the Durable Object first applies a socket-level rate limit, then parses and validates the message against the client-to-server union type. The validated message is dispatched to the game-state action handler, which calls the appropriate shared-engine function such as the astrogation processor or the combat resolver. The engine returns a new state plus a list of engine events. On success the Durable Object appends versioned event envelopes, saves a checkpoint if appropriate, publishes the state change, and broadcasts a filtered state-bearing message back to clients.

**Client command path:** Raw input events are interpreted into game commands, which the command router sends either to the local engine (for single-player) or over the WebSocket (for multiplayer).

**Engine phase state machine:** The authoritative game phase follows a state machine. The game begins in a waiting state. From waiting it can move to fleet building or directly to astrogation. Fleet building can advance to astrogation or end in game over. Astrogation connects to ordnance, logistics, combat, a self-loop for timeout-advance paths, and game over. Ordnance connects to logistics, combat, astrogation, and game over. Logistics connects to combat, astrogation, and game over. Combat connects back to astrogation or to game over.

**Event-sourced recovery and replay projection:** When an authoritative action runs, the engine returns the next state plus engine events. Those events are appended as event envelopes and checkpoints are saved at turn boundaries and game end. To rebuild state — for reconnection or replay — the system loads the latest checkpoint, loads the event tail that followed it, and projects those events forward to the current state.

Diagram maintenance rule: when command flow, phase transitions, or persistence and projection behavior changes, the diagrams should be updated in the same pull request.

### Key Technologies

- Language: TypeScript in strict mode across the entire stack.
- Frontend: the HTML5 Canvas 2D API for rendering, and raw DOM events for UI and input. No heavy frameworks such as React or Vue are used, keeping the game loop as fast as possible.
- Backend: Cloudflare Workers (HTTP-Requests) for HTTP routing and Cloudflare Durable Objects for authoritative game state and WebSocket management.
- Build and tools: esbuild for fast client bundling, wrangler for local testing and deployment, and Vitest for unit testing.

### Architectural Stance

- Side-effect-free engine. The shared folder has no I/O; the Durable Object wraps it with persistence and WebSocket plumbing.
- Event-sourced authoritative state. Match state is a projection of an event stream plus checkpoints — live play, replay, and reconnect share one code path.
- Scenario-driven. A flat scenario-rules flag bag and a partial AI-config override let scenarios vary gameplay without branching engine code.
- Narrow class usage. The only production class is the game Durable Object class. Everything else uses factory functions.
- Zero runtime UI framework. Canvas 2D rendering plus a small local signals library; no React, Vue, Immer, or similar.

Each of these stances is walked through in the patterns directory with examples and tradeoffs.

---

## 2. Core Systems Design

The architecture is divided into three distinct layers: Shared Logic, Server, and Client.

### A. Shared Game Engine

This is the heart of the project. All game rules live in the shared folder, making the system robust and completely unit-testable.

#### Module Inventory

The shared layer contains the following modules. The hex math module handles axial hex distance, neighbours, line drawing, and pixel conversion — it has zero game knowledge and is fully generic. The utility module provides functional collection helpers and is also fully generic.

The types folder holds shared interfaces for domain objects, protocol messages, and scenario data. The shared protocol module handles runtime client-to-server validation and normalization — trimming chat, bounding payloads — and complements the protocol types. The replay module contains the replay timeline structure and match identity builder. The constants module defines ship stats, ordnance mass, detection ranges, and combat and movement constants. The movement module implements vector movement with gravity, fuel, takeoff and landing, and crash detection. The combat module handles gun combat tables, line-of-sight, range and velocity modifiers, heroism, and counterattack. The map-data module defines solar system bodies, gravity rings, bases, and scenario definitions.

The AI folder contains a rule-based AI with composable scoring, per-phase decision modules, and difficulty configuration. The scenario capabilities module provides a derived capability layer — defaults plus feature predicates for scenario rules. The engine barrel module re-exports the public engine API. The engine events module defines a discriminated union of 32 granular domain event types.

The event projector module performs deterministic projection from a persisted event-envelope stream plus checkpoints to a game state; it is used by both the server and tests. Additional engine phase modules cover game creation, fleet building, astrogation, movement, combat, ordnance, logistics, victory, and shared helpers. The turn-advance module handles damage recovery, player rotation, reinforcement spawning, and fleet conversion. The post-movement module covers ramming, inspection, capture, resupply, and detection.

#### Key Design Patterns

The game engine module is a side-effect-free state machine. It takes the current game state and player actions — astrogation orders, combat declarations — and returns a new game state along with events covering movements and combat results. It has no I/O side effects: no DOM, no network, no storage. It never mutates the caller's state.

The movement module contains the complex vector math, gravity-well logic, and collision detection. Moving a ship is resolved strictly on an axial hex grid.

The combat module evaluates line-of-sight, calculates combat odds based on velocity and range modifiers, and resolves damage. It mutates ships directly, updating lifecycle fields and heroism flags.

The types folder is the single source of truth for all data structures — game state, ships, combat results, and network message payloads — split across domain, protocol, and scenario files with a barrel re-export. This ensures the client and server never fall out of sync.

Dependency injection: engine functions accept a map and a random-number generator as parameters so they can be tested without global state or non-determinism.

Domain event emission: turn-resolution engine entry points emit engine events — 32 granular types including ship moved, ship crashed, combat attack, ordnance launched, phase changed, game over, committed command events, and logistics events — alongside state and animation data. The server reads these engine events directly; there is no server-side event derivation. Movement animation data remains separate for client rendering.

#### AI Strategy Design

The AI uses a config-weighted composable scoring architecture rather than a monolithic decision tree.

The AI difficulty config module defines a flat record of roughly 60 numeric weights and boolean flags. Three presets — easy, normal, and hard — tune aggression, accuracy, and capability without changing any logic. The scenario rules allow selectively overriding individual knobs per scenario; for example, the Duel scenario lengthens engagements this way. This is the Strategy pattern expressed as data rather than class hierarchies.

The AI scoring module contains composable scoring functions, each handling one concern: navigation scoring weighs distance and speed toward an objective; escape scoring weighs distance from center and velocity; race-danger scoring applies a gravity-well proximity penalty; gravity look-ahead scoring captures deferred-gravity value one turn ahead; and combat-positioning scoring evaluates engagement and interception posture. Each function takes a course candidate and a config and returns a number.

The AI orchestration module ties it together: for each AI ship it enumerates all seven burn options (six hex directions plus a null burn), computes each resulting course, sums scores across all strategies, and picks the highest. Combat and ordnance decisions follow the same evaluate-all-options-then-pick pattern.

Difficulty tuning is pure data, new scoring dimensions are pure additions, and all AI functions accept a random-number generator for deterministic testing.

#### Engine Mutation Model and RNG Injection

The shared engine is side-effect-free and externally immutable. Turn-resolution entry points deep-clone their input state, mutate the clone internally, and return it. A random-number generator is a mandatory parameter on all turn-resolution entry points; the server derives a per-match, per-action pseudo-random number generator from a seed persisted in storage.

### B. The Server

The backend leverages Cloudflare's edge network.

#### Module Inventory

The server layer contains the following modules. The Worker entry module handles top-level route dispatch and static asset proxying — a generic pattern. The room routes module handles room lifecycle endpoints for creating, joining, replaying, and upgrading to WebSocket — roughly 85% of this shape is reusable across projects. The reporting module handles error and telemetry endpoints, hashing, and rate-limit helpers. The environment module defines Worker bindings and types. The protocol module covers room codes, tokens, initial-payload parsing, seat assignment, and shared-validator re-export — again about 85% game-agnostic.

The game Durable Object class composes the fetch, WebSocket, and alarm paths — roughly 70% of this is reusable multiplayer plumbing. The fetch module handles HTTP init, join, and replay endpoints plus WebSocket upgrade and welcome or reconnect messages. The WebSocket hibernation module handles incoming messages and close events, delegating parsed message handling to the socket helper module. The alarm module manages disconnect forfeit, turn timeout, and inactivity archiving. The turn-timeout module handles the timeout branch including engine outcome and state publication. The telemetry module reports engine and projection errors to the database.

The actions module wires per-action engine calls together. The broadcast module provides filtered message broadcasting and socket send helpers. The publication module runs the full state-publication pipeline: appending events, checkpointing, parity verification, archiving, timer management, and broadcasting. The HTTP handlers module handles init, join-check, and replay request handling. The socket helper module handles message rate limiting, client parsing, and an auxiliary message dispatch map.

The projection module shapes replay timelines using the event projector and applies viewer-filtered replay entries. The match module handles session initialization and rematch logic. The archive module covers match-scoped event envelopes with game ID, sequence number, timestamp, and actor fields, plus checkpoints, replay projection helpers, and match identity. The archive storage module manages chunked event stream keys in Durable Object storage. The match-archive module persistently archives completed matches to object storage plus writes metadata to the relational database — this pattern is fully generic. The message builders module constructs server-to-client message shapes. The session module manages the disconnect grace period and alarm scheduling — fully generic. The turns module handles turn-timeout auto-advance.

#### Key Patterns

- Event-sourced matches: a chunked event stream plus checkpoints; state is projected from the stream.
- Hibernatable WebSocket plus single-alarm scheduling: sockets are tagged with a player identifier; one alarm multiplexes disconnect grace, turn timeout, and inactivity.
- Single state-bearing outbound message per action: one server-to-client frame carries the full updated game state; a game-over message follows as a separate frame.
- Viewer-aware filtering: a filter function strips hidden state before sending; it is used for live play, reconnect, replay, and spectators.
- Single choke points: the publish-state-change function, the run-game-state-action function, and the client-side apply and clear functions each serve as the sole point where their respective side effects occur.
- Shared runtime protocol validation lives in the shared protocol module beside the protocol types — the Durable Object consumes the validate-client-message function rather than owning message shape itself.
- Rate limiting is described in the security document.
- The match-archive binding connects production deployments to object storage so completed rooms can persist replay data after the Durable Object goes inactive.

#### Seat Assignment and Disconnect Grace

Seat assignment uses a three-step fallback. First, a player-token match returns a returning player to their seat even if the previous socket is still open. Second, a token-less join is allowed when an open seat has no player token — this is the default guest flow. Third, if no seats are available the join is rejected.

On disconnect, the Durable Object stores a marker containing the player ID and a 30-second deadline, then schedules an alarm. If the player reconnects within 30 seconds with a valid token the marker is cleared. If the alarm fires with the marker still in place the game ends by forfeit.

### C. The Client

The frontend renders the pure hex-grid state into a smooth, continuous graphical experience.

#### Module Inventory

The client layer is organized into four areas. The client root contains the entry point, raw input, audio, tutorial, DOM helpers, telemetry, viewport management, and the reactive signals runtime. The game subfolder holds command routing, the planning store, the game-state store, state transitions, session control, phase logic, transport, actions, HUD controller, and camera controller. The renderer subfolder handles Canvas rendering including camera, scene, entities, and effects. The UI subfolder covers DOM overlays: menu, HUD, ship list, fleet building, game log, formatters, button bindings, and screens.

#### Three-Layer Input Architecture

1. Raw input: mouse, touch, and keyboard events are translated into raw input events covering hex clicks and hex hovers. This layer has no game knowledge.
2. Game interpretation: raw input events combined with the current phase and state are mapped to game commands by a pure function.
3. Command dispatch: the command router sends each game command either to local state or over the network.

#### Client State Machine

The client state machine moves through: menu, connecting, waiting for opponent, and a family of playing substates, then game over. The playing substates are fleet building, astrogation, ordnance, logistics, combat, movement animation, and opponent turn. Input is only processed when the phase matches the active player.

#### Interaction FSM (Library-free)

To prevent UI race conditions and ensure visibility is strictly synchronized with the game state, the client uses a lightweight interaction finite state machine.

The interaction mode — astrogation, animating, waiting, and so on — is derived directly from the single stored client state rather than being maintained as a second mutable field. The apply-client-state-transition function owns stored client state changes, and reactive consumers derive the interaction mode from the state signal as needed. A screen-visibility module maps these interaction modes to declarative DOM visibility states, ensuring buttons such as the confirm button or fire button are never visible during unauthorized transitions like animations.

#### Rendering Pipeline (per frame)

The rendering pipeline runs three layers per frame.

1. The scene layer renders in world coordinates: starfield, hex grid, gravity indicators, bodies, asteroids, and bases.
2. The entity layer renders animated elements: ship trails, velocity vectors, ships, ordnance, and combat effects.
3. The overlay layer renders in screen coordinates: ordnance guidance, combat highlights, and the minimap.

#### Key Design Patterns

The browser entry module handles global setup — error handlers, viewport, service worker reload — and creates the game client, then exposes it on the global window object.

The client kernel module exports the top-level client coordinator. It owns WebSocket and local-AI orchestration and delegates command dispatch, authoritative-state application and clearing, planning mutations, runtime and session fields, state-entry side effects, and session lifecycle to focused sub-modules. The runtime bootstrap exposes only the renderer, the show-toast function, and a dispose function on the global game object.

The renderer module is a highly optimized Canvas 2D renderer factory. It separates logical hex coordinates from pixel coordinates. Extracted helpers own movement-animation lifecycle and trail state. The renderer itself is the canvas shell and per-frame orchestrator, and composites a cached static scene layer — stars, grid, gravity, asteroids, and bodies — when the camera and viewport are unchanged.

The input module manages user interaction: panning, zooming, and clicking. It translates raw browser events into input event objects, while a companion module owns pointer drag, pinch, and minimap state and math. The input shell owns its DOM listener lifecycle, including outside-canvas pointer release and touch-cancel cleanup. A pure interpret-input function then maps these to game commands, ensuring the input layer never directly mutates application state.

The game subfolder handles command routing, action handlers for astrogation, combat, and ordnance, planning-state helpers, runtime and session helpers, phase derivation, game-state helpers, transition helpers, session helpers, transport abstraction, connection management, input interpretation, view-model helpers, and presentation logic. Ordnance-phase auto-selection and HUD legality are derived from shared engine rules rather than client-only heuristics.

The renderer subfolder contains Canvas drawing layers — scene, entities, vectors, effects, and overlays — plus camera, minimap, and animation management.

The UI subfolder contains screen visibility logic, HUD view building, button bindings, game log, fleet building, ship list, formatters, layout metrics, and small reactive DOM view models.

The reactive signals runtime and the UI manager together keep the client framework-free while using a small signals runtime for durable session and UI state. The client session owns reactive game state, client state, player identity, waiting and reconnect fields, and logistics references. The UI manager owns long-lived view instances and derives DOM visibility directly from the state signal through the interaction FSM, with a small scenario-active signal for the menu and scenario UI sub-state. Short-lived events such as toasts remain imperative.

The planning store owns local planning mutation methods and a revision signal that increments after local planning changes. Pure derivation modules build HUD state, submitted orders, and message handling plans from the session and planning state rather than relying on one broad helper module.

The client session is split across several files. One module defines the client session aggregate shape; another owns route and WebSocket URL helpers; a third handles HTTP create, join, and replay flows; and two more own reconnect token persistence. Stores and controllers mutate the aggregate through focused collaborators.

The audio module handles Web Audio API (Application Programming Interface) interactions.

### D. Progressive Web App

Delta-V is a fully installable Progressive Web App, or PWA. A lightweight hand-written service worker provides several capabilities.

Precaching of the app shell — the main page, the client bundle, the stylesheet, and icons — enables instant repeat loads. Offline single-player works because the AI opponent runs entirely client-side, so cached assets allow full gameplay without a network connection. The service worker never intercepts non-GET requests and explicitly bypasses multiplayer and reporting routes — WebSocket connections, room creation, join validation, error reporting, and telemetry — so those stay authoritative. Static assets use a stale-while-revalidate strategy and navigation uses a network-first strategy, complementing Cloudflare's edge caching. The build script injects a content hash into the service worker cache name, so every deploy with code changes triggers an automatic service worker update and page reload.

### E. Build Pipeline

The project uses minimal, fast build tooling with no heavy bundler configuration.

Client bundle: a build script produces a single ECMAScript module bundle from the client entry point. Production builds are minified; development builds include source maps. esbuild was chosen for sub-second build times. Server bundle: wrangler handles server compilation and deployment and provides local development with Durable Object simulation. Cache busting: the build script hashes the output bundle and stylesheet, then injects the hash into the service worker cache name. Every deploy with code changes triggers an automatic service worker update. Type checking: the TypeScript compiler runs separately from bundling — esbuild strips types without checking them. Linting: Biome runs as a pre-commit hook and in continuous integration.

Cloudflare bindings defined in the wrangler configuration include: the game binding, which is a Durable Object class for authoritative game rooms; the matchmaker binding, a singleton Durable Object for the quick-match queue; the live-registry binding, another singleton Durable Object for the "live now" matches registry; the database binding, a D1 relational database that holds telemetry plus the match archive, player, and match rating tables; the match-archive binding, an R2 bucket for completed match JSON archives; the assets binding for the static bundle; and four rate-limit bindings — the create limiter at five per minute that is shared by create, agent-token, quick-match, and claim-name; the telemetry limiter at one hundred twenty per minute; the error limiter at forty per minute; and the Model Context Protocol limiter at twenty per minute, keyed per agent-token hash or per hashed IP.

### F. Testing Infrastructure

Testing uses Vitest with co-located test files, property-based testing via fast-check, and enforced shared-engine coverage.

Test organization: unit tests live next to the module they test, property tests do the same, and contract fixtures are JSON files in fixtures directories for protocol shape assertions. There are no separate test folders.

Next, mock patterns for Durable Objects. Focused test modules for each Durable Object concern — alarm, fetch, turn-timeout, and WebSocket — stub storage and handler dependencies with mock functions instead of full Durable Object harnesses when a narrow branch is under test. A mock storage implementation is an in-memory map with get, put, delete, and list operations matching the Durable Object storage API, including atomic multi-key put. A mock Durable Object state implementation tracks sockets via a weak map for tag-based lookup, matching the hibernatable WebSocket API surface.

Deterministic pseudo-random number generation in tests: engine tests pass a deterministic random-number function — such as one that always returns 0.5, or a seeded sequence — to reproduce exact outcomes. This is why random-number generator injection is mandatory for all turn-resolution entry points.

Property-based test generators: custom fast-check arbitraries generate valid game inputs within bounded ranges — hex coordinate generators, small velocity vector generators, and so on. Tests verify invariants that must hold across all inputs: fuel never goes negative, hex distance is symmetric, and movement preserves conservation laws.

Coverage thresholds: the shared folder has enforced coverage thresholds for statements, branches, functions, and lines via the Vitest configuration. Both the pre-commit hook and CI run the coverage check to prevent backsliding.

### Library Stance

The architecture currently benefits from a narrow dependency surface. That remains the default.

Do not add framework, state-machine, or rendering stacks by default. React, Vue, Redux, Zustand, RxJS, XState, and canvas or game frameworks would blur boundaries that are currently explicit and testable. Prefer targeted libraries only when they remove a real maintenance or security burden.

Potentially good additions later: a DOM-sanitization library if any user-controlled or external HTML needs to be rendered; a schema library such as Valibot or Zod if protocol or event-envelope schemas expand enough that handwritten validators become harder to reason about.

Not worth swapping right now: the custom reactive layer. It is small, tested, and intentionally scoped. Replacing it with a library would only make sense if the project no longer wants to own reactive internals.

---

## 3. Data Flow

### A Movement Turn

1. During the Astrogation phase, players select their burn — that is, their acceleration vectors — via the input module.
2. The client sends an astrogation WebSocket message to the server.
3. The game Durable Object gathers orders from both players.
4. When both players have submitted, or the turn timer expires, the server calls the astrogation processor in the shared engine.
5. The engine calculates the new physics vectors, resolves gravity effects, and detects crashes.
6. The Durable Object saves the new state and broadcasts a movement result to both clients.
7. The clients receive the result, pause input, and the renderer smoothly interpolates the ships along their calculated paths. Once the animation finishes, the game proceeds to the Ordnance and Combat phase.

### WebSocket Protocol

Client-to-server messages cover fleet ready, astrogation, ordnance, place base, skip ordnance, begin combat, combat, single combat, end combat, skip combat, logistics, skip logistics, surrender, rematch, chat, and ping.

Server-to-client messages cover welcome, spectator welcome, match found, game start, movement result, combat result, single combat result, state update, game over, rematch pending, chat, error, pong, and opponent status.

All messages are discriminated unions validated at the protocol boundary. Chat payloads are trimmed before validation and blank post-trim messages are rejected, so non-UI clients cannot inject empty log entries. Clients never mutate authoritative state. The server persists authoritative events plus optional checkpoints, and replay and reconnect are derived from that same persisted stream.

### Multiplayer Session Lifecycle

Creating a room: the client posts to the create endpoint. The Worker generates a room code and a creator token, and initializes the Durable Object. Joining a room: the client hits the join endpoint with an optional player token for a preflight validation check. Replaying a match: an authenticated replay endpoint fetches history from the checkpoint plus event stream. Opening a WebSocket: the Durable Object accepts the connection and tags the socket with the player ID. Once both unique seats are connected the game is created and a game-start message is broadcast. The game loop then runs: each client-to-server action runs through the engine, saves state and events, restarts the timer, and broadcasts a server-to-client result. On disconnect a 30-second grace period begins; the player may reconnect with a valid token, otherwise the game ends by forfeit.

### Event-Sourced Match Lifecycle

At a high level, the event-sourced match lifecycle works as follows.

1. The client submits a validated command.
2. The Durable Object appends canonical, versioned domain events to a per-match stream.
3. Authoritative state is rebuilt or incrementally projected from the checkpoint plus the event tail.
4. Player and spectator or public views are derived from that projection.
5. The server broadcasts one state-bearing update plus any animation and log summaries needed by the client.

With that model established, game-state snapshots are transport payloads and optional checkpoints rather than the authoritative persisted truth.

---

## 4. Dependency Map

The client entry point creates the game client via the client kernel module, which serves as the composition root. The client kernel coordinates the renderer (which draws to the canvas and reads planning state by reference), the input module (which parses mouse and keyboard events into input events), the UI manager (which manages screens and accepts UI events), the command router (which maps game commands to local state mutations or network transmission), and a set of stores and controllers that apply shared runtime and session field updates, authoritative game state, and planning mutations. It also wires session lifecycle through the session controller and session API, handles server-to-client messages, manages browser event wiring and URL auto-join, coordinates UI and input and keyboard into game commands, lazily caches action handler dependencies, applies client-state entry effects and screen changes, and provides transport, phase derivation, keyboard action mapping, derived HUD and order views, and phase-specific action handlers.

The renderer module depends on a camera module for viewport transforms, a set of pure drawing modules for scene, entities, vectors, effects, and overlays, and the shared types, hex math, and constants.

The game Durable Object depends on the actions module, the archive and archive-storage modules for the event stream and checkpoints, the publication pipeline module, the broadcast module, the fetch and HTTP handler and WebSocket and socket helper modules, the projection module, the match and match-archive modules, the message builders module, the alarm and session and turns and turn-timeout modules, the telemetry module, the server protocol module, and the shared game engine.

### Coupling Characteristics

Turning to how tightly different parts of the system are coupled: the boundary from input to game commands is minimal — it is a pure function with no state mutation. The boundary from the coordinator to the transport layer is also minimal — a transport abstraction hides whether the connection is a WebSocket or local, and this is wired inside the client kernel. The renderer's dependency on game state is high — it reads the full state for entity positions, damage, and so on. The renderer's dependency on planning state is also high — it reads by reference for UI overlays such as previews and selections. The UI's dependency on game state is high — the HUD needs ship stats, phase, fuel, and objective data. The client's dependency on the shared engine is medium — the local transport delegates to the shared engine and types must align. Every part of the system depends on the shared types in a very-high-coupling relationship — shared types remain the integration point and all imports use bounded modules directly.

---

## 5. Current Decisions and Planned Shifts

The open work lives in the backlog document. This section captures current architectural stances and why they exist.

- User accounts and authentication: adding login would create friction that hurts adoption during user testing. The current anonymous token model is sufficient. Revisit for native app store distribution or payment integration.
- N-player generalisation: Delta-V is a two-player game. A fixed two-element player array is clearer and more type-safe than a variable-length array. Generalise when a second game actually needs it.
- Generic hex engine extraction: designing a framework from a single game is premature abstraction. Fork Delta-V when game number two starts and build the framework from two concrete implementations.
- Serialisation codec: the game state is plain JSON. A codec adds overhead with zero current benefit.
- Replay architecture and event sourcing: implemented on the authoritative path. Match-scoped event streams with versioned envelopes — carrying game ID, sequence number, timestamp, and actor — along with checkpoints and parity checks are all in place. Replay is projected directly from stored events, including spectator-filtered projections and authenticated replay endpoints. Live spectating uses the same filtered game state over WebSocket. Remaining work is mostly spectator UX polish — lobby links and read-only affordances — and optional rate limits and protocol simplification.
- Public leaderboard: shipped. Glicko-2 ratings are written after each rated match by the rating-writer module. The player table tracks each claimed username and the current rating; the match-rating table holds per-match before-and-after rating snapshots. Humans claim a username through the claim-name endpoint; agents claim through the agent-token endpoint with an optional claim body. Provisional players are hidden from the default view until their rating deviation shrinks and they meet a distinct-opponents threshold. The public page is the leaderboard path; the API consists of the main leaderboard query and a per-player rank lookup.
- UI framework adoption: the DOM UI layer is still small enough to own directly. The current compromise is a tiny local signals layer for view-local state and cleanup, without paying the cost of adopting a full framework across the entire client.
- Structural sharing and Immer: reconsidered with the event-sourcing shift. Immer is not a prerequisite and should not block current work. Near-term value is in event schema stability, append ordering, explicit random-number-generation facts, and projector correctness — not a wholesale rewrite. Revisit only if projector reducers or future command handlers become materially clearer with Immer; if adopted, start at the projection layer.
- Internationalization: English-only product surface for now. No message catalogs, locales, or right-to-left support until localization is prioritized. The spec document remains the canonical English rules reference for scenarios.

---

## 6. Client bundle and release hygiene

Bundle baseline, re-measured in April 2026 from the current client bundle: the raw size is approximately 735 kilobytes and the gzip-compressed size is approximately 155 kilobytes. Update these figures after large renderer or dependency changes.

Supply chain: run a dependency audit before releases; update dependencies judiciously and run the verify script after bumps.

Database migrations: treat as forward-only unless Cloudflare backup and restore is used. Rolling back means redeploying the previous Worker with a compatible schema — there is no automatic down-migration. The migrations directory currently holds four files: creating the events table, creating the match archive, adding match-archive listing support, and adding the leaderboard schema.

Event retention: events rows older than the retention constant — thirty days — are deleted daily by the scheduled Worker cron, which runs at four in the morning and invokes the purge-old-events helper.

Continuous integration: Node version 25 is pinned in the CI workflow configuration, and the Node version file matches.
