# 🚀 Delta-V

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

### [Play Now at delta-v.tre.systems](https://delta-v.tre.systems/)

<a href='https://ko-fi.com/N4N31DPNUS' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

![Delta-V Tactical Map](./screenshot.png)

**Delta-V** is an online, real-time multiplayer tactical space combat and racing game featuring realistic vector movement and orbital gravity mechanics across the inner Solar System, heavily inspired by the classic [Triplanetary (Steve Jackson Games)](http://www.sjgames.com/triplanetary/) board game.

Command your fleet, master astrogation trajectories, sling-shot around celestial bodies, and engage in high-stakes combat where positioning and velocity are just as crucial as firepower.

Check out our [**Ship Aesthetics & Visual Style Guide**](./docs/SPACESHIPS.md) and [**Technology & Lore Guide**](./docs/TECHNOLOGY.md) to understand the high-fidelity NASA-punk concept art and hard sci-fi grounding of our fleet.

## 🌟 Features

### ☄️ Realistic Vector Physics Spaceflight
- **Vector Movement Engine**: Your velocity persists between turns. Plan your burns carefully; there's no friction to stop you.
- **Orbital Mechanics**: Planetary gravity deflects your course. Master "Weak" and "Full" gravity wells to execute slingshot maneuvers.
- **Continuous Rendering vs Discrete Logic**: The visual rendering provides a smooth, continuous-space aesthetic, whilst all game logic acts on a strict, pure axial hex-coordinate system.

### ⚔️ Deep Tactical Combat
- **Odds-Based Combat**: Gun combat utilizes a classic odds-based dice resolution system, influenced by relative velocity and range modifiers.
- **Ordnance Management**: Equip and deploy mines, torpedoes, and devastating nukes.
- **Damage & Repairs**: Complex damage tracking (disabled turns vs. cumulative elimination). Find safe harbor at planetary bases for repairs and resupply.

### 🎮 Multiple Game Modes
- **8 Playable Scenarios**: Features *Bi-Planetary*, *Escape*, *Convoy*, *Duel*, *Blockade Runner*, *Fleet Action*, *Interplanetary War*, and *Grand Tour* race.
- **Local AI Opponent**: Test your skills offline against an AI component with configurable difficulty levels.
- **Real-Time Multiplayer**: Built for fast, responsive web-socket based remote play.

---

## 🛠️ Architecture

Delta-V adopts an elegant, robust architecture utilizing modern web primitives:

```text
src/
├── shared/              # Game Engine — side-effect-free (shared between client & server)
│   ├── engine/            # Core state machine (createGame, processAstrogation, combat, ordnance, victory)
│   ├── movement.ts        # Vector astrogation & gravity logic
│   ├── combat.ts          # Odds resolution & damage tables
│   ├── hex.ts             # Axial hex coordinate math
│   ├── map-data.ts        # Solar system bodies, gravity, bases, scenarios
│   └── ai.ts              # AI opponent for single-player
├── server/              # Cloudflare Workers Backend
│   ├── index.ts           # HTTP entry point & WebSocket routing
│   └── game-do/           # Durable Object: state, messages, sessions, turns
└── client/              # Browser Frontend
    ├── main.ts            # Client-side state machine & networking
    ├── game/              # Game logic helpers (combat, burn, phase, ordnance, input)
    ├── renderer/          # Canvas rendering, camera, animations, minimap
    └── ui/                # DOM overlays (menu, HUD, game log, game over)
scripts/                 # Automated Bot & AI Simulation tests
```

**Design Highlight:** The core `game-engine.ts` is side-effect-free — no DOM, no network, no storage. It receives inputs (astrogation orders, combat declarations) and returns a new state, making the game highly unit testable. All engine entry points clone the input state on entry (`structuredClone`) — callers' state is never mutated. The DOM overlay stays framework-free, with a tiny local signals layer used only where view-local reactive state pays for itself. See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for details. The backend stays authoritative through **Cloudflare Durable Objects**, handling room lifecycle, tokenized joins, join preflight validation, per-match replay archives, and state persistence.

For project conventions and refactoring guidance, see [**CODING_STANDARDS.md**](./docs/CODING_STANDARDS.md).

---

## 🚀 Quick Start

Get your thrusters firing locally in seconds:

1. **Use the Project Node Version**
   ```bash
   nvm use
   ```

   Delta-V is tested in CI with **Node 25.x**.

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Start the Local Development Server**
   ```bash
   npm run dev
   ```
   *This starts the Wrangler server.*

4. **Play the Game**
   - Open your browser to `http://localhost:8787`
   - Open a **second tab** or window to the same URL.
   - Create a game in tab 1, then use the generated invite link in tab 2.

### CLI Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server (Wrangler/esbuild) |
| `npm run build` | Build the client bundle |
| `npm run typecheck` | Run TypeScript type checking across the project |
| `npm test` | Run all unit tests via Vitest |
| `npm run test:coverage` | Run tests with a coverage report under `coverage/` |
| `npm run test:watch` | Run Vitest in continuous watch mode |
| `npm run simulate` | Run headless AI vs AI matches to test game balance and engine stability |
| `npm run deploy` | Deploy straight to Cloudflare Workers |

---

## 📜 Game Rules Reference

For the comprehensive ruleset detailing movement edge cases, damage tables, and specific scenario rules, refer to [SPEC.md](./docs/SPEC.md).

## 🗺️ Roadmap

### Complete
- [x] 8 playable scenarios with AI opponent (Easy/Normal/Hard)
- [x] Server hardening (tokenized rooms, authenticated reconnects, runtime validation)
- [x] Hidden information (server-side state filtering for *Escape*)
- [x] Orbital bases, logistics, reinforcements, fleet conversion
- [x] PWA support (installable, offline single-player)
- [x] Engine safety (clone-on-entry, server rollback, event log)
- [x] Error reporting and anonymous telemetry (D1 storage)
- [x] 1280+ tests across 87 suites, plus scenario AI simulations with per-scenario balance thresholds
- [x] Client/engine decomposition and rules consolidation
- [x] Bounded type imports (`types/domain`, `types/protocol`, `types/scenario`)
- [x] Typed Ship state models (controlStatus, baseStatus, identity unions)
- [x] Authoritative disconnect-forfeit persistence
- [x] Stable escape-role ownership after capture (`originalOwner`)
- [x] Shared `isOrderableShip` rule, combat click/targeting fixes, nuke resupply fix
- [x] Replay archive foundation (per-match archived state transitions)
- [x] Application-layer room creation throttling with optional rate-limit binding support

### Planned
- [ ] **Turn Replay**: Step through recorded turn history
- [ ] **Spectator Mode**: Read-only live battle viewing
- [ ] **Scenario Expansion**: Lateral 7, Fleet Mutiny, Retribution
- [ ] **Passenger Rescue Mechanics**: Rescue-specific transfer and objective rules

---

## 📄 License
All rights reserved.
