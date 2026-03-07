# Delta-V: Delta-V Online

An online multiplayer implementation of the Delta-V board game — space combat with vector movement and gravity in the inner Solar System.

## Overview

Delta-V is a turn-based strategy game where ships move using realistic vector physics on a hex grid. Ships maintain velocity between turns, can burn fuel to accelerate, and are affected by planetary gravity. Combat uses dice-based resolution with modifiers for range and relative velocity.

This implementation renders the game as a smooth, continuous-space experience — no visible hex grid — while using hex coordinates internally for all game logic. Ships animate along their vectors with thrust and gravity effects.

## Architecture

Following the patterns established in Pongo, the stack is:

```
lobby-worker/          Cloudflare Worker — HTTP routing, game creation, invite codes
  ├── src/             Worker source (TypeScript)
  ├── index.html       Single-page app shell
  ├── style.css        Styles
  └── client.ts        Client-side game logic, rendering, WebSocket handling

game-do/               Cloudflare Durable Object — authoritative game state per match
  └── src/             DO source (TypeScript)

shared/                Shared types, constants, hex math, game rules
  └── src/
      ├── types.ts     Ship types, game state, messages
      ├── hex.ts       Hex coordinate math (axial coordinates)
      ├── movement.ts  Vector movement, gravity, course prediction
      ├── combat.ts    Gun combat, ordnance, damage tables
      └── rules.ts     Game constants, ship stats, scenario definitions
```

**Why TypeScript instead of Rust/WASM:** The game is turn-based with no real-time simulation loop needed on the server. TypeScript runs natively on Cloudflare Workers and simplifies the stack considerably. Canvas rendering on the client is more than sufficient for animating ship movements between turns.

### Cloudflare Components

**Worker (lobby-worker):**
- `GET /` — Serves the SPA (index.html + bundled JS/CSS)
- `POST /create` — Generates a 5-character alphanumeric invite code, creates/retrieves the Durable Object by name
- `GET /join/:code` — Validates code exists
- `GET /ws/:code` — WebSocket upgrade, proxied to the Durable Object

**Durable Object (game-do):**
- One instance per active game, keyed by invite code
- Maintains authoritative game state: map, ships, turn order, phase
- Receives player actions via WebSocket, validates against rules, applies state changes
- Broadcasts updated state to all connected players
- Uses DO alarms for idle timeout / cleanup (e.g., 30 min inactivity)
- Persists game state to DO storage so games survive DO evictions

### Invite / Join Flow (No Lobby, No Login)

Identical pattern to Pongo:

1. Player 1 clicks "Create Game" → `POST /create` → receives 5-char code (e.g., `K7M2X`)
2. UI shows the code prominently + a shareable link (`https://delta-v.example.com/?code=K7M2X`)
3. Player 1 can copy link or share via native Share API
4. Player 2 receives link or manually enters code
5. If URL has `?code=` param, auto-join on page load (no extra click)
6. Both players connect via WebSocket to `/ws/K7M2X` → same DO instance
7. When both players are connected, the game setup phase begins

Players are identified only by their position in the game (Player 1 / Player 2). No accounts, no persistent identity.

## Game Concepts

### Hex Grid (Internal Only)

The game uses **axial hex coordinates** (q, r) internally. The hex grid is approximately 40 columns wide and 55 rows tall (matching the physical Delta-V map). The client renders hex centers as pixel positions but does **not** draw hex borders.

When a player is planning movement, subtle dot markers or a faint radial guide may appear to indicate valid destination hexes — but no full grid is drawn.

**Coordinate system:**
- Axial coordinates (q, r) with cube coordinate conversion for distance/pathfinding
- Flat-top hex orientation
- Hex size calibrated so the full solar system map fits comfortably in the viewport

### Solar System Map

The map represents the inner Solar System along the ecliptic plane:

**Celestial Bodies (with gravity hexes):**
- **Sol** (Sun) — center of map, large body, multiple gravity hexes, any contact = destruction
- **Mercury** — small, 2 bases, gravity hexes
- **Venus** — medium, bases on all 6 sides, gravity hexes
- **Terra** (Earth) — medium, 2 bases, gravity hexes
  - **Luna** — small satellite, weak gravity (hollow arrows), 1 base
- **Mars** — medium, 2 bases, gravity hexes
  - Has two tiny moons (no gameplay effect in basic scenarios)
