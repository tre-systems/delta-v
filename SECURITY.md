# Security & Anti-Cheat Review

This document outlines the security posture and anti-cheat mechanisms built into the Delta-V game engine. As a competitive multiplayer game, maintaining the integrity of the game state and preventing unauthorized manipulations is a core architectural requirement.

## Authoritative Server Model

Delta-V employs a strict **Authoritative Server Model**. The client is treated as a "dumb terminal" responsible only for rendering state and forwarding player intent (inputs). All game logic, physics computations, and rules enforcement occur on the backend via Cloudflare Durable Objects.

### 1. Identity & Impersonation (SECURE)
A player cannot forge actions for their opponent.
- When a WebSocket connects to a game lobby, the server handles upgrading the connection and tightly binds that socket reference to an internal player tag (`player:0` or `player:1`).
- When an action is received from a client socket, the server determines the `playerId` strictly by analyzing the socket reference (`this.getPlayerId(ws)`).
- The client *never* sends its ID or authentication tokens in the command payload, making spoofing impossible.

### 2. State Leaks & Hidden Information (SECURE)
A player cannot use browser developer tools or network sniffers to reveal hidden data (e.g., the identity of the fugitive transport in the *Escape* scenario).
- The authoritative `GameState` is maintained server-side.
- Before broadcasting state updates, the server explicitly sanitizes the payload through `filterStateForPlayer()`.
- Properties containing hidden data, such as the boolean `hasFugitives`, are stripped from ships not owned by the receiving player socket *before* JSON serialization.

### 3. RNG Manipulation (SECURE)
A player cannot predict or manipulate dice rolls, asteroid hazard checks, or torpedo/mine detonation results.
- The client only submits structural intent (e.g., `{ shipId: 'A', burn: 1 }`, or an array of `attacks`).
- The client never submits random seeds or dice results.
- All pseudo-random number generation (`Math.random()`) occurs strictly on the server during the state evaluation phase (`processCombat`, `processOrdnance`, `processAsteroidHazards`).

### 4. Payload Forging & Rules Enforcement (SECURE)
A player cannot execute impossible maneuvers, such as burning 5 fuel in one turn, or firing weapons from a disabled ship.
- `game-engine.ts` comprehensively validates all incoming orders against the canonical game rules before applying them to the state.
- Examples of server-side validation include:
  - Checking that a ship has sufficient fuel before accepting a burn order.
  - Ensuring warships cannot exceed an overload burn of 2, and commercial ships cannot exceed a burn of 1.
  - Enforcing the strict mass limits of ordnance (e.g., a frigate cannot launch a nuke without sufficient cargo capacity).
  - Preventing disabled ships from issuing astrogation orders or declaring attacks.

## Frontend Vulnerabilities

The frontend architecture has been reviewed and verified to be secure against common web vulnerabilities.

### 1. Cross-Site Scripting (XSS)
- The DOM is updated entirely using safe APIs (`textContent` and CSS classes).
- There is no parsing of untrusted user input into `innerHTML`.
- The only user input field (the 5-letter game join code) is heavily sanitized, uppercased, and rendered safely.

### 2. Code Injection
- The codebase does not utilize `eval()`, `new Function()`, or execute strings in `setTimeout`.

### 3. Denial of Service (DoS)
- Cloudflare Workers provide innate rate-limiting and payload-size caps before traffic even reaches the application layer.
- The server logic uses strict Try/Catch blocks around `JSON.parse` to cleanly reject malformed WebSocket payloads without crashing the Durable Object instance.
