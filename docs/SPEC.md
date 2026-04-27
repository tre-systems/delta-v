# Delta-V Game Rules

The canonical design reference for Delta-V's gameplay rules — movement, combat, ordnance, scenarios. When prose here disagrees with the code, the code wins; otherwise the rules below are authoritative.

Rules and scenarios only. Other concerns live elsewhere:

- **Protocol, state shapes, hex math:** [PROTOCOL.md](./PROTOCOL.md) (authoritative TypeScript in `src/shared/types/`).
- **Module layout, data flow:** [ARCHITECTURE.md](./ARCHITECTURE.md).
- **Open work:** [BACKLOG.md](./BACKLOG.md).
- **Implementation gotchas per pattern:** [`patterns/`](../patterns/README.md).

## Overview

Delta-V is a turn-based strategy game where ships move using realistic vector physics on a hex grid. Ships maintain velocity between turns, can burn fuel to accelerate, and are affected by planetary gravity. Combat uses dice-based resolution with modifiers for range and relative velocity.

The client renders the board as a continuous-space experience — no visible hex grid — while the engine uses hex coordinates internally for all game logic. Ships animate along their velocity vectors with thrust and gravity effects.

## Table of Contents

- [Hex Grid](#hex-grid)
- [Solar System Map](#solar-system-map)
- [Vector Movement](#vector-movement)
- [Turn Structure](#turn-structure)
- [Ships and Cargo](#ships-and-cargo)
- [Combat](#combat)
- [Ordnance](#ordnance)
- [Gravity, Orbit, Landing, Takeoff](#gravity-orbit-landing-takeoff)
- [Bases, Detection, and Support](#bases-detection-and-support)
- [Other Rules](#other-rules)
- [Scenarios](#scenarios)
- [Implementation Status](#implementation-status)
- [Design Decisions](#design-decisions)

---

## Hex Grid

The game uses **axial hex coordinates** (q, r) internally. The grid is ~40 columns × ~55 rows. The client renders hex centers as pixel positions but does **not** draw hex borders — subtle dots or a faint radial guide may indicate valid destinations during planning.

Flat-top hex orientation. See [PROTOCOL.md#hex-math](./PROTOCOL.md#hex-math) for the coordinate primitives.

## Solar System Map

The map represents the inner Solar System along the ecliptic plane:

**Celestial bodies (with gravity hexes):**

- **Sol** (Sun) — center of map, radius-2 body with two full-gravity rings; any contact destroys.
- **Mercury** — single-hex body with one full-gravity ring and 2 base hexes.
- **Venus** — radius-1 body with one full-gravity ring and bases on all 6 sides.
- **Terra** (Earth) — radius-1 body with one full-gravity ring and bases on all 6 sides.
  - **Luna** — single-hex moon with one weak-gravity ring and bases on all 6 sides.
- **Mars** — single-hex body with one full-gravity ring and bases on all 6 sides.
- **Jupiter** — large northern body with two full-gravity rings.
  - **Io** — single-hex moon with one weak-gravity ring and 1 base.
  - **Callisto** — single-hex moon with one weak-gravity ring and 1 base.
  - **Ganymede** — single-hex moon with one weak-gravity ring and no base.
- **Ceres** — single-hex asteroid body with 1 base and no gravity.
- **Asteroid Belt** — scattered asteroid hexes between the inner planets and Jupiter.

**Gravity types:**

- **Full gravity** — mandatory 1-hex deflection toward the body for any object passing through.
- **Weak gravity** (Luna, Io, Callisto, Ganymede) — player may choose to use or ignore when passing through a single weak hex. Two consecutive weak hexes of the same body force deflection on the second.

The map is generated programmatically from static body / ring / asteroid definitions in `src/shared/map-data.ts`.

## Vector Movement

The core mechanic. Each ship has a **velocity vector** — a displacement from its current hex to its destination, repeated each turn until thrust or gravity changes it.

**Canonical movement procedure:**

1. **Predict course** — current position + current velocity = projected destination.
2. **Burn fuel (optional)** — spend 1 fuel to shift the projected destination by 1 hex in any of the 6 directions.
3. **Overload (warships only)** — once between maintenance stopovers, a warship may spend 2 fuel total for a 2-hex shift.
4. **Apply deferred gravity** — gravity hexes entered on the previous turn deflect the current move by 1 hex per hex entered.
5. **Move** — the phasing player's ships travel simultaneously along their final plotted paths.
6. **Queue new gravity** — gravity hexes entered during this move apply on the following turn.

**Movement rules:**

- Gravity takes effect on the turn *after* entry.
- A single weak-gravity hex may be ignored, but two consecutive weak-gravity hexes of the same body make the second deflection mandatory.
- A course exactly along the edge of a gravity hex does not count as entering that gravity hex.
- Ships keep their velocity vectors between turns; stationary ships have a zero vector.
- Any ship whose final course ends off-map is eliminated. Intermediate hexes can leave the map as long as the arrowhead lands on it.

See [PROTOCOL.md#vector-movement-algorithm](./PROTOCOL.md#vector-movement-algorithm) for the step-by-step pseudocode.

## Turn Structure

Each game turn consists of one player-turn per player. The player-turn has six stages:

```
1. ASTROGATION — plot fuel burns, overloads, weak-gravity choices
2. ORDNANCE    — launch mines, torpedoes, nukes (one item per ship)
3. MOVEMENT    — phasing player's ships and ordnance move simultaneously
4. COMBAT      — asteroid hazards, gunfire, counterattacks, planetary defense, anti-nuke
5. LOGISTICS   — (conditional — if logisticsEnabled) transfer fuel/cargo; loot
6. ADVANCE     — base resupply, damage recovery, rotate phasing player
```

After both players complete their turns, a new game turn begins. The engine's internal `Phase` enum (`astrogation`, `ordnance`, `logistics`, `combat`, `gameOver`, …) collapses movement into astrogation resolution — see [PROTOCOL.md#game-state](./PROTOCOL.md#game-state).

## Ships and Cargo

Nine ship types plus orbital bases:

| Ship | Combat | Fuel | Cargo | Notes |
| --- | --- | --- | --- | --- |
| Transport | 1D | 10 | 50 | Cargo hauler; may carry orbital bases |
| Packet | 2 | 10 | 50 | Armed transport; may carry orbital bases |
| Tanker | 1D | 50 | 0 | Fuel carrier |
| Liner | 2D | 10 | 0 | Passenger ship |
| Corvette | 2 | 20 | 5 | Smallest warship |
| Corsair | 4 | 20 | 10 | Mid-size warship |
| Frigate | 8 | 20 | 40 | Large warship |
| Dreadnaught | 15 | 15 | 50 | Heavy warship |
| Torch | 8 | ∞ | 10 | Unlimited fuel; may not transfer fuel |
| Orbital Base | 16 | ∞ | ∞ | Stationary emplacement |

**Cargo and special-capacity rules:**

- A combat factor with the `D` suffix marks a commercial ship that may not attack or counterattack.
- Only warships may overload.
- Only warships may launch torpedoes.
- Any ship may carry and launch nukes if it has the cargo capacity, but non-warships are limited to one nuke launch between resupplies.
- Only transports and packets may carry orbital bases.
- Fuel is not cargo.

Each ship tracks position, velocity, fuel, cargo/ordnance load, damage state, detection state, and scenario-specific flags (capture, heroism). The canonical state shape is in [PROTOCOL.md#game-state](./PROTOCOL.md#game-state).

## Combat

**Standard gun combat** is the default for the online implementation.

1. The phasing player declares attacks.
2. Combine the chosen attackers' combat factors; compare to the defender's to get odds (`1:4`, `1:2`, `1:1`, `2:1`, `3:1`, `4:1`).
3. Apply **range modifier** — subtract 1 per hex of range (attacker's closest approach to the target's final position).
4. Apply **relative velocity modifier** — subtract 1 per hex of relative velocity above 2.
5. Roll 1d6 on the Gun Combat Table.
6. Counterattack is resolved before attack damage is implemented.

**Mechanics:**

- Line of sight is blocked by planets, moons, and Sol. Ships, ordnance, and asteroids do not block LOS.
- A defender may counterattack if still eligible; ships sharing the defender's hex and course may join.
- Attacks may be declared at less than full strength.
- When multiple ships attack together, use the *greatest* applicable range and velocity penalties.
- A ship may not attack more than once per combat phase. A group from the same hex may split combat strength across multiple targets in one hex.
- Planetary-defense shots follow normal gunfire rules except where noted.

**Damage:**

- `D1` through `D5` disable a ship for that many turns.
- Disabled ships drift on their current vector and may not maneuver, attack, counterattack, or launch ordnance.
- Damage is cumulative; ≥ 6 disabled turns eliminates the ship.
- Every damaged ship repairs 1 disabled turn at the end of each of its player-turns.
- Maintenance at a friendly base repairs all damage and restores one overload allowance.

**Other damage sources:**

| Source | Effect |
| --- | --- |
| Torpedoes | Roll on the Other Damage Table; only one ship can be hit |
| Mines | Roll on the Other Damage Table against every affected ship |
| Asteroids | Roll on the Other Damage Table for each asteroid hex entered at speed > 1 (asteroid column: no effect on rolls 1–4, **D1** on rolls 5–6 — 2018 rulebook) |
| Ramming | Roll on the Other Damage Table for both ships |
| Nukes | Destroy everything in the detonated hex automatically |

## Ordnance

**General rules:**

- All ordnance is affected by gravity.
- Ordnance moves only during its owner's movement phase.
- Each ship may release only one item per turn.
- A ship may not launch ordnance while at a base, while taking off or landing, while refueling or transferring fuel, or during any player-turn in which it resupplies.
- Mines, torpedoes, and nukes detonate when they enter a hex containing a ship, astral body, mine, torpedo, or nuke — or when any of those enter their hex.

**Mines** (mass 10):

- Inherit the launching ship's vector.
- The launching ship must immediately change course so it does not remain in the mine's hex.
- Remain active for 5 turns, then self-destruct.
- Detonate on hex intersection.
- Guns and planetary defenses have no effect on mines.

**Torpedoes** (mass 20):

- Inherit the launching ship's vector, then may accelerate 1–2 hexes in any direction on the launch turn.
- Only warships may launch them.
- Hit only a single target. If multiple ships share the affected hex, resolve in random order until one is damaged/destroyed or all roll no effect.
- Continue moving if they miss.

**Nukes** (mass 20):

- Inherit the launching ship's vector.
- Remain active for 5 turns, then self-destruct.
- Explode when they enter a hex containing a ship, base, asteroid, mine, or torpedo.
- Destroy everything in the detonated hex automatically.
- Convert an asteroid hex to clear space.
- If they reach a moon or planet without earlier detonation, they devastate one entire hex side — any base or ship on that side is destroyed.
- Guns and planetary defenses may attack nukes at 2:1 odds with normal range and velocity modifiers; any disabling result destroys the nuke.
- Scenario rules determine whether nukes are available at all.

## Gravity, Orbit, Landing, Takeoff

- Each gravity hex has an arrow pointing toward its parent body.
- Deflections are cumulative.
- Orbit is not a special state — it emerges from speed-1 movement through the gravity ring.

**Landing and takeoff:**

- To land on a planet or satellite, a ship must first be in orbit and then spend 1 fuel to land on a base hex side.
- Intersecting a planet or satellite any other way is a crash.
- A ship may land on Ceres, the clandestine asteroid, or an unnamed asteroid by stopping in that asteroid hex.
- Takeoff from a planetary base is free — boosters push the ship outward, surface gravity cancels that boost, and the ship begins stationary in the gravity hex above the base. After takeoff, fuel must still be spent normally to enter/leave orbit.
- Landed ships at planetary bases are immune to gunfire, mines, torpedoes, and ramming — but not nukes.
- Landed ships may not fire guns or launch ordnance.

## Bases, Detection, and Support

**Planetary bases** provide fuel, maintenance, cargo handling, ordnance reloads, detection, and planetary defense. Each base may fire at every enemy ship in the gravity hex directly above it during its owner's combat phase at 2:1 odds with no range or velocity modifiers.

**Asteroid bases** provide normal base functions but have no planetary defense. They may launch one torpedo per turn. They are harmed only by nukes unless a scenario overrides this.

**Orbital bases** may be carried only by transports or packets. They may be emplaced in a gravity hex while the carrying ship is in orbit, or on an unoccupied world hex side. They do not literally orbit once emplaced. They may fire one torpedo per turn if not resupplying another ship. They cannot be moved once placed.

**Clandestine base** — a secret asteroid base using orbital-base stats. Scenario-specific dense-asteroid and scanner rules apply around it.

**Resupply and maintenance:**

- All bases provide unlimited fuel, mines, and torpedoes.
- Planetary bases resupply landed ships on their base hex side.
- Asteroid bases resupply ships stopped in the base hex.
- Orbital bases resupply ships matching the base's position and course.
- Refueling includes maintenance — all damage repaired, one overload allowance restored.
- A ship may take any mix of mines and torpedoes that fits its cargo capacity.
- No ship may fire guns or launch ordnance during a player-turn in which it resupplies.
- An orbital base that resupplies any ship may not fire guns or launch ordnance that player-turn.

**Detection:**

- Ships and orbital bases detect at range 3.
- Planetary bases detect at range 5.
- Once detected, a ship remains detected until it reaches a friendly base.
- **Inspection:** in hidden-identity scenarios (Escape), an enforcer reveals a hidden ship by matching courses — ending a turn in the same hex with the identical velocity vector.

Detection matters most in hidden-information scenarios. In fully open scenarios, it has less player-facing impact.

## Other Rules

- **Asteroids** — roll once on the Other Damage Table for each asteroid hex entered at speed > 1. Moving along a hexside between two asteroid hexes counts as entering one asteroid hex. Mines and torpedoes detonate on entering asteroid hexes.
- **Capture** — a disabled ship can be captured by an enemy that matches its course and position. A captured ship may not fire and must be brought to a friendly base before reuse.
- **Surrender** — ships may surrender by agreement; distinct from capture.
- **Looting and rescue** — transfers happen only when positions and courses match. Only disabled or surrendered ships may be looted.
- **Heroism** — longer scenarios can award a one-time +1 attack bonus after a qualifying underdog success.
- **Advanced combat** — the optional alternate combat model with separate weapon/drive/structure damage tracks is out of scope.

---

## Scenarios

Nine scenarios ship; the menu lists the simplest and fastest scenarios first,
then longer or more sophisticated scenarios.

### Bi-Planetary (learning scenario)

- **Players:** 2
- **Setup:** Player 1 starts with a corvette on Mars; Player 2 starts with a corvette on Venus.
- **Goal:** Navigate to the other player's starting world and land.
- **Teaches:** vector movement, fuel management, gravity assists, orbital mechanics.

### Duel (combat training)

- 2 frigates near Mercury — last ship standing wins.
- Teaches combat, ordnance, and gravity combat maneuvers.

### Blockade Runner

- 1 packet ship vs 1 corvette — packet must reach Mars.
- Asymmetric: speed and agility vs raw firepower.

### Grand Tour (race)

- Each player starts with a corvette at a different habitable world.
- Must pass through at least one gravity hex of each major body (Sol, Mercury, Venus, Terra, Mars, Jupiter, Io, Callisto) and return to land at the starting world.
- No combat — pure navigation and gravity management.
- Shared bases at Terra, Venus, Mars, and Callisto.

### Escape (asymmetric)

- Pilgrims (3 transports from Terra) vs Enforcers (1 corvette near Terra, 1 corsair near Venus).
- Pilgrims must escape the solar system; Enforcers must stop them.
- Hidden identity: one transport carries the fugitives (opponent doesn't know which). The server strips `identity` from unrevealed opponent ships.
- Moral victory is tracked if the Pilgrims disable an Enforcer ship before being lost.

### Lunar Evacuation (escort)

- Evacuees (transport + corvette from Luna) vs Interceptor (corsair from Terra).
- Logistics and passenger-rescue rules enabled.
- Victory requires landing survivors at Terra.

### Convoy (escort mission)

- Escort (liner with passengers + tanker + frigate from Mars) vs Pirates (2 corsairs + 1 corvette).
- Passenger rescue logistics enabled. Target-body win requires survivors aboard.

### Fleet Action

- Fleet-building battle with a tuned first-player order for a shorter balanced clash.
- Full combined-arms engagement.

### Interplanetary War

- Tuned fleet-building war using Terran vs Rebel roles from the rulebook.
- Uses a smaller MegaCredit budget than the full paper campaign.
- Strategic home-base positioning and mixed-fleet combat.

Scenario definition shape and `ScenarioRules` flags: [PROTOCOL.md#scenario-definition](./PROTOCOL.md#scenario-definition). Gameplay notes per scenario: [MANUAL_TEST_PLAN.md#6-scenarios](./MANUAL_TEST_PLAN.md#6-scenarios-verify-each-starts-correctly-and-applies-its-rules).

### Unimplemented rulebook scenarios

Dependencies on logistics and extended-economy mechanics push these out of scope today:

| Scenario | Type | Key dependencies |
| --- | --- | --- |
| Lateral 7 | 2-player short | Dummy counters, clandestine base, scanners, dense asteroids |
| Piracy | 3-player long | Clandestine, scanners, trade cycles, cargo delivery, Merchants/Patrol/Pirates roles |
| Nova | 3-player short | Alien fleet AI, nova bombs, multi-faction |
| Retribution | 2-player medium | Sons of Liberty sequential corvettes, Freedom Fleet conversion |
| Fleet Mutiny | 2-player long | Hexside suppression, base capture, planetary-defense suppression |
| Prospecting | Multi-player long | Automated mines, robot guards, ore, CT shards, PM grapples |
| Campaign | Multi-player | Full economy, referee, all of the above |

---

## Implementation Status

See [BACKLOG.md](./BACKLOG.md) for the current open-work list; recurring audits live in [REVIEW_PLAN.md](./REVIEW_PLAN.md). This section is a snapshot of what exists vs. what diverges from the rulebook.

### Implemented faithfully

- Vector movement with deferred gravity, weak-gravity player choice, overload burns.
- **Overload allowance tracking** — warships may overload once between maintenance stopovers; base resupply restores the allowance.
- Gun Combat Table matching 2018 rulebook (minimum D2 damage threshold, correct per-odds values).
- **Per-source Other Damage Tables** — torpedo, mine, asteroid, and ramming each use their own column.
- Limited-strength attacks, multi-target attack queuing, landed-ship immunity.
- Resupply-turn restrictions (cannot fire/launch when resupplied).
- Ordnance — mines (5-turn self-destruct, course-change requirement), torpedoes (1–2 hex launch boost), nukes (hex devastation, base destruction, asteroid clearing).
- Anti-nuke fire (guns and planetary defense at 2:1 odds).
- Per-base ownership driving planetary defense, detection, and resupply.
- Hidden identity (Escape fugitive concealment, server-side state filtering).
- **Inspection mechanics** — revealing hidden ships by matching position and velocity.
- **Split-fire** — allocating an attacking group's strength across multiple targets in one hex.
- Detection at range 3 (ships) / range 5 (bases), persistent once detected.
- Damage tracking with cumulative disabled turns, recovery, and elimination at 6+.
- **Dreadnaught exception** — dreadnaughts may fire guns even when disabled.
- Landing validation (orbit required), takeoff mechanics, landed-ship immunity.
- Ramming, asteroid hazards, crash detection.
- Escape inspection, concealment, and moral-victory flow.
- Counterattack targets strongest attacker by default.
- Event-sourced server recovery from persisted match stream plus checkpoints.

### Accepted divergences

- **Contact geometry** — mine/torpedo contact is approximated by hex occupancy/path, not the stricter board rule that requires literal geometric line intersection with the printed hex area. Standard digital approximation; fixing requires sub-hex geometry incompatible with axial coordinate math.
- **Torpedo lifetime** — torpedoes use the same 5-turn self-destruct window as mines and nukes. This prevents orphan ordnance from drifting indefinitely after a miss.
- **Logistics (partial)** — surrender, fuel/cargo transfer, looting, passenger/colonist transfer, and Torch fuel-transfer restriction are implemented. Dummy counters for concealment scenarios and any rescue-scenario tuning beyond Convoy remain open.
- **Extended Economy (deferred)** — shipping lanes (Piracy trade cycles, cargo delivery) and asteroid prospecting (automated mines, robot guards, ore/CT shards) are scenario-specific economies from the Piracy and Interplanetary War scenarios. Deferred until those scenarios are on the roadmap.

---

## Design Decisions

1. **Alternating turns, not simultaneous** — matches the original board game. Simultaneous movement would change game dynamics significantly.
2. **Standard combat system** — the D1–D5/E damage model, including implemented exceptions (dreadnaught disabled-fire, orbital-base D1 operation).
3. **Contact geometry** — digital hex-path intersection rather than literal geometric line intersection on the printed map.
4. **2-player only** — the original supports 2+ players with referee. Multi-player would require lobby changes, turn ordering, and faction assignment UI.