- **Jupiter** — large, off-map or map edge, gravity hexes
  - **Io** — satellite, weak gravity, 1 base
  - **Callisto** — satellite, weak gravity, 1 base
  - **Ganymede** — satellite, no base in basic scenarios
- **Ceres** — asteroid, 1 base
- **Asteroid Belt** — scattered asteroid hexes between Mars and Jupiter

**Gravity types:**
- **Full gravity** (solid arrows on original map): mandatory 1-hex deflection toward the body for any object passing through
- **Weak gravity** (Luna, Io — hollow arrows): player may choose to use or ignore when passing through a single weak gravity hex. Two consecutive weak gravity hexes = full gravity effect on the second.

**The map data is defined as a static JSON structure** listing every hex with its terrain type (empty, gravity, asteroid, planet surface, base).

### Vector Movement

The core mechanic. Each ship has a **velocity vector** — a displacement from its current hex to its destination hex, repeated each turn.

**How it works each turn:**

1. **Predict course:** The game shows where each ship will end up if it doesn't accelerate (current position + velocity vector = predicted destination)
2. **Burn fuel (optional):** The player may spend 1 fuel point to shift the predicted destination by 1 hex in any of the 6 hex directions. This changes both the destination AND the velocity vector for future turns. (Warships may do an "overload maneuver" spending 2 fuel for a 2-hex shift.)
3. **Apply gravity:** As the ship's course passes through gravity hexes, each gravity hex deflects the endpoint by 1 hex toward the gravity source. Gravity is cumulative and mandatory (except weak gravity — see above).
4. **Move:** The ship travels from its current position to its final destination along a straight line.

**The velocity vector persists between turns.** A ship moving from A→B will, next turn, continue from B→C (where C is the same displacement as A→B) unless thrust or gravity modifies it.

**Stationary ships** have a zero vector (no arrow). They remain in place until they burn fuel.

### Turn Structure

Each game turn consists of one player-turn per player. A player-turn has 5 phases:

```
1. ASTROGATION PHASE
   - Review predicted courses for all your ships
   - Decide fuel burns (acceleration) for each ship
   - Decide overload maneuvers (if applicable)
   - Confirm all movement orders

2. ORDNANCE PHASE
   - Launch mines, torpedoes, or nukes from eligible ships
   - Each ship may launch only 1 item per turn
   - Ordnance cannot be launched while at a base or during resupply

3. MOVEMENT PHASE (automated)
   - All ships move along their plotted courses simultaneously
   - Mines/torpedoes/nukes also move
   - Gravity effects are applied
   - Crash detection (ship intersects planet/sun outline)
   - Asteroid hazard rolls
   - Ramming resolution
   - Ordnance detonation on contact

4. COMBAT PHASE
   - Phasing player's ships may attack enemy ships in range
   - Defender may counterattack
   - Planetary base defense fire
   - Die rolls with modifiers for range and relative velocity

5. RESUPPLY PHASE
   - Ships at friendly bases: refuel, repair, reload ordnance
   - Load/unload cargo
   - Maintenance (repairs all damage, allows 1 overload maneuver)
```

After both players complete their turns, a new game turn begins.

### Ships

Nine ship types plus orbital bases:

| Ship Type   | Combat | Fuel | Cargo | Notes |
|-------------|--------|------|-------|-------|
| Transport   | 1D     | 10   | 50    | Basic cargo hauler, defensive only |
| Packet      | 2      | 10   | 50    | Armed transport |
| Tanker      | 1D     | 50   | 0     | Fuel carrier, defensive only |
| Liner       | 2D     | 10   | 0     | Passenger ship, defensive only |
| Corvette    | 2      | 20   | 5     | Smallest warship |
| Corsair     | 4      | 20   | 10    | Flexible mid-size warship |
| Frigate     | 8      | 20   | 40    | Large warship |
| Dreadnaught | 15     | 15   | 50    | Huge warship, less fuel |
| Torch       | 8      | ∞    | 10    | Unlimited fuel, frigate guns |
| Orbital Base| 16     | ∞    | ∞     | Stationary, resupply point |

**"D" suffix** on combat strength means defensive only (cannot initiate attacks, only counterattack).

Each ship has:
- Current hex position (q, r)
- Velocity vector (dq, dr) — the hex displacement per turn
- Fuel remaining
- Cargo manifest (items + mass)
- Damage status (disabled turns remaining, or eliminated)
- Owner (player index)

