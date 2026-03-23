# Delta-V

An online multiplayer space combat game — vector movement and gravity in the inner Solar System.

## Overview

Delta-V is a turn-based strategy game where ships move using realistic vector physics on a hex grid. Ships maintain velocity between turns, can burn fuel to accelerate, and are affected by planetary gravity. Combat uses dice-based resolution with modifiers for range and relative velocity.

This implementation renders the game as a smooth, continuous-space experience — no visible hex grid — while using hex coordinates internally for all game logic. Ships animate along their vectors with thrust and gravity effects.

## Architecture

The project follows a modern full-stack TypeScript architecture:

```
src/
  server/
    index.ts           Cloudflare Worker — HTTP routing (/create, /ws/:code)
    game-do/
      game-do.ts       Durable Object — authoritative game state, WebSocket plumbing
      messages.ts      Message handling and dispatch
      session.ts       Session management and auth
      turns.ts         Turn processing and resolution

  client/
    main.ts            Client state machine, WebSocket handling, AI turn runner
    input.ts           Raw browser input shell (mouse/touch/keyboard)
    input-interaction.ts Pointer/minimap gesture helpers for the input shell
    audio.ts           Procedural sound effects (Web Audio API)
    tutorial.ts        Phase-based tutorial tips for new players
    game/              Client game logic helpers (combat, phase, burn, ordnance, etc.)
    renderer/          Canvas rendering, camera, animation manager, trails, minimap
    ui/                DOM overlays (menu, HUD, game log, game over)

  shared/
    types/             Shared domain, protocol, and scenario interfaces
    hex.ts             Hex math (axial coords, line draw, pixel conversion)
    movement.ts        Vector movement, gravity, crash/landing/takeoff
    combat.ts          Gun combat, counterattack, odds, line of sight
    constants.ts       Ship stats, ordnance mass, detection ranges, timing
    map-data.ts        Solar system bodies, gravity rings, bases, scenarios
    ai.ts              AI opponent (astrogation, ordnance, combat decisions)
    engine/            Pure game logic (createGame, processAstrogation, etc.)

static/
  index.html           Single-page app shell
  style.css            Styles
  favicon.svg          App icon
```

**Why TypeScript instead of Rust/WASM:** The game is turn-based with no real-time simulation loop needed on the server. TypeScript runs natively on Cloudflare Workers and simplifies the stack considerably. Canvas rendering on the client is more than sufficient for animating ship movements between turns.

### Cloudflare Components

**Worker (lobby-worker):**
- `GET /` — Serves the SPA (index.html + bundled JS/CSS)
- `POST /create` — Generates a 5-character room code plus a creator reconnect token, initializes the Durable Object room, and locks the chosen scenario
- `GET /ws/:code` — WebSocket upgrade, proxied to the Durable Object

**Durable Object (game-do):**
- One instance per active game, keyed by room code
- Maintains authoritative game state: map, ships, turn order, phase
- Receives player actions via WebSocket, runtime-validates them, and applies state changes
- Broadcasts updated state to all connected players
- Uses DO alarms for disconnect grace, turn timeout, and idle cleanup (currently 5 min inactivity)
- Persists game state to DO storage so games survive DO evictions

### Current Invite / Join Flow (No Lobby, No Login)

1. Player 1 clicks "Create Game" → `POST /create` → receives a 5-char code plus a creator reconnect token
2. UI shows the code prominently + a shareable room link (`https://delta-v.example.com/?code=K7M2X`)
3. Player 1 can copy link or share via native Share API
4. Player 2 receives the room link or enters the room code manually
5. If URL has `?code=` and optional `playerToken=` params, the client auto-joins on page load and stores the token when present
6. The creator connects via WebSocket to `/ws/K7M2X?playerToken=...`; the guest usually joins via `/ws/K7M2X` with no token on first entry
7. On successful guest join, the server issues that seat a private reconnect token in the `welcome` message for later reconnects
8. When both players are connected, the game setup phase begins

Players are seat-based for gameplay purposes (Player 1 / Player 2). Reconnects are tokenized after a seat has been claimed — the guest seat is claimed by room code alone. There are no accounts or long-term player identities.

## Game Concepts

### Hex Grid (Internal Only)

The game uses **axial hex coordinates** (q, r) internally. The hex grid is approximately 40 columns wide and 55 rows tall. The client renders hex centers as pixel positions but does **not** draw hex borders.

