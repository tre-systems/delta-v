# 🚀 Delta-V

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5_Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

### [Play Now at delta-v.tre.systems](https://delta-v.tre.systems/)

<a href='https://ko-fi.com/N4N31DPNUS' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

![Delta-V Tactical Map](./screenshot.png)

**Delta-V** is an online turn-based multiplayer tactical space combat and racing game featuring realistic vector movement and orbital gravity mechanics across the inner Solar System.

Command your fleet, master astrogation trajectories, sling-shot around celestial bodies, and engage in high-stakes combat where positioning and velocity are just as crucial as firepower.

Check out our [**Ship Aesthetics & Visual Style Guide**](./docs/SPACESHIPS.md) and [**Technology & Lore Guide**](./docs/TECHNOLOGY.md) for visual direction and hard-sci-fi technology grounding.

## 📚 Documentation Guide

Use the docs by role so the same decision is not maintained in three places:

- [**SPEC.md**](./docs/SPEC.md): gameplay rules, scenario behavior, protocol shapes, state concepts, and implementation status
- [**ARCHITECTURE.md**](./docs/ARCHITECTURE.md): implementation structure, data flow, Durable Object design, replay/recovery model, and the current client reactive/session architecture
- [**CODING_STANDARDS.md**](./docs/CODING_STANDARDS.md): coding conventions, refactoring guidance, and shared implementation patterns
- [**CONTRIBUTING.md**](./docs/CONTRIBUTING.md): contributor workflow, pre-commit behavior, verification commands, and local environment gotchas
- [**MANUAL_TEST_PLAN.md**](./docs/MANUAL_TEST_PLAN.md): release/regression manual checks across gameplay, UX, and recovery flows
- [**SIMULATION_TESTING.md**](./docs/SIMULATION_TESTING.md): headless AI simulation, websocket load/chaos testing, and the agent bridge
- [**SECURITY.md**](./docs/SECURITY.md): competitive integrity, abuse/cost controls, deployment hardening, and retention/security posture
- [**OBSERVABILITY.md**](./docs/OBSERVABILITY.md): runtime signals, D1 queries, and incident triage
- [**A11Y.md**](./docs/A11Y.md): DOM accessibility audit checklist and manual process
- [**PRIVACY_TECHNICAL.md**](./docs/PRIVACY_TECHNICAL.md): technical storage behavior only; not user-facing policy text
- [**BACKLOG.md**](./docs/BACKLOG.md): remaining actionable work only, in one global priority order
- [**REVIEW_PLAN.md**](./docs/REVIEW_PLAN.md): recurring cross-cutting review cadence; concrete follow-up work belongs in the backlog
- [**GAME_BUILD_PLAYBOOK.md**](./docs/GAME_BUILD_PLAYBOOK.md): generic playbook for building a similar game; not the live Delta-V source of truth
- [**SPACESHIPS.md**](./docs/SPACESHIPS.md) and [**TECHNOLOGY.md**](./docs/TECHNOLOGY.md): visual direction and hard-sci-fi reference material

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

- **9 Playable Scenarios**: _Bi-Planetary_, _Escape_, _Lunar Evacuation_, _Convoy_, _Duel_, _Blockade Runner_, _Fleet Action_, _Interplanetary War_, and _Grand Tour_.
- **Local AI Opponent**: Test your skills offline against an AI component with configurable difficulty levels.
- **Online Multiplayer**: WebSocket-based remote play with tokenized reconnects and spectator support.

---

## 🛠️ Architecture

Delta-V has three runtime layers:

```text
src/
├── shared/   # Side-effect-free game engine and shared types
├── server/   # Cloudflare Worker + Durable Object authority
├── client/   # Session orchestration, Canvas renderer, DOM UI
└── scripts/  # Simulation, load, and agent tooling
```

The shared engine is side-effect-free. The server is authoritative and event-sourced. The client uses reactive session/UI state where it removes duplicate mirrors or imperative fan-out, while input, transport, and transient presentation events stay explicit.

For module inventory, diagrams, dependency maps, and the full client/server data flow, see [**ARCHITECTURE.md**](./docs/ARCHITECTURE.md).

For project conventions and refactoring guidance, see [**CODING_STANDARDS.md**](./docs/CODING_STANDARDS.md).

---

## 🚀 Quick Start

Get your thrusters firing locally in seconds:

1. **Use the Project Node Version**

   ```bash
   nvm use
   ```

   Uses [`.nvmrc`](./.nvmrc) (**25**); CI matches `.github/workflows/ci.yml`.

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Install Playwright's Chromium Browser**

   ```bash
   npx playwright install chromium
   ```

   _Required for the browser smoke tests that now run in pre-commit and CI._

4. **Start the Local Development Server**

   ```bash
   npm run dev
   ```

   _This starts the Wrangler server._

5. **Play the Game**
   - Open your browser to `http://localhost:8787`
   - Open a **second tab** or window to the same URL.
   - Create a game in tab 1, then join from tab 2 using the copied room link or the 5-character room code.