### Combat System

**Gun combat** (the standard combat system for first implementation):

1. Attacker declares target(s)
2. Compute **combat odds**: attacker strength / defender strength, reduced to standard ratios (1:4, 1:2, 1:1, 2:1, 3:1, 4:1)
3. Apply **range modifier**: subtract 1 from die roll per hex of range (measured from attacker's closest approach to target's final position)
4. Apply **relative velocity modifier**: subtract 1 from die roll per hex of velocity difference > 2
5. Roll 1d6, consult Gun Combat Damage table
6. Results: – (no effect), D1–D5 (disabled 1–5 turns), E (eliminated)
7. Defender may counterattack (recompute odds from defender's perspective)

**Damage:**
- Disabled ships cannot maneuver, attack, or launch ordnance — they drift on current vector
- Damage is cumulative: if total disabled turns ≥ 6, ship is eliminated
- Ships recover 1 disabled turn per game turn (at resupply phase)
- Reaching a friendly base immediately repairs all damage

**Other damage sources:**
| Source    | Mechanic |
|-----------|---------|
| Torpedoes | Roll on Other Damage table, hits single target |
| Mines     | Roll on Other Damage table, affects all ships in hex |
| Asteroids | Roll on Other Damage table per asteroid hex entered at speed > 1 |
| Ramming   | Roll on Other Damage table, affects both ships |
| Nukes     | Roll on Gun Combat table at 2:1 odds (with range/velocity mods) |

### Ordnance

- **Mines** (mass 10): launched with ship's vector, drift for 5 turns then self-destruct. Detonate on contact with any ship/ordnance in their hex.
- **Torpedoes** (mass 20): like mines but with terminal guidance — on launch turn, accelerate 1-2 hexes in any direction. Hit single target. Warships only.
- **Nukes** (mass 20): devastating area weapons. Detonate on contact with anything. Destroy asteroid hexes, devastate planet hex sides. Scenario-specific availability.

### Gravity and Orbits

Gravity is the key environmental mechanic:
- Each gravity hex has a direction arrow pointing toward the parent body
- Any object passing through a gravity hex has its endpoint shifted 1 hex in the arrow's direction
- This happens **after** the object enters the gravity hex (i.e., on the turn after entry)
- Gravity is cumulative: passing through 3 gravity hexes = 3 hex shifts
- **Orbit** emerges naturally: a ship moving at 1 hex/turn through gravity hexes adjacent to a body will naturally orbit it (no special rules needed)
- Landing requires expending fuel to cancel velocity, entering orbit first

### Landing, Takeoff, and Bases

- **Landing:** Ship lands at a base by stopping on the planet's hex side that contains the base
- **Takeoff:** Free! Boosters provide 1 hex of acceleration away from the planet. Gravity cancels this, leaving the ship stationary in the gravity hex above the base. Must then burn fuel to leave orbit.
- **Bases provide:** refueling, full repair, ordnance resupply, cargo transfer, planetary defense fire
- **Planetary defense:** Bases fire at 2:1 odds against enemy ships in the gravity hex directly above, during the combat phase. No range/velocity modifiers.

### Detection

Ships and bases have detectors:
- **Ship/orbital base detectors:** 3 hex range
- **Planetary base detectors:** 5 hex range (printed on map)
- Once detected, a ship remains detected until it reaches a friendly base

Detection matters primarily in scenarios with hidden movement (Piracy, Lateral 7). For the initial Bi-Planetary scenario, all ships are visible.

## Scenarios (Implementation Priority)

### Phase 1: Bi-Planetary (Learning Scenario)

The simplest scenario — perfect for initial implementation.

- **Players:** 2
- **Setup:** Player 1 starts with a corvette on Mars. Player 2 starts with a corvette on Venus.
- **Goal:** Navigate to the other player's starting world and land. First to do it wins. Fewest turns breaks ties.
- **Map subset:** Can use the full map or a trimmed version focusing on Mars–Venus corridor
- **No combat needed** (though ships may encounter each other)
- **Teaches:** Vector movement, fuel management, gravity assists, orbital mechanics

### Phase 2: Escape (Short 2-Player)

Asymmetric scenario with combat:
- Pilgrims (3 transports from Terra) vs. Enforcers (1 corvette orbiting Terra, 1 corsair orbiting Venus)
- Pilgrims must escape the solar system; Enforcers must stop them
- Introduces combat, hidden ship identity (which transport carries the fugitives?)

### Phase 3: Interplanetary War (Full 2-Player)

The full experience:
- Fleet building with MegaCredits budget
- Multiple ship types, ordnance, bases
- Economic + military objectives
- Full map with all celestial bodies

## Rendering

### Visual Style

- **Dark space background** with subtle star field
- **No hex grid lines** — space is rendered as continuous
- **Celestial bodies** rendered as stylized circles/spheres with appropriate colors and relative sizes
- **Gravity wells** visualized as subtle radial gradients or faint concentric rings around planets (not hex-shaped)
- **Ships** rendered as small directional icons/sprites with team colors
- **Velocity vectors** shown as arrows from ship's current position through to predicted next-turn position
- **Fuel burns** shown as a bright thrust indicator at the base of the vector

### Animations

Since the game is turn-based, animations play during the Movement Phase to show what happened:

1. **Course planning (interactive):**
   - Player drags/clicks to set fuel burns
   - Predicted course updates in real-time with a dotted line
   - Ghost ship appears at predicted destination
   - Gravity deflections shown as subtle bends in the predicted path

2. **Movement animation (after both players confirm):**
   - Ships glide smoothly along their course vectors over ~2 seconds
   - Thrust burns shown as engine glow / particle trail at the ship
   - Gravity deflections shown as a smooth curve (not a sharp bend) — the straight-line hex path is interpolated into a gentle arc for visual appeal
   - Ordnance (torpedoes, mines) also animate along their paths
   - Collisions / detonations trigger explosion effects

3. **Combat animation:**
   - Attacking ship flashes / highlights
   - Beam/projectile line drawn from attacker to target
   - Die roll displayed briefly
   - Damage result shown (shield flash for miss, red flash + damage number for hit, explosion for eliminated)

4. **Orbit visualization:**
   - Ships in orbit shown with a subtle circular path indicator
   - Smooth orbital motion if orbiting between turns

### Camera / Viewport

- **Pannable and zoomable** map (touch + mouse + scroll wheel)
- **Zoom range:** from full solar system overview to close-up on individual ships
- **Auto-frame:** camera smoothly pans to show relevant action during animations
- **Minimap** (optional) in corner showing full map with ship positions highlighted

### Canvas Rendering

Use HTML5 Canvas 2D for rendering:
- Layered rendering: background stars → gravity well indicators → celestial bodies → course arrows → ships → UI overlays
- Ship icons as pre-rendered sprites or simple geometric shapes
- Smooth interpolation (requestAnimationFrame) for all animations
- Touch-friendly: large tap targets for ships, pinch-to-zoom

## Client-Side State Machine

```
MENU
  ├── CREATE_GAME → WAITING_FOR_OPPONENT
  └── JOIN_GAME  → CONNECTING
                      └── WAITING_FOR_OPPONENT

WAITING_FOR_OPPONENT → SETUP (when both players connected)

SETUP → PLAYING (scenario-specific setup complete)

PLAYING (repeating cycle):
  ├── MY_TURN
  │   ├── ASTROGATION    (planning movement for all ships)
  │   ├── ORDNANCE       (choosing ordnance launches)
  │   ├── MOVEMENT_ANIM  (watching movement resolve)
  │   ├── COMBAT         (choosing attacks, seeing results)
  │   └── RESUPPLY       (managing bases)
  └── OPPONENT_TURN
      └── WAITING        (opponent is planning)
      └── MOVEMENT_ANIM  (watching opponent's turn resolve)
      └── COMBAT_ANIM    (seeing opponent's combat results)

PLAYING → GAME_OVER (victory/defeat condition met)

GAME_OVER
  ├── REMATCH → SETUP
  └── EXIT → MENU
```

## Network Protocol

Binary messages using a simple serialization format (MessagePack or a custom binary protocol). Since the game is turn-based, message frequency is low — JSON would also work fine. Prefer JSON for simplicity unless message size becomes an issue.

### Client → Server (C2S)

```typescript
type C2S =
  | { type: 'join'; code: string }
  | { type: 'ready' }                                    // Player ready after setup
  | { type: 'astrogation'; orders: AstrogationOrder[] }  // Movement orders for all ships
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }     // Ordnance launches
  | { type: 'combat'; attacks: CombatAttack[] }          // Attack declarations
  | { type: 'resupply'; actions: ResupplyAction[] }      // Base resupply actions
  | { type: 'endPhase' }                                 // Confirm end of current phase
  | { type: 'rematch' }                                  // Request rematch
  | { type: 'ping'; t: number }                          // Latency measurement

interface AstrogationOrder {
  shipId: string
  burn: HexDirection | null    // null = no burn, otherwise one of 6 directions
  overload: HexDirection | null // second burn direction (warships only, costs 2 fuel)
}

interface OrdnanceLaunch {
  shipId: string
  ordnanceType: 'mine' | 'torpedo' | 'nuke'
  // Torpedoes need initial acceleration direction(s)
  torpedoAccel?: HexDirection[]
}

interface CombatAttack {
  attackerIds: string[]   // Can be multiple ships attacking together
  targetId: string
  strength?: number       // Optional: limited attack (less than full strength)
}

interface ResupplyAction {
  shipId: string
  action: 'refuel' | 'repair' | 'loadOrdnance' | 'loadCargo' | 'unloadCargo'
  item?: string
  quantity?: number
}
```

### Server → Client (S2C)

```typescript
type S2C =
  | { type: 'welcome'; playerId: number }
  | { type: 'matchFound' }
  | { type: 'gameSetup'; scenario: ScenarioConfig; initialState: GameState }
  | { type: 'phaseStart'; phase: Phase; activePlayer: number }
  | { type: 'movementResult'; movements: ShipMovement[]; events: MovementEvent[] }
  | { type: 'combatResult'; combats: CombatResolution[] }
  | { type: 'stateUpdate'; state: GameState }            // Full state sync
  | { type: 'gameOver'; winner: number; reason: string }
  | { type: 'opponentDisconnected' }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number }

interface ShipMovement {
  shipId: string
  from: HexCoord
  to: HexCoord
  path: HexCoord[]          // Intermediate hexes for animation
  gravityDeflections: GravityDeflection[]
  thrustBurn: HexDirection | null
}

interface MovementEvent {
  type: 'crash' | 'asteroidHit' | 'ram' | 'mineDetonation' | 'torpedoHit' | 'nukeDetonation'
  location: HexCoord
  affectedShips: string[]
  dieRoll: number
  result: DamageResult
}

interface CombatResolution {
  attackerIds: string[]
  targetId: string
  odds: string              // e.g., "2:1"
  rangeMod: number
  velocityMod: number
  dieRoll: number
  modifiedRoll: number
  result: DamageResult
  counterattack?: CombatResolution
}
```

## Game State

The authoritative state held by the Durable Object:

```typescript
interface GameState {
  // Game metadata
  gameId: string
  scenario: string
  turnNumber: number
  currentPhase: Phase
  activePlayer: number         // Which player is currently acting

  // Map (static after setup, but nukes can modify asteroids)
  map: MapData

  // Dynamic state
  ships: Ship[]
  ordnance: Ordnance[]         // Active mines, torpedoes, nukes in flight
  players: PlayerState[]

  // History (for undo/replay)
  turnLog: TurnLogEntry[]
}

interface Ship {
  id: string
  type: ShipType
  owner: number
  position: HexCoord
  velocity: HexVec            // (dq, dr) displacement per turn
  fuel: number
  cargo: CargoItem[]
  damage: {
    disabledTurns: number     // 0 = operational, ≥6 = eliminated
  }
  flags: {
    inOrbit: boolean
    landed: boolean
    heroic: boolean
    captured: boolean
    hasScanners: boolean
  }
}

interface Ordnance {
  id: string
  type: 'mine' | 'torpedo' | 'nuke'
  owner: number
  position: HexCoord
  velocity: HexVec
  turnsRemaining: number      // Self-destruct countdown (mines: 5, torpedoes: 5)
}

interface PlayerState {
  connected: boolean
  ready: boolean
  credits: number             // MegaCredits (scenario-dependent)
  // Scenario-specific state (e.g., cargo delivery tracking for Piracy)
}

type Phase = 'setup' | 'astrogation' | 'ordnance' | 'movement' | 'combat' | 'resupply'
```

## Hex Math

Using **axial coordinates** (q, r) with the standard hex math library approach:

```typescript
interface HexCoord {
  q: number
  r: number
}

// The 6 hex directions (flat-top orientation)
const HEX_DIRECTIONS: HexVec[] = [
  { dq: +1, dr:  0 },  // E
  { dq: +1, dr: -1 },  // NE
  { dq:  0, dr: -1 },  // NW
  { dq: -1, dr:  0 },  // W
  { dq: -1, dr: +1 },  // SW
  { dq:  0, dr: +1 },  // SE
]

// Key operations needed:
// - hexDistance(a, b): number of hexes between two points
// - hexLineDraw(a, b): all hexes along a straight line (for course plotting, LOS)
// - hexNeighbors(h): 6 adjacent hexes
// - hexToPixel(h): convert hex coord to screen position
// - pixelToHex(x, y): convert screen tap/click to nearest hex
// - hexAdd(h, v): add a vector to a position
// - hexSubtract(a, b): compute vector from a to b
```

### Vector Movement Algorithm

```
function computeCourse(ship, burn, map):
  // 1. Start with predicted destination (current position + velocity)
  predicted = hexAdd(ship.position, ship.velocity)

  // 2. Apply fuel burn (if any)
  if burn:
    predicted = hexAdd(predicted, burn.direction)
    // For overload: predicted = hexAdd(predicted, burn.direction2)

  // 3. Trace path from current position to predicted destination
  path = hexLineDraw(ship.position, predicted)

  // 4. Apply gravity for each gravity hex in the path
  for each hex in path:
    if map.isGravityHex(hex):
      gravityDir = map.getGravityDirection(hex)
      if map.isWeakGravity(hex) and isFirstWeakGravity:
        // Player chooses whether to use it
        if playerChoosesToIgnore: continue
      predicted = hexAdd(predicted, gravityDir)

  // 5. Recompute path with gravity-modified destination
  finalPath = hexLineDraw(ship.position, predicted)

  // 6. New velocity = predicted - ship.position
  newVelocity = hexSubtract(predicted, ship.position)

  return { destination: predicted, path: finalPath, newVelocity }
```

Note: Gravity application is more nuanced than shown — gravity applies on the turn *after* entering the gravity hex. The implementation must track which gravity hexes were entered on the previous turn to apply deferred effects correctly.

## UI / Interaction Design

### Astrogation Phase (Main Interaction)

This is where players spend most of their time:

1. **Ship Selection:** Tap/click a ship to select it. Selected ship highlights with a glow effect.

2. **Course Prediction Display:** A dashed arrow shows the predicted course (position + velocity) before any burns. A ghost ship icon appears at the predicted destination.

3. **Burn Input:** The player can:
   - **Click a direction button** (6 directional arrows shown around the predicted destination), or
   - **Drag the ghost ship** to an adjacent hex of the predicted destination (snaps to valid positions)
   - The course arrow updates in real-time, curving through any gravity wells
   - Fuel cost is shown (1 for normal, 2 for overload)
   - Invalid burns (no fuel, commercial ship trying overload) are grayed out

4. **Confirm / Undo:** After setting burns for all ships, player confirms. An undo button lets them reset any individual ship's burn before confirming.

5. **Multi-ship management:** A ship list panel shows all owned ships with status icons. Tap a ship in the list to select it and pan the camera to it.

### Combat Phase Interaction

1. Eligible attackers are highlighted
2. Tap an attacker, then tap a target within range
3. UI shows computed odds, range modifier, velocity modifier, and expected outcome distribution
4. Confirm attack → server rolls dice → animated result

### Information Display

- **Ship info panel:** tap a ship to see its stats (fuel, cargo, damage, velocity)
- **Turn indicator:** clear display of whose turn it is and current phase
- **Turn history:** scrollable log of what happened (moves, combat results, etc.)
- **Fuel indicator:** prominent fuel gauge for the selected ship

## Map Data Format

The map is defined as a JSON structure. Each hex can have multiple properties:

```typescript
interface MapHex {
  q: number
  r: number
  terrain: 'space' | 'asteroid' | 'planetSurface' | 'sunSurface'
  gravity?: {
    direction: HexDirection
    type: 'full' | 'weak'
    body: string              // Which body this gravity belongs to
  }
  base?: {
    owner: string             // 'neutral' or player faction
    type: 'planetary' | 'asteroid' | 'orbital'
  }
  body?: {
    name: string              // 'Sol', 'Venus', 'Terra', etc.
    // The actual body image is rendered separately; this marks hexes covered by the body
  }
}
```

The full Delta-V map has approximately 1,500–2,000 hexes. The map definition will be authored by hand (referencing the original board) and stored as a static asset.

## Scenarios System

Scenarios are defined as configuration objects:

```typescript
interface ScenarioConfig {
  name: string
  description: string
  playerCount: number
  mapBounds?: { minQ, maxQ, minR, maxR }  // Optional map subset
  players: ScenarioPlayer[]
  victoryConditions: VictoryCondition[]
  specialRules: string[]
  availableShipTypes?: ShipType[]          // Restricts purchasable ships
  nuclesAvailable: boolean
  startingCredits?: number[]               // Per player
}

interface ScenarioPlayer {
  name: string                             // e.g., "Mars", "Venus"
  startingShips: {
    type: ShipType
    position: HexCoord
    velocity?: HexVec                      // Default: stationary
    fuel?: number                          // Default: full
    cargo?: CargoItem[]
  }[]
  bases: HexCoord[]                        // Which bases this player controls
}
```

## Implementation Plan

### Milestone 1: Core Engine + Bi-Planetary

**Goal:** Two players can play the Bi-Planetary learning scenario end-to-end.

- [ ] Project setup (Wrangler, TypeScript, bundling)
- [ ] Hex math library (coordinates, distance, line drawing, pixel conversion)
- [ ] Map data: define a subset of the Delta-V map (Mars–Venus corridor)
- [ ] Canvas renderer: stars background, celestial bodies, gravity indicators
- [ ] Ship rendering with directional icons and velocity arrows
- [ ] Vector movement engine with gravity
- [ ] Course planning UI (select ship, set burn, see prediction, confirm)
- [ ] Movement animation (smooth ship glide with thrust trail)
- [ ] Durable Object: game state management, turn sequencing
- [ ] Worker: invite code creation, WebSocket routing
- [ ] Client WebSocket: state sync, turn submission
- [ ] Victory detection (first to land on opponent's world)
- [ ] Basic mobile-responsive touch controls

### Milestone 2: Combat + Escape Scenario

- [ ] Gun combat system (odds computation, die rolling, damage tables)
- [ ] Combat UI (select attacker/target, show odds, animate results)
- [ ] Damage tracking and recovery
- [ ] Counterattack logic
- [ ] Ordnance system (mines, torpedoes)
- [ ] Ordnance movement and detonation
- [ ] Escape scenario implementation
- [ ] Ship identity concealment (Escape scenario: which transport has the fugitives?)

### Milestone 3: Full Map + Interplanetary War

- [ ] Complete solar system map (all planets, moons, asteroid belt)
- [ ] MegaCredit economy and ship purchasing
- [ ] Fleet building UI
- [ ] Full ship roster (all 9 types + orbital bases)
- [ ] Base mechanics (planetary defense, resupply, landing/takeoff)
- [ ] Orbit mechanics
- [ ] Advanced features: looting, capture, surrender, heroism
- [ ] Nukes
- [ ] Detection / fog of war
- [ ] Minimap for full solar system navigation

### Milestone 4: Polish

- [ ] Sound effects (thrust, explosions, ambient space)
- [ ] Improved animations (particle effects for thrust, gravity lensing)
- [ ] Turn history replay
- [ ] Spectator mode
- [ ] Game state persistence (resume interrupted games)
- [ ] Reconnection handling
- [ ] Performance optimization for mobile
- [ ] PWA support (installable, offline-capable menu)

## Open Questions

1. **Map authoring:** The original hex map needs to be digitized into our coordinate system. Should we trace the original map image as a reference layer, or build from astronomical data?

2. **Simultaneous vs. alternating turns:** The board game alternates player turns. Should we offer a simultaneous-movement variant for online play (both players submit orders, then all ships move at once)? This would reduce waiting time but changes game dynamics.

3. **AI opponent:** Should we implement a simple AI for single-player practice? The Bi-Planetary scenario would be straightforward to AI (gravity-assist pathfinding).

4. **Spectator mode:** Allow a third connection to watch a game in progress?

5. **Turn timer:** Should there be an optional turn timer to prevent indefinite stalling?

6. **Advanced Combat System:** The rules include an optional advanced combat system with weapon/drive/structure damage tracks. Include in Phase 3 or defer?
