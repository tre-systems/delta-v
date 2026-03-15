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

The core mechanic. Each ship has a **velocity vector** — a displacement from its current hex to its destination hex, repeated each turn until thrust or gravity changes it.

**Canonical movement procedure:**

1. **Predict course:** current position + current velocity = projected destination.
2. **Burn fuel (optional):** spend 1 fuel to shift the projected destination by 1 hex in any of the 6 directions.
3. **Overload (warships only):** once between maintenance stopovers, a warship may spend 2 fuel total for a 2-hex shift.
4. **Apply deferred gravity:** gravity entered on the previous turn deflects the current move by 1 hex per gravity hex entered.
5. **Move:** the phasing player's ships travel simultaneously along their final plotted paths.
6. **Queue new gravity:** gravity hexes entered during this move apply on the following turn.

**Additional canonical movement rules:**
- Gravity takes effect on the turn *after* entry.
- A single weak-gravity hex may be ignored, but two consecutive weak-gravity hexes of the same body make the second deflection mandatory.
- A course exactly along the edge of a gravity hex does not count as entering that gravity hex.
- A course passing between a gravity hex and the printed outline of a body is affected by that gravity hex.
- Ships keep their velocity vectors between turns; stationary ships have a zero vector.
- Any ship whose final course ends off-map is eliminated. It is legal for the intermediate projected course to leave the map, but the final arrow head must remain on-map.

### Turn Structure

Each game turn consists of one player-turn per player. The canonical 2018 player-turn is:

```
1. ASTROGATION PHASE
   - Plot fuel burns, overloads, and weak-gravity choices for the phasing player's ships

2. ORDNANCE PHASE
   - Launch eligible mines, torpedoes, and nukes
   - Each ship may release at most one item per turn

3. MOVEMENT PHASE
   - Only the phasing player's ships and the phasing player's ordnance move
   - Gravity entered earlier applies now; newly entered gravity is queued for later
   - Crashes, landings, asteroid entry, ordnance contact, and ramming positions are established

4. COMBAT PHASE
   - Resolve asteroid hazard rolls for asteroid hexes entered at speed > 1
   - Resolve gunfire, counterattacks, planetary defense, and attacks against nukes

5. RESUPPLY PHASE
   - Bases refuel, repair, reload, transfer cargo/fuel, and provide maintenance
   - Damaged ships recover 1 disabled turn at the end of the turn
```

After both players complete their turns, a new game turn begins.

### Ships and Cargo

Nine ship types plus orbital bases:

| Ship Type   | Combat | Fuel | Cargo | Notes |
|-------------|--------|------|-------|-------|
| Transport   | 1D     | 10   | 50    | Cargo hauler; may carry orbital bases |
| Packet      | 2      | 10   | 50    | Armed transport; may carry orbital bases |
| Tanker      | 1D     | 50   | 0     | Fuel carrier |
| Liner       | 2D     | 10   | 0     | Passenger ship |
| Corvette    | 2      | 20   | 5     | Smallest warship |
| Corsair     | 4      | 20   | 10    | Mid-size warship |
| Frigate     | 8      | 20   | 40    | Large warship |
| Dreadnaught | 15     | 15   | 50    | Heavy warship |
| Torch       | 8      | ∞    | 10    | Unlimited fuel; may not transfer fuel |
| Orbital Base| 16     | ∞    | ∞     | Stationary emplacement |

**Cargo and special-capacity rules:**
- A combat factor with the `D` suffix marks a commercial ship that may not attack or counterattack.
- Only warships may overload.
- Only warships may launch torpedoes.
- Any ship may carry and launch nukes if it has enough cargo capacity, but non-warships may carry at most one nuke at a time.
- Only transports and packets may carry orbital bases.
- Fuel is not cargo.

Each ship tracks:
- Current hex position
- Velocity vector
- Fuel remaining
- Cargo / ordnance load
- Damage state
- Detection state
- Ownership and scenario-specific flags such as capture or heroism

### Combat System

**Standard gun combat** is the default ruleset for the online implementation.

1. The phasing player declares attacks.
2. Combine the chosen attackers' combat factors and compare them to the defender's factor to get odds (1:4, 1:2, 1:1, 2:1, 3:1, 4:1).
3. Apply **range modifier**: subtract 1 per hex of range, measured from the attacker's closest approach to the target's final position.
4. Apply **relative velocity modifier**: subtract 1 per hex of relative velocity above 2.
5. Roll 1d6 on the Gun Combat Table.
6. Counterattack is resolved before attack damage is implemented.

