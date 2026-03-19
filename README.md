# 🚀 Delta-V

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)

### [Play Now at delta-v.tre.systems](https://delta-v.tre.systems/)

<a href='https://ko-fi.com/N4N31DPNUS' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

![Delta-V Tactical Map](./screenshot.png)

**Delta-V** is an online, real-time multiplayer tactical space combat and racing game featuring realistic vector movement and orbital gravity mechanics across the inner Solar System.

Command your fleet, master astrogation trajectories, sling-shot around celestial bodies, and engage in high-stakes combat where positioning and velocity are just as crucial as firepower.

Check out our [**Ship Aesthetics & Visual Style Guide**](./docs/SHIP_AESTHETICS.md) to see the high-fidelity concept art for our fleet.

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

**Design Highlight:** The core `game-engine.ts` is side-effect-free — no DOM, no network, no storage. It receives inputs (astrogation orders, combat declarations) and produces the new state, making the game highly unit testable. The engine mutates state in place rather than returning immutable snapshots (see [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for details and improvement plan). The backend stays authoritative through **Cloudflare Durable Objects**, handling room lifecycle, tokenized joins, validation, and state persistence.

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
- [x] Server hardening (tokenized rooms, authenticated reconnects, runtime payload validation)
- [x] Hidden information (Fog of War, server-side state filtering for *Escape*)
- [x] AI opponent (Easy/Normal/Hard, gravity-aware pathfinding)
- [x] Orbital bases (carrying, emplacing, torpedo launching)
- [x] PWA support (installable, offline single-player)
- [x] Premium polish (glassmorphism UI, procedural SFX, micro-animations)
- [x] Multiplayer chat (inline in game log, rate-limited, XSS-safe)
- [x] 1010+ tests across 62 suites (unit, property-based, integration), 8 scenario AI simulations
- [x] Deep architectural analysis and reusability assessment ([docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md))
- [x] Asteroid map visuals matching reference map
- [x] Logistics system: surrender, fuel/cargo transfers, looting (enabled on Convoy, Fleet Action, Interplanetary War)
- [x] Reinforcement spawning and fleet conversion infrastructure for future scenarios

### Planned — Features
- [ ] **Logistics transfer picker UI**: Visual widget for selecting transfer amounts (currently skip-only)
- [ ] **New Scenarios**: Lateral 7, Fleet Mutiny, Retribution (require additional mechanics beyond logistics)
- [ ] **Rescue/passenger transfer**: Transfer passengers between ships for rescue scenarios
- [ ] **Spectator Mode**: Third-party connections to watch ongoing battles
- [ ] **Turn Replay**: Review past turns and full game history

### Planned — Architecture
- [x] **Make RNG fully injectable**: All engine entry points require explicit `rng` parameter, no `Math.random` fallbacks
- [x] **Fix `local.ts` state aliasing**: `structuredClone` captures true pre-mutation state for animation diffing
- [ ] **Structural sharing in engine**: Replace in-place mutation with clone-on-entry for diffing, undo, replay, and AI search
- [x] **Decompose `main.ts`**: Split from 1397 LOC; extracted 7 focused modules
- [x] **Eliminate map singleton**: Removed `getSolarSystemMap()` global; all callers use `buildSolarSystemMap()` directly

---

## 📄 License
All rights reserved.
