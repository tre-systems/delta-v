# Delta-V Architecture & Design Document

Delta-V is an online multiplayer space combat and racing game. This document outlines the high-level architecture, core systems, design patterns used, and proposes areas for future refactorings and improvements.

## 1. High-Level Architecture

Delta-V employs a full-stack TypeScript architecture built around a **shared pure engine with authoritative edge sessions** model.

### Key Technologies
- **Language**: TypeScript (strict mode) across the entire stack.
- **Frontend**: HTML5 Canvas 2D API for rendering (`client/renderer/renderer.ts`), raw DOM/Events for UI and Input. No heavy frameworks (React/Vue/etc.) are used, ensuring maximum performance for the game loop.
- **Backend**: Cloudflare Workers for HTTP routing and Cloudflare Durable Objects for authoritative game state and WebSocket management.
- **Build & Tools**: `esbuild` for lightning-fast client bundling, `wrangler` for local testing and deployment, and `vitest` for unit testing.

---

## 2. Core Systems Design

The architecture is divided into three distinct layers: Shared Logic, Server, and Client.

### A. Shared Game Engine (`shared/`)
This is the heart of the project. The decision to keep all game rules in a shared folder makes the system incredibly robust and completely unit-testable.

- **`engine/game-engine.ts`**: A pure functional state machine. It takes the current `GameState` and player actions (e.g., astrogation orders, combat declarations) and returns a new `GameState` along with events (movements, combat results). **Crucially, it has no side effects (no DOM manipulation, no network calls, no storage access).**
- **`movement.ts`**: Contains the complex vector math, gravity well logic, and collision detection. Moving a ship is resolved strictly on an axial hex grid (using `hex.ts`).
- **`combat.ts`**: Evaluates line-of-sight, calculates combat odds based on velocity/range modifiers, and resolves damage.
- **`types.ts`**: The single source of truth for all data structures (`GameState`, `Ship`, `CombatResult`, network message payloads). This ensures the client and server never fall out of sync.

### B. The Server (`server/`)
The backend leverages Cloudflare's edge network.

- **`index.ts`**: The standard Worker entry point. It creates tokenized game rooms, generates collision-checked 5-character codes, and forwards valid WebSocket requests.
- **`game-do/game-do.ts` (Durable Object)**: Each game instance is backed by a single Durable Object. This ensures that all WebSocket connections for a specific game hit the same exact machine in Cloudflare's network, preventing race conditions.
  - Acts as the authoritative session and transport layer around `game-engine.ts`.
  - Handles WebSocket lifecycle (connections, reconnects, inactivity timeouts, turn timeouts).
  - Validates inputs before dispatch, passes them to the pure engine, stores the resulting state using the Durable Object `ctx.storage`, and broadcasts updates to connected clients.
  - Handles hidden information (e.g., hiding which transport carries fugitives in the Escape scenario) by filtering state broadcasts per-player.

### C. The Client (`client/`)
The frontend is responsible for rendering the pure hex-grid state into a smooth, continuous graphical experience.

- **`main.ts`**: The client-side controller. Manages WebSocket connections, local-AI execution, and phase transitions. It orchestrates the Renderer, Input, and UI through a centralized **`ClientContext`** and a single **`dispatch(GameCommand)`** entry point.
- **`renderer/renderer.ts`**: A highly optimized Canvas 2D renderer. It separates logical hex coordinates from pixel coordinates. It features smooth camera interpolation, persistent trails, and movement/combat animations that occur *between* turn phases.
- **`input.ts`**: Manages user interaction (panning, zooming, clicking). It translates raw browser events into high-level **`GameCommand`** objects which are then dispatched to `main.ts`, ensuring the input layer never directly mutates the application state.
- **`game/` / `renderer/` / `ui/` subfolders**: Pure client-side helpers for combat selection, input planning, minimap geometry, phase derivation, formatting, and tooltip/view-model logic.
- **`ui/ui.ts`** / **`audio.ts`**: Handles the HTML overlay (menus, HUD) and Web Audio API interactions.
- **Visual Polish**: Employs a premium design system with glassmorphism tokens (backdrop-filters), tactile micro-animations (recoil, scaling glows), and pulsing orbital effects for high-end UX.

### D. Progressive Web App (`static/sw.js`, `static/site.webmanifest`)
Delta-V is a fully installable PWA. A lightweight hand-written service worker provides:
- **Precaching** of the app shell (`/`, `client.js`, `style.css`, icons) for instant repeat loads.
- **Offline single-player**: The AI opponent works entirely client-side, so cached assets allow full gameplay without network.
- **WebSocket passthrough**: The service worker explicitly skips `/ws/*` and `/create` routes, ensuring multiplayer connections are never intercepted.
- **Stale-while-revalidate** for static assets and **network-first** for navigation, complementing Cloudflare's edge caching rather than fighting it.

---

## 3. Data Flow Example: A Movement Turn
1. During the Astrogation phase, players select their burn (acceleration) vectors via `client/input.ts`.
2. The client sends a `type: 'astrogation'` WebSocket message to the server.
3. The Durable Object (`game-do.ts`) gathers orders from both players.
4. When both players have submitted (or the turn timer expires), the server calls `processAstrogation()` in the shared engine.
5. The engine calculates the new physics vectors, resolves gravity effects, and detects crashes.
6. The Durable Object saves the new state and broadcasts a `movementResult` to both clients.
7. The clients receive the result, pause input, and `client/renderer.ts` smoothly interpolates the ships along their calculated paths. Once the animation finishes, the game proceeds to the Ordnance/Combat phase.

---

## 4. Refactoring Priorities

The next architectural gains are mostly about keeping the current design readable, not replacing it:

### A. Shared Engine
- **Engine is now decomposed by phase** (`engine/game-engine.ts`, `engine/combat.ts`, `engine/ordnance.ts`, `engine/victory.ts`, `engine/util.ts`): The engine remains a strong fit for pure functions and plain data.
- **Avoid premature ECS migration**: The current rules engine has a small, stable entity set and turn-based processing. An ECS would likely make the rules harder to follow before it creates meaningful flexibility.
- **Prefer a lightweight event log over full event sourcing**: Replays, reconnect catch-up, and spectator mode would benefit from an append-only turn log, but snapshots should remain the source of truth.

### B. Client
- **Continue extracting pure helpers from `main.ts`**: Phase derivation, HUD view models, and local/remote result application should keep moving out of the main controller so browser orchestration stays thin.
- **Renderer is now decomposed by visual responsibility** (`renderer/renderer.ts` plus `combat.ts`, `entities.ts`, `vectors.ts`, `effects.ts`, etc.): Further splits should follow the same pattern of visual responsibility.
- **Add browser-side tests around input/UI/orchestration**: Shared rules are already well covered. The bigger refactor risk now sits in client coordination code.

### C. Server / Operations
- **`game-do/` is now split by concern** (`game-do.ts`, `messages.ts`, `session.ts`, `turns.ts`): Features like spectators or replay catch-up can be added without bloating one class.
- **Public lobby hardening remains future work**: Longer opaque identifiers, rate limiting, and optional identity/account binding matter more than swapping validation libraries.
- **Persistence beyond active rooms is still optional**: Durable Object storage is a good fit for live matches; D1 or another store only becomes necessary once match history or player progression matters.
