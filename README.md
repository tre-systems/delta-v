# 🚀 Delta-V

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

[![Delta-V in-game screenshot — tactical map and HUD](./screenshot.png)](https://delta-v.tre.systems/)

### [Play now at delta-v.tre.systems](https://delta-v.tre.systems/)

**Delta-V** is an online turn-based multiplayer tactical space combat and racing game featuring realistic vector movement and orbital gravity mechanics across the inner Solar System.

Command your fleet, master astrogation trajectories, slingshot around celestial bodies, and engage in high-stakes combat where positioning and velocity matter as much as firepower.

## 🌟 Features

- **Vector physics spaceflight** — velocity persists between turns; burn fuel to alter course; gravity deflects you one turn later.
- **Orbital mechanics** — planetary gravity wells enable slingshot maneuvers; "weak" gravity at moons is a player choice.
- **Tactical combat** — odds-based dice resolution with range and relative-velocity modifiers; mines, torpedoes, and nukes with per-scenario availability.
- **Nine scenarios** — _Bi-Planetary_, _Escape_, _Lunar Evacuation_, _Convoy_, _Duel_, _Blockade Runner_, _Fleet Action_, _Interplanetary War_, _Grand Tour_.
- **Play modes** — local AI at three difficulties, online multiplayer via 5-character room codes, quick-match queue, spectator mode, and a machine-native agent API ([`/agents`](https://delta-v.tre.systems/agents)).
- **Public leaderboard** — unified Glicko-2 ladder for humans and agents ([`/leaderboard`](https://delta-v.tre.systems/leaderboard)); no login required.
- **Continuous rendering, discrete logic** — HTML5 Canvas paints a smooth space view while the engine operates on a strict axial hex grid.

## 🛠️ Architecture

```text
src/
├── shared/   # Side-effect-free engine and shared types (no I/O)
├── server/   # Cloudflare Worker + Durable Objects (authoritative rooms)
└── client/   # Canvas renderer, DOM UI, reactive session state
scripts/      # Simulation, load, agent, and MCP tooling
```

The shared engine is side-effect-free. The server is authoritative and event-sourced. See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for module inventories, data flow, and the Durable Object model.

## 📚 Documentation

Each topic has one owner doc to keep decisions from drifting.

**If you're new**, read in this order:

1. [CONTRIBUTING.md](./docs/CONTRIBUTING.md) — set up, pre-commit, verify
2. [ARCHITECTURE.md](./docs/ARCHITECTURE.md) §1–2 — layer overview and the Durable Objects
3. [CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) — Core Principles section (first screen) only at this stage
4. One [pattern chapter](./patterns/README.md) that matches the area you'll touch (client / engine / protocol / testing / scenarios / types)
5. [SPEC.md](./docs/SPEC.md) if you're touching game rules; [PROTOCOL.md](./docs/PROTOCOL.md) if you're touching the wire format

Doc index by purpose:

| Doc | Purpose |
| --- | --- |
| [SPEC.md](./docs/SPEC.md) | Game rules and scenarios |
| [PROTOCOL.md](./docs/PROTOCOL.md) | Wire format, state shapes, hex math, HTTP/WS routes |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Module inventory, data flow, Durable Object design, replay/recovery |
| [CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) | Conventions and refactoring guidance |
| [patterns/](./patterns/README.md) | Design-pattern walk-through: *why* the code looks the way it does |
| [CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Contributor workflow, pre-commit, verification |
| [SECURITY.md](./docs/SECURITY.md) | Integrity, abuse controls, rate limits, data retention |
| [OBSERVABILITY.md](./docs/OBSERVABILITY.md) | Telemetry events, D1 queries, incident triage |
| [A11Y.md](./docs/A11Y.md) | DOM accessibility audit checklist |
| [PRIVACY_TECHNICAL.md](./docs/PRIVACY_TECHNICAL.md) | What the stack stores (technical, not legal) |
| [MANUAL_TEST_PLAN.md](./docs/MANUAL_TEST_PLAN.md) | Release / regression manual checks |
| [SIMULATION_TESTING.md](./docs/SIMULATION_TESTING.md) | Headless AI simulation and websocket load harness |
| [REVIEW_PLAN.md](./docs/REVIEW_PLAN.md) | Recurring cross-cutting review checklist |
| [COORDINATED_RELEASE_CHECKLIST.md](./docs/COORDINATED_RELEASE_CHECKLIST.md) | Protocol/schema version bump steps |
| [BACKLOG.md](./docs/BACKLOG.md) | Remaining actionable work, in priority order |
| [LORE.md](./docs/LORE.md) | Ship aesthetics and visual direction |
| [AGENTS.md](./docs/AGENTS.md) | Practical guide for building Delta-V agents |
| [DELTA_V_MCP.md](./docs/DELTA_V_MCP.md) | MCP tool reference and host configuration |
| [AGENT_SPEC.md](./AGENT_SPEC.md) | Deep agent protocol and design reference |

### Glossary

| Term | Meaning |
| --- | --- |
| **Room** | A game lobby identified by a 5-character code. One room can host multiple matches via rematch. |
| **Match** | A single game session within a room. Has a stable `gameId` like `ROOM1-m2`. |
| **Seat** | Slot for a player (0 or 1). Protected by a `playerToken` for reconnection. |
| **Session** | On the server: the authoritative `GameDO` instance. On the client: `ClientSession` aggregate (signals, planning, transport). |
| **Phase** | The authoritative `GameState.phase` — `fleetBuilding`, `astrogation`, `ordnance`, `combat`, `logistics`, `gameOver`. |
| **Client state** | The UI-layer `ClientState` — finer-grained (e.g. `playing_movementAnim`) derived from phase. |
| **Event** | An append-only domain fact in the match stream (`EngineEvent`) — not a DOM event. |
| **Checkpoint** | A full `GameState` snapshot saved at turn boundaries. Speeds up projection. |
| **Projection** | Reconstructing `GameState` from checkpoint + event tail. Used for reconnects, parity, replay. |
| **Agent** | Any non-browser player (script, LLM, RL) connected via MCP, bridge, or raw WebSocket. Identified with `playerKey` prefix `agent_`. |
| **Burn** | A fuel-costing course shift during astrogation (1 hex normally, 2 hex for warship overload). |
| **Overload** | A 2-fuel warship course shift, usable once between maintenance stopovers. |

## 🚀 Quick Start

1. **Use the project Node version** — `.nvmrc` pins **25** (matched by [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

   ```bash
   nvm use
   ```

2. **Install dependencies.**

   ```bash
   npm install
   ```

3. **Install Playwright's Chromium** (pre-commit and CI use it for browser smoke tests).

   ```bash
   npx playwright install chromium
   ```

4. **Local Worker overrides (first run).** Copy [`.dev.vars.example`](./.dev.vars.example) to `.dev.vars` so `DEV_MODE=1` can engage the dev agent-token placeholder when `AGENT_TOKEN_SECRET` is not set (Wrangler merges `.dev.vars` over `wrangler.toml` `[vars]`).

5. **Run the dev server.**

   ```bash
   npm run dev
   ```

6. **Play.** Open <http://localhost:8787>, create a game in tab 1, copy the room link or 5-character code, and join from tab 2.

### CLI Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start local development (Wrangler + esbuild; see `.dev.vars.example`) |
| `npm run build` | Build the client bundle |
| `npm run lint` | Biome lint + format check |
| `npm run typecheck` | Typecheck `src/` |
| `npm run typecheck:all` | Typecheck app + tooling (`scripts/`, `e2e/`, configs) |
| `npm test` | Run all unit tests via Vitest |
| `npm run test:coverage` | Run tests with coverage (enforced thresholds on `src/shared/`) |
| `npm run test:e2e` | Playwright browser smoke against a local Wrangler server |
| `npm run test:e2e:a11y` | Playwright + axe accessibility baseline |
| `npm run test:e2e:headed` | Same smoke suite with a visible browser |
| `npm run test:watch` | Vitest in watch mode |
| `npm run verify` | Pre-release sweep (lint, typecheck, coverage, build, e2e, a11y, simulation) |
| `npm run simulate -- [scenario] [iterations] [--ci]` | Headless AI-vs-AI matches |
| `npm run load:test -- --games 20 --concurrency 5` | Websocket load / chaos harness |
| `npm run deploy` | Deploy to Cloudflare Workers |

Pass simulation arguments after the npm `--`, e.g. `npm run simulate -- all 25 --ci`.

### Test Strategy

Three complementary layers keep the regression net cheap to run:

- **Vitest** — engine, protocol, client-helper, and server-logic unit / property tests. This is the main regression net.
- **Headless AI simulation** (`npm run simulate`) — scenario-wide engine stability and balance sweeps; much cheaper than the browser.
- **Playwright** — an intentionally thin browser smoke suite for boot, core multiplayer, and a11y baselines (`test:e2e` and `test:e2e:a11y`).

When deciding where a new test belongs: rules/combat/protocol assertions → Vitest; broad scenario behavior across many turns → simulation; anything that requires a real browser, multiple pages, storage, or websocket wiring → Playwright. See [SIMULATION_TESTING.md](./docs/SIMULATION_TESTING.md) for simulation detail and [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for verification flow.

## 📜 Game Rules

The canonical ruleset — movement edge cases, damage tables, scenario-specific rules — lives in [SPEC.md](./docs/SPEC.md). Open engineering work lives in [BACKLOG.md](./docs/BACKLOG.md).

## 🔗 External References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) · [Durable Objects](https://developers.cloudflare.com/durable-objects/) · [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/api/websockets/)
- [MDN Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) · [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

## 📄 License

All rights reserved.
