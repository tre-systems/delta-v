# 🚀 Delta-V

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)

*[Insert Gameplay GIF/Screenshot here]*

**Delta-V** is an online, real-time multiplayer implementation of [Delta-V](https://en.wikipedia.org/wiki/Delta-V_(board_game)) — a tactical space combat and racing game featuring realistic vector movement and orbital gravity mechanics across the inner Solar System. 

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
- **6 Playable Scenarios**: Features diverse scenarios including *Bi-Planetary*, *Escape*, *Convoy*, *Duel*, *Blockade Runner*, and *Fleet Action*.
- **Local AI Opponent**: Test your skills offline against an AI component with configurable difficulty levels.
- **Real-Time Multiplayer**: Built for fast, responsive web-socket based remote play.

---

## 🛠️ Architecture

Delta-V adopts an elegant, robust architecture utilizing modern web primitives:

```text
src/
├── shared/           # Pure Game Engine (Shared between Client & Server)
│   ├── game-engine.ts  # Pure state machine (no IO = highly testable)
│   ├── movement.ts     # Vector astrogation & gravity logic
│   ├── combat.ts       # Odds resolution & damage tables
│   └── hex.ts          # Axial hex coordinate math
├── server/           # Cloudflare Workers Backend
│   ├── index.ts        # HTTP entry point & WebSocket routing
│   └── game-do.ts      # Durable Object storing authoritative game state
└── client/           # Browser Frontend
    ├── main.ts         # Client-side state machine & networking
    ├── renderer.ts     # High-performance HTML5 Canvas 2D engine
    ├── input.ts        # Desktop & touch input / burn planning
    └── ui.ts           # Clean HTML/CSS layout overlays
scripts/              # Automated Bot & AI Simulation tests
```

**Design Highlight:** The core `game-engine.ts` is purely functional. It receives inputs (astrogation orders, combat declarations) and deterministically produces the new state. This guarantees synchronization between server and client without complex reconciliation, and makes the game highly unit testable. The backend acts as a thin wrapper using **Cloudflare Durable Objects** to handle WebSocket lifecycle and state persistence.

---

## 🚀 Quick Start

Get your thrusters firing locally in seconds:

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Local Development Server**
   ```bash
   npm run dev
   ```
   *This starts the Wrangler server.*

3. **Play the Game**
   - Open your browser to `http://localhost:8787`
   - Open a **second tab** or window to the same URL.
   - Create a game in tab 1, and use the generated join code in tab 2.

### CLI Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server (Wrangler/esbuild) |
| `npm run build` | Build the client bundle |
| `npm run typecheck` | Run TypeScript type checking across the project |
| `npm test` | Run all unit tests via Vitest |
| `npm run test:watch` | Run Vitest in continuous watch mode |
| `npm run simulate` | Run headless AI vs AI matches to test game balance and engine stability |
| `npm run deploy` | Deploy straight to Cloudflare Workers |

---

## 📜 Game Rules Reference

For the comprehensive ruleset detailing movement edge cases, damage tables, and specific scenario rules, refer to [SPEC.md](./docs/SPEC.md).

## 🗺️ Roadmap & Planned Features

- [ ] **Deferred Gravity Edge Cases**: Achieve 100% spec-accurate orbital behaviors.
- [ ] **Hidden Information Scenarios**: Implement authoritative Fog of War for specific game modes.
- [ ] **Expanded Content**: Port additional scenarios and variants from the original board game.
- [ ] **Polish**: Enhancements to visual FX, richer onboarding tutorials, and a deeper combat odds UI overview.

---

## 📄 License
All rights reserved.
