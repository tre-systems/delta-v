# Delta-V Architecture & Design Document

Delta-V is an online multiplayer space combat and racing game. This document outlines the high-level architecture, core systems, design patterns used, and proposes areas for future refactorings and improvements.

## 1. High-Level Architecture

Delta-V employs a full-stack TypeScript architecture built around a **"Thick Client, Thin Server"** model, but with a highly authoritative server state. 

### Key Technologies
- **Language**: TypeScript (strict mode) across the entire stack.
- **Frontend**: HTML5 Canvas 2D API for rendering (`client/renderer.ts`), raw DOM/Events for UI and Input. No heavy frameworks (React/Vue/etc.) are used, ensuring maximum performance for the game loop.
- **Backend**: Cloudflare Workers for HTTP routing and Cloudflare Durable Objects for authoritative game state and WebSocket management.
- **Build & Tools**: `esbuild` for lightening-fast client bundling, `wrangler` for local testing and deployment, and `vitest` for unit testing.

---

## 2. Core Systems Design

The architecture is divided into three distinct layers: Shared Logic, Server, and Client.

### A. Shared Game Engine (`shared/`)
This is the heart of the project. The decision to keep all game rules in a shared folder makes the system incredibly robust and completely unit-testable.

- **`game-engine.ts`**: A pure functional state machine. It takes the current `GameState` and player actions (e.g., astrogation orders, combat declarations) and returns a new `GameState` along with events (movements, combat results). **Crucially, it has no side effects (no DOM manipulation, no network calls, no storage access).**
- **`movement.ts`**: Contains the complex vector math, gravity well logic, and collision detection. Moving a ship is resolved strictly on an axial hex grid (using `hex.ts`).
- **`combat.ts`**: Evaluates line-of-sight, calculates combat odds based on velocity/range modifiers, and resolves damage.
- **`types.ts`**: The single source of truth for all data structures (`GameState`, `Ship`, `CombatResult`, network message payloads). This ensures the client and server never fall out of sync.

### B. The Server (`server/`)
The backend leverages Cloudflare's edge network.

- **`index.ts`**: The standard Worker entry point. It creates game lobbies (generating 5-letter codes) and upgrades valid WebSocket requests.
- **`game-do.ts` (Durable Object)**: Each game instance is backed by a single Durable Object. This ensures that all WebSocket connections for a specific game hit the same exact machine in Cloudflare's network, preventing race conditions.
  - Acts as a thin wrapper around `game-engine.ts`.
  - Handles WebSocket lifecycle (connections, reconnections, inactivity timeouts).
  - Validates inputs, passes them to the pure engine, stores the resulting state using the Durable Object `ctx.storage`, and broadcasts updates to connected clients.
  - Handles hidden information (e.g., hiding which transport carries fugitives in the Escape scenario) by filtering state broadcasts per-player.

### C. The Client (`client/`)
The frontend is responsible for rendering the pure hex-grid state into a smooth, continuous graphical experience.

- **`main.ts`**: The client-side controller. Manages WebSocket connections, handles the game loop phases, and orchestrates the Renderer, Input, and UI.
- **`renderer.ts`**: A highly optimized Canvas 2D renderer. It separates logical hex coordinates from pixel coordinates. It features smooth camera interpolation, persistent trails, and movement/combat animations that occur *between* turn phases.
- **`input.ts`**: Manages the complex state of user interaction (selecting burn vectors, queuing attacks, choosing targets) before finalizing and sending them to the server.
- **`ui.ts` / `audio.ts`**: Handles the HTML overlay (menus, HUD) and Web Audio API interactions.
- **Visual Polish**: Employs a premium design system with glassmorphism tokens (backdrop-filters), tactile micro-animations (recoil, scaling glows), and pulsing orbital effects for high-end UX.

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

## 4. Possible Improvements and Refactorings

While the current architecture is mature and clean, there are several areas where the codebase could be evolved:

### A. Shared Engine Refactorings
- **Split `game-engine.ts`**: Currently over 1,300 lines long, `game-engine.ts` does a lot of heavy lifting. It could be split into phase-specific modules: `phase-astrogation.ts`, `phase-combat.ts`, and `phase-ordnance.ts`.
- **Entity Component System (ECS)**: If the game were to expand significantly (e.g., multiple ship types with modular weapons, complex asteroid fields), moving from hardcoded arrays of `Ship` and `Ordnance` to a lightweight ECS might make managing side-effects and combat resolution cleaner.
- **Event Sourcing**: Instead of just passing new states back, the engine could exclusively emit an array of "GameEvents." The clients would apply these events to their local state. This helps with replayability (creating a replay viewer) and allows the client to predict state changes more efficiently.

### B. Client Architecture
- **State Management**: The client relies on a large internal state machine inside `main.ts` with many discrete strings (`playing_astrogation`, `playing_movementAnim`). Introducing an explicit State Pattern implementation (or a lightweight library like XState) would make phase transitions and error handling more robust.
- **Canvas Rendering Optimizations**:
  - The `Renderer` class is quite large (2000+ lines). Splitting it into `MapLayer`, `ShipLayer`, `EffectLayer`, and `UILayer` classes would improve maintainability.
  - Implement Offscreen Canvas or canvas caching for static elements (the stars backdrop, map borders, base markers) so they don't have to be re-drawn every single frame.
- **Client-Side Prediction**: Currently, the client must wait for the server to confirm movement before showing it. For local-AI games this is fine, but for high-latency multiplayer, implementing client-side prediction for astrogation (showing a ghost ship where you *will* end up) would massively improve UX. (Note: The game already has a `predictDestination` function, but it could be integrated more deeply into the UI).

### C. Server / DevOps Improvements
- **Matchmaking System**: Currently, players must share a 5-letter code. A lobby/matchmaking system could be implemented using a secondary Cloudflare Worker or by utilizing Cloudflare KV to list active "looking for game" players.
- **Database Persistence**: Currently, game state lives in the Durable Object storage. If a game finishes, it ceases to exist. Integrating Cloudflare D1 (SQL) to save player stats, match histories, and Elo ratings would be a great next step.
- **Turn Reconnection Logic Enhancement**: The reconnect logic works, but if a player disconnects mid-animation, they might lose context. Implementing a "catch-up" event log in the Durable Object that sends missing visual events on reconnect would ensure clients know *why* a ship exploded while they were offline.
- **Zod Schema Validation**: Implementing Zod for all C2S and S2C messages to provide strict runtime validation and prevent malformed payloads from affecting the Durable Object state.