When a player is planning movement, subtle dot markers or a faint radial guide may appear to indicate valid destination hexes — but no full grid is drawn.

**Coordinate system:**
- Axial coordinates (q, r) with cube coordinate conversion for distance/pathfinding
- Flat-top hex orientation
- Hex size calibrated so the full solar system map fits comfortably in the viewport

### Solar System Map

The map represents the inner Solar System along the ecliptic plane:

**Celestial Bodies (with gravity hexes):**
- **Sol** (Sun) — center of map, radius-2 body with two full-gravity rings; any contact = destruction
- **Mercury** — single-hex body with one full-gravity ring and 2 base hexes
- **Venus** — radius-1 body with one full-gravity ring and bases on all 6 sides
- **Terra** (Earth) — radius-1 body with one full-gravity ring and bases on all 6 sides
  - **Luna** — single-hex moon with one weak-gravity ring and bases on all 6 sides
- **Mars** — single-hex body with one full-gravity ring and bases on all 6 sides
- **Jupiter** — large northern body with two full-gravity rings
  - **Io** — single-hex moon with one weak-gravity ring and 1 base
  - **Callisto** — single-hex moon with one weak-gravity ring and 1 base
  - **Ganymede** — single-hex moon with one weak-gravity ring and no base
- **Ceres** — single-hex asteroid body with 1 base and no gravity
- **Asteroid Belt** — scattered asteroid hexes between the inner planets and Jupiter

**Gravity types:**
- **Full gravity**: mandatory 1-hex deflection toward the body for any object passing through
- **Weak gravity** (Luna, Io, Callisto, Ganymede): player may choose to use or ignore when passing through a single weak gravity hex. Two consecutive weak gravity hexes = full gravity effect on the second.

**The map data lives in a static TypeScript module** that programmatically builds body surfaces, gravity rings, base hexes, asteroid terrain, and scenario definitions.

### Vector Movement

The core mechanic. Each ship has a **velocity vector** — a displacement from its current hex to its destination hex, repeated each turn until thrust or gravity changes it.

**Canonical movement procedure:**

1. **Predict course:** current position + current velocity = projected destination.
2. **Burn fuel (optional):** spend 1 fuel to shift the projected destination by 1 hex in any of the 6 directions.
3. **Overload (warships only):** once between maintenance stopovers, a warship may spend 2 fuel total for a 2-hex shift.
4. **Apply deferred gravity:** gravity entered on the previous turn deflects the current move by 1 hex per gravity hex entered.
5. **Move:** the phasing player's ships travel simultaneously along their final plotted paths.
6. **Queue new gravity:** gravity hexes entered during this move apply on the following turn.

**Additional movement rules:**
- Gravity takes effect on the turn *after* entry.
- A single weak-gravity hex may be ignored, but two consecutive weak-gravity hexes of the same body make the second deflection mandatory.
- A course exactly along the edge of a gravity hex does not count as entering that gravity hex.
- Ships keep their velocity vectors between turns; stationary ships have a zero vector.
- Any ship whose final course ends off-map is eliminated. It is legal for the intermediate projected course to leave the map, but the final arrow head must remain on-map.

### Turn Structure

Each game turn consists of one player-turn per player. The player-turn is:

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

4. LOGISTICS PHASE (conditional — only in scenarios with logisticsEnabled)
   - Transfer fuel or cargo between friendly ships at the same hex and velocity
   - Loot disabled or surrendered enemy ships

5. COMBAT PHASE
   - Resolve asteroid hazard rolls for asteroid hexes entered at speed > 1
   - Resolve gunfire, counterattacks, planetary defense, and attacks against nukes

6. RESUPPLY PHASE
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

**Combat mechanics:**
- Line of sight is blocked by planets, moons, and Sol.
- Ships, ordnance, and asteroids do not block line of sight.
- A defender may counterattack if still eligible, and any ships in the defender's hex that share the defender's course may join that counterattack.
- Attacks may be declared at less than full strength.
- When multiple ships attack together, use the greatest applicable range and velocity penalties.
- A ship may not attack more than once per combat phase. (Note: A group of ships from the same hex may split their total combat strength across multiple targets in a single hex).
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
- **Inspection**: In hidden-identity scenarios (like *Escape*), an enforcer can reveal a hidden ship by "matching courses": ending a turn in the same hex with the identical velocity vector.