**Canonical combat rules that must be preserved:**
- Line of sight is blocked by planets, moons, and Sol.
- Ships, ordnance, and asteroids do not block line of sight.
- A defender may counterattack if still eligible, and any ships in the defender's hex that share the defender's course may join that counterattack.
- Attacks may be declared at less than full strength.
- When multiple ships attack together, use the greatest applicable range and velocity penalties.
- A ship may not attack more than once per combat phase.
- A ship may not be attacked more than once per combat phase.
- Planetary-defense shots follow normal gunfire rules except where explicitly modified.

**Damage rules:**
- `D1` through `D5` disable a ship for that many turns.
- Disabled ships drift on their present vectors and may not maneuver, attack, counterattack, or launch ordnance.
- Damage is cumulative; 6 or more disabled turns eliminates the ship.
- Every damaged ship repairs 1 disabled turn at the end of each of its player-turns.
- Maintenance at a friendly base repairs all damage and restores one overload allowance.

**Other damage sources:**

| Source    | Canonical effect |
|-----------|------------------|
| Torpedoes | Roll on the Other Damage Table; only one ship can be hit |
| Mines     | Roll on the Other Damage Table against every affected ship |
| Asteroids | Roll on the Other Damage Table for each asteroid hex entered at speed > 1 |
| Ramming   | Roll on the Other Damage Table for both ships |
| Nukes     | Destroy everything in the detonated hex automatically |

### Ordnance

**General ordnance rules:**
- All ordnance is affected by gravity.
- Ordnance moves only during its owner's movement phase.
- Each ship may release only one item per turn.
- A ship may not launch ordnance while at a base, while taking off or landing, while refueling or transferring fuel, or during any player-turn in which it resupplies.
- Mines, torpedoes, and nukes detonate when they enter a hex containing a ship, astral body, mine, torpedo, or nuke, or when any of those enter their hex.

**Mines** (mass 10):
- Inherit the launching ship's vector.
- The launching ship must immediately change course so it does not remain in the mine's hex.
- Remain active for 5 turns, then self-destruct.
- Detonate if a ship or ordnance course passes through any portion of the mine hex, or the mine's course passes through any portion of an occupied hex.
- Guns and planetary defenses have no effect on mines.

**Torpedoes** (mass 20):
- Inherit the launching ship's vector, then may accelerate one or two hexes in any direction on the launch turn.
- Only warships may launch them.
- Hit only a single target.
- If multiple ships are in the affected hex, resolve them in random order until one ship is damaged or destroyed, or all have been rolled with no effect.
- Continue moving if they miss.

**Nukes** (mass 20):
- Inherit the launching ship's vector.
- Remain active for 5 turns, then self-destruct.
- Explode when they enter a hex containing a ship, base, asteroid, mine, or torpedo, or when any of those enter the nuke hex.
- Destroy everything in the detonated hex automatically.
- Convert an asteroid hex to clear space.
- If they reach a moon or planet without earlier detonation, they devastate one entire hex side; any base or ship on that side is destroyed.
- Guns and planetary defenses may attack nukes at 2:1 odds with normal range and velocity modifiers; any disabling result destroys the nuke.
- Scenario rules determine whether nukes are available at all.

### Gravity, Orbit, Landing, and Takeoff

Gravity is the key environmental mechanic:
- Each gravity hex has an arrow pointing toward its parent body.
- Deflections are cumulative.
- Orbit is not a special state; it emerges from speed-1 movement through the gravity ring.

**Landing and takeoff rules:**
- To land on a planet or satellite, a ship must first be in orbit and then spend 1 fuel to land on a base hex side.
- Intersecting a planet or satellite any other way is a crash.
- A ship may land on Ceres, the clandestine asteroid, or an unnamed asteroid by stopping in that asteroid hex.
- Takeoff from a planetary base is free: boosters push the ship outward, surface gravity cancels that boost, and the ship begins stationary in the gravity hex above the base.
- After planetary takeoff, the ship must still spend fuel normally to enter or leave orbit.
- Landed ships at planetary bases are immune to gunfire, mines, torpedoes, and ramming, but not nukes.
- Landed ships may not fire guns or launch ordnance.

### Bases, Detection, and Support

