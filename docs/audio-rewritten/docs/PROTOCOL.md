# Delta-V Protocol & Data Contracts

This chapter explains the wire contract of Delta-V: the HTTP routes, the room lifecycle, the WebSocket message families, the authoritative game-state shape, and the hex-grid math the engine uses.

The TypeScript source remains authoritative when prose and code disagree. In practice, the important source files are the shared protocol types, the shared domain types, and the scenario-definition types.

## Cloudflare topology

Delta-V runs on Cloudflare Workers with three Durable Object classes.

The first is the game room object. There is one instance per active room, and it owns the event stream, checkpoints, WebSocket connections, reconnect handling, alarms, and the authoritative match state.

The second is the matchmaker object. It is a singleton and owns the quick-match queue and seat pairing.

The third is the live registry object. It is also a singleton and backs the public listing of currently live matches.

Alongside the Durable Objects, the system uses D1 for telemetry and match-archive metadata, and R2 for completed match JSON.

## HTTP endpoints

The server exposes a small set of HTTP routes.

The root route serves the single-page application. The create route allocates a five-character room code, mints the creator's reconnect token, and initializes the room. Quick match has a POST route to enqueue and a GET route to poll ticket state.

The join route performs preflight join and reconnect validation. The replay route fetches a specific archived or player-authenticated replay. The WebSocket route upgrades into the room's authoritative game object.

The agent-token route mints a twenty-four-hour HMAC-signed agent token and can optionally bind that agent to a leaderboard username. The claim-name route binds a human player key to a leaderboard username. Leaderboard routes expose the public ladder and the current player's rank lookup.

The hosted Model Context Protocol route accepts stateless JSON-RPC requests. There are also routes for the public matches listing, match-history HTML, leaderboard HTML, the agent landing page, the machine-readable agent manifest, the phase-and-action playbook, a version manifest, a health probe, and the telemetry and error-reporting endpoints.

## Room lifecycle

The room lifecycle is easiest to understand as a short sequence.

First, the client posts to the create route. The Worker allocates a room code and creator token, initializes the game Durable Object, and returns the code and token.

Second, the joining client may perform an optional preflight check against the join route. That confirms the room exists and returns seat status and scenario information.

Third, clients open WebSocket connections to the room. The Durable Object tags each socket as player zero, player one, or spectator and replies with the welcome message for that identity.

Fourth, once both player seats are present, the room starts the game and broadcasts the initial authoritative game state.

Fifth, the turn loop begins. Clients send actions, the server validates them, runs the shared engine, appends authoritative events, resets timers, and broadcasts one state-bearing result message back out.

Sixth, if a player disconnects, a thirty-second grace period begins. Reconnecting with the stored player token resumes the game; failing to reconnect leads to the room's forfeit or archive path.

The key model constraint is that players are seat-based. The creator seat is token-protected immediately. The guest seat is initially claimed by room code, then becomes token-protected after the welcome flow issues the guest token.

## WebSocket protocol

All gameplay messages travel as JSON over WebSocket. Delta-V is turn-based, so the rate of messages is low compared with a real-time game.

On the client-to-server side, messages cover fleet building, astrogation, surrender, ordnance, orbital-base emplacement, combat, logistics, rematch, chat, and ping.

On the server-to-client side, messages cover welcome and spectator welcome, quick-match success, game start, movement and combat results, whole-state updates, game over, rematch pending, chat, errors, action acknowledgements or rejections, pong, and opponent connection status.

The important behavioral rule is this: every state-mutating action produces exactly one state-bearing server message. The browser replaces its local authoritative state wholesale on receipt rather than applying delta patches. A terminal game-over message follows the final state-bearing message.

For hidden-information scenarios, the server filters the authoritative state separately for each viewer before sending it.

## Game state

The game state is a single authoritative object. It carries a stable match identifier, the scenario name and rules, turn number, current phase, active player, all ships, all ordnance, pending astrogation orders, pending asteroid hazards, destroyed asteroid and base keys, the two player-state records, and the terminal outcome when one exists.

Each ship record includes identity, ownership, position, optional last movement path, velocity, fuel, ordnance mass already used as cargo, lifecycle state, control state, visibility flags, optional hidden-identity fields, pending gravity effects, and damage status.

Each player-state record includes connection and ready status, target and home bodies, controlled bases, and any scenario-specific win flags such as escape wins.

Phases are waiting, fleet building, astrogation, ordnance, logistics, combat, and game over.

## Hex math

Delta-V uses axial hex coordinates with a flat-top orientation. Each coordinate is a pair of numbers named q and r. Velocity is also expressed in axial deltas.

The shared hex module provides the core operations: hex distance, straight-line tracing across hexes, neighbor lookup, conversion between hexes and screen positions, vector addition and subtraction, and a stable string key for maps and sets.

This math underpins movement plotting, line-of-sight checks, selection, and rendering.

## Vector movement

The movement model is a coast-plus-burn system.

At the start of course resolution, the engine projects the ship forward by its current velocity. Burns then shift that prediction. Warships may overload for a second burn at additional fuel cost. The engine traces the path through gravity hexes, records any deferred gravity effects, recomputes the final path if needed, and derives the new velocity from the final destination.

The result is a movement path, a destination, and the ship's new velocity vector. Deferred gravity matters because entering a gravity field can shape the following turn even when it does not redirect the ship immediately.

## Scenario definition

A scenario definition provides the name, description, player setups, optional special rules, optional starting player, optional starting credits, and optional purchase restrictions.

Each player setup declares starting ships, target and home bodies, optional starting bases, escape-win flags, and any hidden-identity configuration.

The rules block controls the scenario-specific switches: ordnance availability, fleet-purchase restrictions, planetary defense, inspection rules, escape edge, whether combat is disabled, checkpoint bodies, shared bases, logistics rules, passenger rescue, reinforcement behavior, fleet conversion, and AI configuration overrides.

The important design point is that missing fields usually mean the feature remains enabled. Scenario variance is expressed declaratively, not through a web of special-case engine branches.

## Map data

The solar-system map is generated from TypeScript body definitions rather than loaded from a static JSON map file.

Each hex carries its coordinates, terrain classification, optional gravity data, optional base data, and optional owning body name. A build step assembles the full array of map hexes from those domain definitions before the engine uses it.

## Error model

Server error messages optionally carry a structured error code. Those codes describe timing problems, missing references, invalid inputs, authorization failures, resource limits, and state conflicts.

Not every failure becomes an error message. For example, rate-limit violations on the WebSocket side use close code ten-zero-zero-eight rather than a normal gameplay error frame.

## Further reading

Use the rules specification for gameplay rules and scenario detail, the architecture document for system layout and data flow, the security document for rate limits and abuse controls, and the agent specification for the higher-level machine-facing model built on top of this protocol.