Detection matters primarily in hidden-information scenarios such as Piracy and Lateral 7. In open scenarios like Bi-Planetary, all ships may simply be visible.

### Other Rules

- **Asteroids:** roll once on the Other Damage Table for each asteroid hex entered at speed > 1. Moving along a hexside between two asteroid hexes counts as entering one asteroid hex. Mines and torpedoes detonate on entering asteroid hexes.
- **Capture:** a disabled ship can be captured by an enemy ship that matches its course and position. A captured ship may not fire or return fire and must be brought to a friendly base before reuse.
- **Surrender:** ships may surrender by agreement; surrender is distinct from capture.
- **Looting and rescue:** ships may transfer cargo, passengers, or fuel only when positions and courses match. Only disabled or surrendered ships may be looted.
- **Heroism:** longer scenarios can award a one-time +1 attack bonus after a qualifying underdog success.
- **Optional advanced combat system:** the optional alternate combat model with separate weapon, drive, and structure damage tracks remains out of scope for the current online version.

### Implementation Status

**Implemented faithfully:**
- Vector movement with deferred gravity, weak gravity player choice, overload burns
- **Overload allowance tracking**: warships may overload once between maintenance stopovers; base resupply restores the allowance
- Gun Combat Table matching 2018 rulebook (minimum D2 damage threshold, correct per-odds values)
- **Per-source Other Damage Tables**: torpedo, mine, asteroid, and ramming each use their own column from the 2018 rulebook
- Limited-strength attacks, multi-target attack queuing, landed-ship immunity
- Resupply-turn restrictions (cannot fire/launch when resupplied)
- Ordnance: mines (5-turn self-destruct, course-change requirement), torpedoes (1-2 hex launch boost), nukes (hex devastation, base destruction, asteroid clearing)
- Anti-nuke fire (guns and planetary defense at 2:1 odds)
- Per-base ownership driving planetary defense, detection, and resupply
- Hidden identity (Escape scenario fugitive concealment, server-side state filtering)
- **Inspection mechanics**: revealing hidden ships by matching position and velocity
- **Split-fire**: allocating an attacking group's strength across multiple targets in one hex
- Detection at range 3 (ships) / range 5 (bases), persistent once detected
- Damage tracking with cumulative disabled turns, recovery, and elimination at 6+
- **Dreadnaught exception**: dreadnaughts may fire guns even when disabled
- Landing validation (orbit required), takeoff mechanics, landed-ship immunity
- Ramming, asteroid hazards, crash detection
- Escape inspection, concealment, and moral-victory flow
- Counterattack targets strongest attacker by default