**Planetary bases:**
- Provide fuel, maintenance, cargo handling, ordnance reloads, detection, and planetary defense.
- Each base may fire at every enemy ship in the gravity hex directly above that base during its owner's combat phase.
- Planetary-defense fire is resolved at 2:1 odds with no range or velocity modifiers; all other gunfire rules still apply.

**Asteroid bases:**
- Provide normal base functions.
- Have no planetary defense.
- May launch one torpedo per turn.
- Are harmed only by nukes unless a scenario overrides this.

**Orbital bases:**
- May be carried only by transports or packets.
- May be emplaced in a gravity hex while the carrying ship is in orbit, or on an unoccupied world hex side.
- Do not literally orbit once emplaced.
- May fire one torpedo per turn if not resupplying another ship.
- Cannot be moved once placed.

**Clandestine base:**
- A secret asteroid base that uses orbital-base statistics.
- Scenario-specific dense-asteroid and scanner rules apply around it.

**Resupply and maintenance:**
- All bases provide unlimited fuel, mines, and torpedoes.
- Planetary bases resupply landed ships on their base hex side.
- Asteroid bases resupply ships stopped in the base hex.
- Orbital bases resupply ships that match the base's position and course.
- Refueling includes maintenance: all damage is repaired and one overload allowance is restored.
- A ship may take any mix of mines and torpedoes that fits its cargo capacity.
- No ship may fire guns or launch ordnance during a player-turn in which it resupplies.
- An orbital base that resupplies any ship may not fire guns or launch ordnance that player-turn.

**Detection:**
- Ships and orbital bases detect at range 3.
- Planetary bases detect at range 5.
- Once detected, a ship remains detected until it reaches a friendly base.

Detection matters primarily in hidden-information scenarios such as Piracy and Lateral 7. In open scenarios like Bi-Planetary, all ships may simply be visible.

### Other Canonical Rules

- **Asteroids:** roll once on the Other Damage Table for each asteroid hex entered at speed > 1. Moving along a hexside between two asteroid hexes counts as entering one asteroid hex. Mines and torpedoes detonate on entering asteroid hexes.
- **Capture:** a disabled ship can be captured by an enemy ship that matches its course and position. A captured ship may not fire or return fire and must be brought to a friendly base before reuse.
- **Surrender:** ships may surrender by agreement; surrender is distinct from capture.
- **Looting and rescue:** ships may transfer cargo, passengers, or fuel only when positions and courses match. Only disabled or surrendered ships may be looted.
- **Heroism:** longer scenarios can award a one-time +1 attack bonus after a qualifying underdog success.
- **Optional advanced combat system:** the 2018 rules include an alternate combat model with separate weapon, drive, and structure damage tracks. The online game currently targets the standard gun-combat system unless explicitly extended.

### Current Rules Gaps To Resolve

The document above is the canonical rules reference. The current online implementation still diverges from it in several important places:

- **Combat fidelity:** limited-strength attacks are implemented for phasing-player gunfire, landed ships are properly immune to gunfire, and ships that resupply cannot fire in the same turn. The online model still simplifies the paper game's broader defensive timing/options, especially defender counterattack target choice and multi-target gun attacks.
- **Movement fidelity:** planetary-base landing is now stricter, and landed ships are immune to ramming, but the gravity-edge / printed-outline edge cases from the paper map are still not modeled, and asteroid/base representation is still simplified compared to the board.
- **Ordnance fidelity:** ship gunfire and planetary defenses can now attack nukes, torpedoes resolve mixed multi-target contacts more faithfully, direct nuke hits can destroy bases persistently, landed ships are immune to mines/torpedoes (but not nukes), nukes reaching a planet devastate the entry hex side (destroying any base or ship there), and mine launches require a course change. Broader planetary-surface damage effects beyond single-hex-side devastation are still not modeled.
- **Contact geometry:** mine and torpedo contact is approximated by hex occupancy/path rather than the stricter "any portion of the hex" geometric rule from the board game.
- **Bases and support:** per-base ownership now drives planetary defense, detection, and friendly resupply, and ships that resupply cannot fire or launch ordnance during that turn. Orbital bases, asteroid-base special cases, clandestine-base scanner rules, and full resupply positioning restrictions are not yet fully modeled.
- **Logistics and hidden information:** capture, surrender, looting, rescue, fuel transfer, cargo handling beyond simple ordnance mass, heroism, dummy counters, and broader hidden-movement rules remain unfinished.
- **Optional systems:** the advanced combat system from the rulebook is still out of scope and would need an explicit design decision before implementation.

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
