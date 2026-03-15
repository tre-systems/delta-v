# Delta-V

An online multiplayer implementation of [Delta-V](https://en.wikipedia.org/wiki/Delta-V_(board_game)) -- space combat with vector movement and gravity across the inner Solar System.

## What is it?

Two players command ships racing between planets. Ships move using realistic vector physics on a hex grid: velocity persists between turns, fuel is burned to accelerate, and planetary gravity deflects your course. Combat uses odds-based dice resolution with range and velocity modifiers.

The game renders as a smooth, continuous-space experience (no visible hex grid) while using axial hex coordinates internally for all game logic.

## Quick Start

```bash
npm install
npm run dev        # Start local dev server (wrangler)
```

Open two browser tabs to `http://localhost:8787`. Create a game in one tab, join with the code in the other.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server |
| `npm run build` | Build client bundle |
| `npm run typecheck` | Run TypeScript type checking |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run deploy` | Deploy to Cloudflare Workers |

## Architecture

Full TypeScript stack: Cloudflare Workers + Durable Objects on the server, HTML5 Canvas on the client.

```
src/
  shared/           Shared game logic (server + client)
    hex.ts           Axial hex math library
    movement.ts      Vector movement + gravity engine
    combat.ts        Gun combat, damage tables, dice
    game-engine.ts   Pure game state machine (no IO)
    map-data.ts      Solar system map + scenarios
    types.ts         All type definitions
    constants.ts     Ship stats, game constants
  server/
    index.ts         Worker entry (HTTP + WebSocket routing)
    game-do.ts       Durable Object (game state, turn lifecycle)
  client/
    main.ts          Client state machine + WebSocket
    renderer.ts      Canvas rendering + camera + animation
    input.ts         Mouse/touch input, burn planning
    ui.ts            HTML overlay UI (menus, HUD, game over)
```

The game engine (`game-engine.ts`) is a pure-function module with no IO, making it fully unit-testable. The Durable Object (`game-do.ts`) is a thin wrapper handling WebSocket lifecycle and storage.

## Game Rules

See [SPEC.md](SPEC.md) for the full game specification including movement, combat, damage, and scenario rules.

### Implemented

- Vector movement with velocity persistence
- Planetary gravity (full and weak)
- Fuel management and resupply at bases
- Overload maneuver (warships burn 2 fuel for 2-hex acceleration)
- Landing and takeoff mechanics
- Gun combat with odds-based damage table
- Counterattack system
- Planetary base defense fire
- Ordnance: mines, torpedoes, and nukes
- Damage tracking (disabled turns, cumulative elimination)
- Asteroid hazard rolls
- Ramming, crash resolution, and nuke-blasted asteroid removal
- Detection state for enemy ships
- Phase cycling (astrogation -> ordnance -> movement -> combat -> next player)
- Local AI opponent with difficulty levels
- Six playable scenarios: Bi-Planetary, Escape, Convoy, Duel, Blockade Runner, Fleet Action

### Planned

- Spec-accurate deferred gravity / orbit edge cases
- Hidden-info scenarios with authoritative fog of war
- Additional scenario variants from the full board game
- Richer presentation polish (more effects, deeper onboarding, stronger combat odds UI)

## Tech Stack

- **Runtime**: Cloudflare Workers + Durable Objects
- **Language**: TypeScript (full stack)
- **Rendering**: HTML5 Canvas 2D
- **Build**: esbuild (client), wrangler (server)
- **Testing**: vitest
- **CI**: GitHub Actions (typecheck + test + build)

## License

All rights reserved.