**Remaining divergences** (cross-referenced against [Triplanetary 2018 rulebook](https://www.sjgames.com/triplanetary/)):

- **Contact geometry** *(accepted — low priority):* Mine/torpedo contact approximated by hex occupancy/path, not the stricter board geometric rule. The rulebook requires literal geometric line intersection with the printed hex area; two courses can pass through the same hex without their drawn lines touching. Hex-path intersection is a standard digital approximation. Fixing would require sub-hex geometry incompatible with axial coordinate math.

- **Edge-of-gravity rule** *(resolved):* The rulebook (p.3, Figure 7) explicitly states a course running exactly along the edge of a gravity hex does not count as entering it. Resolved via `analyzeHexLine()` which produces `definite` (hexes in both nudge directions) and `ambiguousPairs` (edge-grazing hexes). `collectEnteredGravityEffects()` only iterates `definite`, correctly skipping edge-grazing gravity hexes.

- **Asteroid hexside rule** *(resolved):* The rulebook (p.7) states "a ship passing along a hexside between two asteroid hexes is considered to have entered one asteroid hex" — one hazard roll, not two. Resolved via `analyzeHexLine()`: `queueAsteroidHazards()` queues exactly one hazard for `ambiguousPairs` where both hexes are asteroids.

- **Logistics** *(partially implemented):* Surrender (unilateral declaration during astrogation), fuel/cargo transfer (new logistics phase after movement, requires position+velocity match), and looting of disabled/surrendered enemy ships are implemented. Torch fuel transfer restriction enforced. Enabled on Convoy, Fleet Action, and Interplanetary War scenarios. Remaining: dummy counters for concealment scenarios and passenger rescue mechanics.

- **Advanced combat system** *(resolved):* The rulebook uses the standard D1–D5/E damage system throughout; no separate advanced subsystem damage tracks exist. Dreadnaught gun exception (fire while disabled) is implemented in `canAttack`/`canCounterattack`. Orbital base D1 resilience (fire guns, launch torpedoes, and resupply at D1 damage) is implemented via `canOperateWhileDisabled()` in `combat.ts` and ordnance launch validation in `game-engine.ts`.

- **Extended Economy** *(deferred — scenario-specific):* Shipping lanes (Piracy trade cycles, cargo delivery) and asteroid prospecting (automated mines, robot guards, ore/CT shards) are scenario-specific economy mechanics from the Piracy and Interplanetary War scenarios. Defer until those scenarios are on the roadmap.

- **Orbital base D1 resilience** *(implemented):* The rulebook (p.6) states orbital bases may still launch torpedoes, fire guns, and resupply friendly ships while at D1 damage. Implemented: `canOperateWhileDisabled()` in `combat.ts` allows orbital bases to fire/counterattack at D1, and ordnance launch validation in `game-engine.ts` permits launches at D1. Resupply from orbital bases was already unrestricted by damage level.

- **Torch ship fuel transfer restriction** *(implemented):* The rulebook (p.8) states torch ships "may not transfer fuel to other ships." Enforced in `logistics.ts` — torch ships are excluded from fuel transfer eligibility.

**Unimplemented rulebook scenarios** (from the [Triplanetary 2018 PDF](https://www.sjgames.com/triplanetary/)):

| Scenario | Type | Key Dependencies |
|---|---|---|
| Lateral 7 | 2-player short | Dummy counters, Clandestine base, scanners, dense asteroids |
| Piracy | 3-player long | Clandestine, scanners, trade cycles, cargo delivery, Merchants/Patrol/Pirates roles |
| Nova | 3-player short | Alien fleet AI, nova bombs, multi-faction |
| Retribution | 2-player medium | Sons of Liberty sequential corvettes, Freedom Fleet conversion |
| Fleet Mutiny | 2-player long | Hexside suppression, base capture, planetary defense suppression |
| Prospecting | Multi-player long | Automated mines, robot guards, ore, CT shards, PM grapples |
| Campaign | Multi-player | Full economy, referee, all of the above |

All of these require Logistics and/or Extended Economy mechanics as prerequisites.

## Scenarios

Eight scenarios are implemented, selectable from the menu:

### Bi-Planetary (Learning Scenario)
- **Players:** 2
- **Setup:** Player 1 starts with a corvette on Mars. Player 2 starts with a corvette on Venus.
- **Goal:** Navigate to the other player's starting world and land.
- **Teaches:** Vector movement, fuel management, gravity assists, orbital mechanics

### Escape (Asymmetric)
- Pilgrims (3 transports from Terra) vs. Enforcers (1 corvette near Terra, 1 corsair near Venus)
- Pilgrims must escape the solar system; Enforcers must stop them
- Hidden identity: one transport carries the fugitives (opponent doesn't know which)
- Server strips the `identity` object from unrevealed opponent ships
- Moral victory is tracked per the 2018 rules if the Pilgrims disable an Enforcer ship before being lost

### Convoy (Escort Mission)
- Escort (1 tanker + 1 frigate from Mars) vs. Pirates (2 corsairs + 1 corvette)
- Escort must get the tanker to Venus; pirates must stop it

### Duel (Combat Training)
- 2 frigates near Mercury — last ship standing wins
- Teaches: combat, ordnance, gravity combat maneuvers

### Blockade Runner
- 1 packet ship vs. 1 corvette — packet must reach Mars
- Asymmetric: speed and agility vs. raw firepower

### Fleet Action
- Fleet-building battle with tuned first-player order for a shorter balanced clash
- Full combined-arms engagement

### Interplanetary War
- Tuned fleet-building war scenario using Terran vs. Rebel roles from the rulebook
- Uses a smaller MegaCredit budget than the full paper campaign for shorter digital play
- Strategic home-base positioning and mixed-fleet combat

### Grand Tour (Race)
- Each player starts with a corvette at a different habitable world
- Must pass through at least one gravity hex of each major body (Sol, Mercury, Venus, Terra, Mars, Jupiter, Io, Callisto) and return to land at the starting world
- No combat — pure navigation and gravity management
- Shared bases at Terra, Venus, Mars, and Callisto for refueling

## Rendering

### Visual Style

- **Dark space background** with procedural star field
- **No hex grid lines** — space is rendered as continuous
- **Celestial bodies** rendered as stylized circles with appropriate colors and relative sizes
- **Gravity indicators** shown as subtle directional arrows in gravity hexes
- **Ships** rendered as directional arrow icons with team colors (blue/orange)
- **Velocity vectors** shown as dashed arrows from ship position through predicted destination
- **Movement trails** — persistent faint lines showing historical ship paths, visible on main map and minimap
- **Detection ranges** shown as faint circles around own ships/bases
- **Ship tooltips** on hover showing stats (fuel, cargo, velocity, damage)

### Animations

Since the game is turn-based, animations play during the Movement Phase to show what happened:

1. **Course planning (interactive):**
   - Click ship, then click direction arrow or press 1-6 to set burn
   - Predicted course updates in real-time with a dashed line
   - Ghost ship icon at predicted destination with fuel cost display
   - Gravity deflections shown in the predicted path

2. **Movement animation (after confirm):**
   - Ships glide smoothly along their course vectors (~1.5 seconds)
   - Thrust trail rendered behind moving ships
   - Ordnance (torpedoes, mines, nukes) also animate along their paths
   - Movement events (ramming, mine/torpedo hits, asteroid hazards) shown as hex flashes with toast notifications

3. **Combat animation:**
   - Beam line drawn from attacker to target (colored by attacker type)
   - Hex flash at target location (red for hit, white for miss)
   - Combat results toast showing odds, roll, and outcome
   - Explosion effect for eliminated ships

4. **Orbit visualization:**
   - Ships at speed-1 in gravity hexes show a rotating arc indicator and "O" label
   - Orbit is emergent (not a special state), visualized when conditions are met

5. **Phase banners:**
   - Brief centered text overlay when phases transition (e.g., "MOVEMENT", "COMBAT")

### Camera / Viewport

- **Pannable and zoomable** map (drag to pan, scroll wheel to zoom, trackpad pinch-to-zoom)
- **Keyboard controls:** WASD/arrows to pan, +/- to zoom
- **Zoom range:** 0.15x to 4.0x with smooth lerp interpolation
- **Auto-frame:** camera smoothly pans to show relevant action during movement animations
- **Minimap** in bottom-right corner showing celestial bodies, ship positions, trails, and viewport indicator

### Canvas Rendering

HTML5 Canvas 2D with layered rendering:
- Background stars → asteroid hexes → gravity indicators → celestial bodies → base markers → detection ranges → trails → course vectors → ordnance → ships → combat effects → UI overlays
- Simple geometric ship icons (directional arrows)
- 60fps rendering via requestAnimationFrame with delta-time camera lerp
- Touch-friendly: pinch-to-zoom, drag to pan

## Client-Side State Machine

```
menu
  ├── Create Game → connecting → waitingForOpponent
  ├── Join Game   → connecting → waitingForOpponent
  └── Play vs AI  → (scenario select) → playing_astrogation (local game)

waitingForOpponent → playing_astrogation (when both connected)

playing_astrogation   → playing_ordnance (after confirm)
playing_ordnance      → playing_movementAnim (after movement resolves)
playing_movementAnim  → playing_combat (animation complete)
playing_combat        → playing_opponentTurn (after combat/skip)
playing_opponentTurn  → playing_astrogation (when opponent's turn completes)

Any playing state → gameOver (victory/defeat condition met)

gameOver
  ├── Rematch → playing_astrogation
  └── Exit → menu
```

Note: resupply is handled automatically at the start of each turn (no player interaction needed). The AI opponent uses the same state machine, executing its turn during `playing_opponentTurn`.

## Network Protocol

JSON messages over WebSocket. The game is turn-based so message frequency is low.

### Client → Server (C2S)

```typescript
type C2S =
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | { type: 'emplaceBase'; emplacements: OrbitalBaseEmplacement[] }
  | { type: 'skipOrdnance' }
  | { type: 'beginCombat' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'skipCombat' }
  | { type: 'rematch' }
  | { type: 'ping'; t: number }
```

### Server → Client (S2C)

```typescript
type S2C =
  | { type: 'welcome'; playerId: number; code: string; playerToken: string }
  | { type: 'matchFound' }
  | { type: 'gameStart'; state: GameState }
  | { type: 'movementResult'; movements: ShipMovement[]; ordnanceMovements: OrdnanceMovement[]; events: MovementEvent[]; state: GameState }
  | { type: 'combatResult'; results: CombatResult[]; state: GameState }
  | { type: 'stateUpdate'; state: GameState }
  | { type: 'gameOver'; winner: number; reason: string }
  | { type: 'rematchPending' }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number }
```

All game-mutating messages include the full updated `GameState`. Disconnect forfeits are persisted as authoritative game-over state and broadcast via the normal `stateUpdate` + `gameOver` path. For hidden-information scenarios, the server filters state per player (e.g., stripping `identity` from unrevealed opponent ships). See `src/shared/types/domain.ts` and `src/shared/types/protocol.ts` for the current split interface definitions.

## Game State

The authoritative state held by the Durable Object (see `src/shared/types/domain.ts` for full definitions):

```typescript
interface GameState {
  gameId: string
  scenario: string
  scenarioRules: ScenarioRules                   // per-scenario flags (ordnance types, escape edge, etc.)
  escapeMoralVictoryAchieved: boolean            // Escape scenario moral victory tracking
  turnNumber: number
  phase: Phase
  activePlayer: number                           // 0 or 1
  ships: Ship[]
  ordnance: Ordnance[]
  pendingAstrogationOrders: AstrogationOrder[] | null
  pendingAsteroidHazards: AsteroidHazard[]
  destroyedAsteroids: string[]                   // hexKey[] removed by nukes
  destroyedBases: string[]                       // hexKey[] destroyed by nukes
  players: [PlayerState, PlayerState]
  winner: number | null
  winReason: string | null
}

interface Ship {
  id: string
  type: string                                   // key into SHIP_STATS
  owner: number                                  // 0 or 1
  originalOwner: number                          // player who originally owned this ship (stable after capture)
  position: HexCoord
  lastMovementPath?: HexCoord[]                  // path from most recent movement
  velocity: HexVec                               // (dq, dr) displacement per turn
  fuel: number
  cargoUsed: number                              // mass of ordnance consumed
  nukesLaunchedSinceResupply: number              // reset on resupply
  resuppliedThisTurn: boolean
  lifecycle: 'active' | 'landed' | 'destroyed'   // mutually exclusive ship state
  control: 'own' | 'captured' | 'surrendered'    // who controls this ship
  detected: boolean
  heroismAvailable: boolean                      // heroic ships add +1 to gun combat attack rolls
  overloadUsed: boolean                          // true if overload used since last maintenance
  baseStatus?: 'carryingBase' | 'emplaced'       // orbital base lifecycle
  identity?: {                                   // hidden-identity scenarios only
    hasFugitives: boolean                        // true for the ship carrying fugitives
    revealed: boolean                            // true once inspection or capture reveals role
  }
  pendingGravityEffects?: GravityEffect[]
  damage: { disabledTurns: number }              // 0 = operational, ≥6 = eliminated
}

interface PlayerState {
  connected: boolean
  ready: boolean
  targetBody: string                             // body to land on ('' if none)
  homeBody: string
  bases: string[]                                // hexKey[] of controlled bases
  escapeWins: boolean
}

type Phase = 'waiting' | 'fleetBuilding' | 'astrogation' | 'ordnance' | 'movement' | 'logistics' | 'combat' | 'resupply' | 'gameOver'
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

The full solar system map has approximately 1,500–2,000 hexes. The map definition is authored by hand and stored as a static asset.

## Scenarios System

Scenarios are defined as configuration objects:

```typescript
interface ScenarioDefinition {
  name: string
  description: string
  players: ScenarioPlayer[]
  rules?: ScenarioRules                    // Ordnance types, escape edge, combat disabled, etc.
  startingPlayer?: 0 | 1
  startingCredits?: number | [number, number]   // Per-player MegaCredits for fleet-building
  availableShipTypes?: string[]            // Restricts purchasable ships
}

interface ScenarioPlayer {
  ships: ScenarioShip[]                      // Starting fleet
  targetBody: string                         // Body to land on ('' if none)
  homeBody: string                           // Default home world
  bases?: HexCoord[]                         // Explicit controlled bases
  escapeWins: boolean                        // True if wins by escaping the map
  hiddenIdentity?: boolean                   // One ship carries hidden cargo (Escape)
}
```

## Implementation Plan

### Milestone 1: Core Engine + Bi-Planetary (Complete)

- [x] Project setup (Wrangler, TypeScript, bundling)
- [x] Hex math library (coordinates, distance, line drawing, pixel conversion)
- [x] Map data: define solar system map (Mars–Venus corridor)
- [x] Canvas renderer: stars background, celestial bodies, gravity indicators
- [x] Ship rendering with directional icons and velocity arrows
- [x] Vector movement engine with gravity
- [x] Course planning UI (select ship, set burn, see prediction, confirm)
- [x] Movement animation (smooth ship glide with thrust trail)
- [x] Durable Object: game state management, turn sequencing
- [x] Worker: room code creation, WebSocket routing
- [x] Client WebSocket: state sync, turn submission
- [x] Victory detection (first to land on opponent's world)
- [x] Basic mobile-responsive touch controls

### Milestone 2: Combat + Escape Scenario (Complete)

- [x] Gun combat system (odds computation, die rolling, damage tables)
- [x] Combat UI (select attacker/target, show odds, animate results)
- [x] Damage tracking and recovery
- [x] Counterattack logic
- [x] Ordnance system (mines, torpedoes)
- [x] Ordnance movement and detonation
- [x] Escape scenario implementation
- [x] Ship identity concealment (Escape scenario: which transport has the fugitives?)

### Milestone 3: Full Map + Fleet Building (Complete)

- [x] Complete solar system map (all planets, moons, asteroid belt)
- [x] MegaCredit economy and ship purchasing
- [x] Fleet building UI
- [x] Full ship roster (all 9 types plus orbital base emplacement support)
- [x] Base mechanics (planetary defense, resupply, landing/takeoff)
- [x] Orbit mechanics (emergent from speed-1 in gravity hex; visual indicator implemented)
- [x] Nukes
- [x] Detection / fog of war
- [x] Minimap with ship positions, trails, and viewport indicator
- [x] Additional scenarios: Convoy, Duel, Blockade Runner, Fleet Action
- [x] Tuned Interplanetary War skirmish variant

### Milestone 4: Polish (Complete)

- [x] Sound effects (procedural Web Audio: thrust, combat, explosions, phase changes)
- [x] AI opponent (single-player vs AI with Easy/Normal/Hard difficulty)
- [x] Reconnection handling (WebSocket reconnect with player-slot persistence)
- [x] Turn timer (2-minute timeout with 30-second warning)
- [x] Tutorial system (phase-based tips for new players)
- [x] Ship movement trails (persistent path history on map and minimap)
- [x] Split-fire combat UI (queue and allocate attacks across targets in one hex)
- [x] Automation and Simulation scripts for engine testing
- [x] Visual Refinement: High-fidelity glassmorphism UI, tactile hover effects, and orbital ripples.

### Future Roadmap

- [x] Server hardening for competitive play (tokenized room access, authenticated reconnect tokens, scenario locking at room creation, runtime WebSocket payload validation)
- [x] Orbital bases (carrying, emplacing, torpedo launching)
- [x] PWA support (installable shell with offline-capable single-player)
- [x] Grand Tour checkpoint race scenario
- [x] Asteroid map visuals matching reference map
- [x] Logistics: surrender, looting, fuel/cargo transfer (passenger rescue remains open)
- [x] Event-sourced match history (authoritative match stream, projection rebuilds, checkpoints)
- [ ] Turn replay
- [ ] Scenario expansion: Lateral 7, Fleet Mutiny, Retribution
- [ ] Spectator mode
- [ ] Passenger rescue mechanics

## Design Decisions

1. **Alternating turns** (not simultaneous): Matches the original board game. Simultaneous movement would change game dynamics significantly.
2. **Standard combat system**: The rulebook includes an optional Advanced Combat System with separate weapon/drive/structure damage tracks (p.16). Deferred — the standard D1–D5/E system is used throughout.
3. **Contact geometry**: Digital hex-path intersection rather than literal geometric line intersection on the printed map. Standard for digital hex games.
4. **2-player only**: The original supports 2+ players with referee. Multi-player support would require lobby changes, turn ordering, and faction assignment UI.
