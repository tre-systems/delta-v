# Delta-V

Delta-V is an online turn-based multiplayer tactical space combat and racing game featuring realistic vector movement and orbital gravity mechanics across the inner Solar System.

Command your fleet, master astrogation trajectories, slingshot around celestial bodies, and engage in high-stakes combat where positioning and velocity matter as much as firepower.

## Features

Delta-V's core gameplay rests on several interlocking systems. Vector physics spaceflight means that velocity persists between turns — you burn fuel to alter your course, and gravity deflects you one turn later. Orbital mechanics let you exploit planetary gravity wells for slingshot maneuvers, while weak gravity at moons is an optional player choice.

Tactical combat uses odds-based dice resolution modified by range and relative velocity. Your arsenal can include mines, torpedoes, and nukes, though per-scenario rules govern which weapons are available.

The game ships with nine scenarios: Bi-Planetary, Escape, Lunar Evacuation, Convoy, Duel, Blockade Runner, Fleet Action, Interplanetary War, and Grand Tour. You can play against a local artificial intelligence at three difficulty levels, join an online multiplayer game via a five-character room code, jump into the quick-match queue to be paired with any waiting opponent, watch as a spectator, or connect as a machine-native agent through the agent API. A public leaderboard using Glicko-2 ratings runs as a unified ladder for humans and agents; no login is required to participate.

Under the hood, the renderer paints a smooth space view using the HTML5 Canvas API while the game engine operates on a strict axial hex grid.

## Architecture

The codebase is divided into three main areas. The shared engine is side-effect-free and contains no input or output operations. The server layer runs on Cloudflare Workers and Durable Objects, acting as the authoritative game room. The client layer handles the Canvas renderer, the DOM user interface, and reactive session state. A separate scripts area holds simulation, load testing, agent tooling, and Model Context Protocol support.

The server is authoritative and event-sourced. The architecture documentation covers module inventories, data flow, and the Durable Object model in detail.

## Documentation

Each topic has one owner document to keep decisions from drifting.

If you are new to the codebase, read in this order. Start with the contributing guide, which covers setup, pre-commit hooks, and verification. Next, read the first two sections of the architecture document for a layer overview and an introduction to Durable Objects. After that, read only the Core Principles section of the coding standards document. Then pick one pattern chapter that matches the area you will touch — options cover the client, engine, protocol, testing, scenarios, and types. Finally, consult the game specification document if you are touching game rules, or the protocol document if you are touching the wire format.

The documentation set covers the following purposes. The game specification holds the canonical game rules and scenario definitions. The protocol document covers the wire format, state shapes, hex math, and HTTP and WebSocket routes. The architecture document describes the module inventory, data flow, Durable Object design, and replay and recovery mechanisms. The coding standards document covers conventions and refactoring guidance. The patterns directory is a design-pattern walk-through explaining why the code looks the way it does. The contributing guide covers the contributor workflow, pre-commit hooks, and verification. The security document covers integrity, abuse controls, rate limits, and data retention. The observability document covers telemetry events, database queries, and incident triage. The accessibility document is a DOM accessibility audit checklist. The privacy technical document explains what the stack stores. There are also documents for the manual test plan, simulation testing, an exploratory-testing playbook for open-ended discovery passes, a recurring review checklist, a coordinated release checklist, an open backlog of prioritised work, ship aesthetics and visual direction, a practical guide for building Delta-V agents, an MCP tool reference, and a deep agent protocol and design reference.

### Compiled book editions

Both editions compile every doc in this index into a single consolidated PDF with a cover, parts-break, and table of contents. They are rebuilt with the docs-book and docs-book-audio npm scripts. The audio edition renders pre-authored TTS-friendly prose from the audio-rewritten directory; those rewrites are refreshed manually, so the audio edition can lag the main book by a few days after a documentation sweep — tracked in the backlog under "Refresh and Automate the Audio-Book Rewrites".

The main edition is a full book containing every canonical Markdown document, the visual concept boards under the docs-assets directory, and the appended 2018 Triplanetary rulebook as a single 25-megabyte PDF. It is intended for reading, printing, or archiving. The audio edition is a listener-friendly rewrite of the same content — roughly fifty-two thousand words, one hundred sixty-five pages, and 1.3 megabytes. Code blocks, tables, and file paths are replaced with plain-English prose for text-to-speech narration.

### Glossary

A Room is a game lobby identified by a five-character code. One room can host multiple matches through the rematch flow.

A Match is a single game session within a room. Each match has a stable identifier such as "ROOM1 dash m2".