### CLI Commands

| Command                                              | Description                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`                                        | Start local development server (Wrangler/esbuild)                                            |
| `npm run build`                                      | Build the client bundle                                                                      |
| `npm run lint`                                       | Run Biome lint + format check on `src/`, `scripts/`, `e2e/`, and config files                |
| `npm run typecheck`                                  | Typecheck application code (`src/` via `tsconfig.json`)                                      |
| `npm run typecheck:all`                              | Typecheck app + tooling (`scripts/`, `e2e/`, root TS configs via `tsconfig.tools.json`)      |
| `npm test`                                           | Run all unit tests via Vitest                                                                |
| `npm run test:coverage`                              | Run tests with a coverage report under `coverage/`                                           |
| `npm run test:e2e`                                   | Run Playwright browser smoke tests against a local Wrangler server                           |
| `npm run test:e2e:headed`                            | Run the same Playwright suite with a visible browser                                         |
| `npm run test:watch`                                 | Run Vitest in continuous watch mode                                                          |
| `npm run verify`                                     | Pre-release sweep: lint, `typecheck:all`, coverage, build, e2e smoke, a11y e2e, and AI simulations |
| `npm run simulate -- [scenario] [iterations] [--ci]` | Run headless AI vs AI matches to test engine stability and scenario balance                  |
| `npm run load:test -- --games 20 --concurrency 5`    | Run the websocket load / chaos harness against a Wrangler or deployed server                 |
| `npm run deploy`                                     | Deploy straight to Cloudflare Workers                                                        |

Pass simulation arguments after npm's `--`, for example `npm run simulate -- all 25 -- --ci`.

### Test Strategy

Delta-V uses three complementary automated test layers:

- **Vitest** is the main regression net. Keep engine, protocol, client helper, and server logic covered with direct unit / property tests close to the source.
- **AI simulation** (`npm run simulate`) covers scenario-wide engine stability and balance much more cheaply than browser automation.
- **Playwright** stays intentionally small and fast. It is a **browser smoke suite**, not a full scenario matrix. Use it for a few end-to-end contracts that only a real browser can prove, such as booting the app, starting a match, basic multiplayer join/chat/reconnect, and other thin UI integration checks.
- **Playwright + axe** (`npm run test:e2e:a11y`) provides a focused DOM accessibility baseline for menu/lobby/HUD/help and keyboard focus behavior.

When deciding where a new test belongs:

- If the assertion is about rules, combat, movement, scenario logic, or protocol validation, prefer Vitest.
- If the assertion is about broad scenario behavior over many turns, prefer headless simulation.
- If the assertion requires a real browser, multiple pages, storage, layout, or websocket wiring, consider Playwright.

Keep Playwright additions focused on browser-only risks so the suite remains fast and easy to maintain.

---

## 📜 Game Rules Reference

For the comprehensive ruleset detailing movement edge cases, damage tables, and specific scenario rules, refer to [SPEC.md](./docs/SPEC.md).

## 🗺️ Roadmap

Open work lives in [**BACKLOG.md**](./docs/BACKLOG.md). This section is shipped-history context only.

### Complete

- [x] 9 playable scenarios with AI opponent (Easy/Normal/Hard)
- [x] Server hardening (authoritative room creation, authenticated reconnects, runtime validation)
- [x] Hidden information (server-side state filtering for _Escape_)
- [x] Orbital bases, core logistics, reinforcements, fleet conversion
- [x] PWA support (installable, offline single-player)
- [x] Engine safety (clone-on-entry, server rollback, event-sourced recovery)
- [x] Error reporting and anonymous telemetry (D1 storage)
- [x] 1,500+ automated tests across engine, client, and server layers, plus browser smoke coverage and scenario AI simulations
- [x] Engine decomposition into focused phase processors (game-creation, astrogation, resolve-movement, combat, etc.)
- [x] Typed ship lifecycle/control state models that narrow invalid state combinations
- [x] Granular engine events (32 `EngineEvent` types emitted by engine, replacing server-side derivation)
- [x] Data-driven AI configuration (per-difficulty scoring weights in `ai-config.ts`)
- [x] AI scoring decomposition (5 composable strategy functions in `ai-scoring.ts`)
- [x] Archive persistence extracted from Durable Object into standalone module
- [x] Event-sourced authoritative match persistence with replay/reconnect recovery from event stream plus checkpoints
- [x] Shared rule consolidation, bounded type imports, authoritative disconnect-forfeit

### Shipped

- [x] **Passenger Rescue Mechanics**: Passengers, transfers, Convoy + Evacuation scenarios
- [x] **All 9 Scenarios**: Bi-Planetary through Grand Tour

## 🔗 External References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) and [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [MDN Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) and [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [web.dev Learn PWA](https://web.dev/learn/pwa/)
- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)


---

## 📄 License

All rights reserved.