A Seat is a slot for a player, numbered zero or one. It is protected by a player token that allows reconnection.

A Session means two different things depending on context. On the server it refers to the authoritative game Durable Object instance. On the client it refers to the client session aggregate, which manages signals, planning state, and transport.

A Phase is the authoritative game state's current phase. The possible phases are fleet building, astrogation, ordnance, combat, logistics, and game over.

Client State is the finer-grained UI-layer state, which includes substates such as "playing movement animation" derived from the authoritative phase.

An Event is an append-only domain fact in the match stream, called an engine event. This is not a browser DOM event.

A Checkpoint is a full game state snapshot saved at turn boundaries to speed up projection.

Projection is the process of reconstructing game state from a checkpoint plus the event tail that follows it. It is used for reconnects, parity checks, and replay.

An Agent is any non-browser player — a script, a large language model, a reinforcement learning system — connected via MCP, a bridge, or a raw WebSocket. Agents are identified by a player key prefixed with "agent underscore".

A Burn is a fuel-costing course shift during astrogation. Normally a burn shifts you by one hex; a warship overload burn shifts you by two hexes.

An Overload is a two-fuel warship course shift that can be used once between maintenance stopovers.

## Quick Start

Setting up a local development environment takes six steps.

First, switch to the Node version pinned by the project's version file — the continuous integration workflow uses the same version. Second, install the project's dependencies using the package manager. Third, install Playwright's Chromium browser, which is used by the pre-push hook and the continuous integration suite for browser smoke tests. Fourth, on first run, copy the example dev-vars file to a local dev-vars file so that dev mode can engage the dev agent-token placeholder when the agent-token secret is not set; Wrangler merges the local dev-vars file over the variables in the Wrangler configuration. Fifth, start the development server. Sixth, open a browser to the local server address, create a game in one tab, copy the room link or five-character code, and join from a second tab.

### CLI Commands

Several npm scripts are available. The dev script starts local development using the Wrangler bundler and esbuild. The build script produces the client bundle; the bundle is now minified on every build, and the baseline after minification is roughly 397 kilobytes raw and 117 kilobytes gzipped. The lint script runs Biome for linting and format checking. The typecheck script checks types in the source directory, and the typecheck-all variant also covers scripts, end-to-end tests, and configuration files.

For testing, the test script runs all unit tests using Vitest. The test coverage script runs client and server plus shared coverage passes sequentially, with enforced thresholds on the engine, the server, the MCP adapter, and the client. The end-to-end test script runs all Playwright specs against a local Wrangler server. The smoke variant runs the Playwright browser smoke without the dedicated accessibility spec. The accessibility end-to-end test script adds an axe accessibility baseline. A headed variant runs the same smoke suite with a visible browser. The watch script runs Vitest in watch mode.

For local gates, the quick verify script runs a fast gate covering lint, typecheck, and build. The full verify script runs the complete pre-release sweep covering lint, typecheck, coverage, build, end-to-end smoke, accessibility, and the simulation sweep. The simulate script runs headless AI-versus-AI matches; you pass a scenario name and iteration count as arguments. The simulate-smoke script runs a short all-scenarios smoke for local push checks. The load test script runs a WebSocket load and chaos harness; you pass the number of games and concurrency level as options. Finally, the deploy script deploys to Cloudflare Workers. Pass simulation arguments after the npm double-dash — for example, the simulate script with all scenarios, twenty-five iterations, and continuous-integration mode.

### Test Strategy

Three complementary layers keep the regression net cheap to run.

Vitest covers engine, protocol, client-helper, and server-logic unit and property tests. This is the main regression net. Headless AI simulation runs scenario-wide engine stability and balance sweeps, which is much cheaper than running a full browser. Playwright provides an intentionally thin browser smoke suite for boot, core multiplayer, and accessibility baselines.

When deciding where a new test belongs: rules, combat, and protocol assertions go in Vitest; broad scenario behavior across many turns goes in simulation; anything that requires a real browser, multiple pages, storage, or WebSocket wiring goes in Playwright. The simulation testing document covers simulation in detail, and the contributing guide covers the verification flow.

## Game Rules

The canonical ruleset — movement edge cases, damage tables, and scenario-specific rules — lives in the game specification document. Open engineering work lives in the backlog document.

## External References

The project builds on Cloudflare Workers, Durable Objects, and the WebSocket Hibernation API on the server side, and the HTML5 Canvas API and the Service Worker API on the client side. TypeScript narrowing patterns are also used extensively throughout the codebase.

## License

All rights reserved.
