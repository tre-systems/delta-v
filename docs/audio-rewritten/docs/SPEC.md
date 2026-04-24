# Delta-V Game Rules

An online multiplayer space combat game — vector movement and gravity in the inner Solar System.

## Overview

Delta-V is a turn-based strategy game where ships move using realistic vector physics on a hex grid. Ships maintain velocity between turns, can burn fuel to accelerate, and are affected by planetary gravity. Combat uses dice-based resolution with modifiers for range and relative velocity.

The client renders the board as a continuous-space experience — no visible hex grid — while the engine uses hex coordinates internally for all game logic. Ships animate along their velocity vectors with thrust and gravity effects.

## How To Read This Document

This document covers rules and scenarios only. The protocol definitions and type shapes live in a separate protocol document. Module layout and data flow are covered in the architecture document. Open work is tracked in the backlog. Implementation gotchas are documented per pattern in a patterns directory.

When the prose here disagrees with the code, the code wins — but the rules below are the canonical design reference.

## Table of Contents

- Hex Grid
- Solar System Map
- Vector Movement
- Turn Structure
- Ships and Cargo
- Combat
- Ordnance
- Gravity, Orbit, Landing, Takeoff
- Bases, Detection, and Support
- Other Rules
- Scenarios
- Implementation Status
- Design Decisions

---

## Hex Grid

The game uses axial hex coordinates internally, expressed as a column value and a row value. The grid is roughly forty columns by fifty-five rows. The client renders hex centers as pixel positions but does not draw hex borders — subtle dots or a faint radial guide may indicate valid destinations during planning.

The hex orientation is flat-top. The coordinate math primitives are defined in the protocol document.

## Solar System Map

The map represents the inner Solar System along the ecliptic plane.

Turning to the celestial bodies and their gravity hexes: Sol, the Sun, sits at the center of the map. It is a radius-two body with two full-gravity rings, and any contact with it destroys a ship outright. Mercury is a single-hex body with one full-gravity ring and two base hexes. Venus is a radius-one body with one full-gravity ring and bases on all six sides. Terra — Earth — is also a radius-one body with one full-gravity ring and bases on all six sides. Luna, Terra's moon, is a single-hex body with one weak-gravity ring and bases on all six sides. Mars is a single-hex body with one full-gravity ring and bases on all six sides. Jupiter is a large body positioned in the north of the map with two full-gravity rings. Jupiter has three moons: Io and Callisto each have one weak-gravity ring and one base, while Ganymede has one weak-gravity ring but no base. Finally, Ceres is a single-hex asteroid body with one base and no gravity at all. Scattered asteroid hexes fill the belt between the inner planets and Jupiter.

Next, the two gravity types. Full gravity imposes a mandatory one-hex deflection toward the parent body for any object passing through that hex. Weak gravity — found around Luna, Io, Callisto, and Ganymede — gives the player a choice: when passing through a single weak-gravity hex, the player may use or ignore the deflection. However, two consecutive weak-gravity hexes of the same body make the deflection mandatory on the second hex.

The map is generated programmatically from static definitions for each body, ring, and asteroid field.

## Vector Movement

Vector movement is the core mechanic. Each ship has a velocity vector — a displacement from its current hex to its destination, repeated each turn until thrust or gravity changes it.

The canonical movement procedure has six steps. First, predict the course: the current position plus the current velocity gives the projected destination. Second, optionally burn fuel: spend one fuel unit to shift the projected destination by one hex in any of the six directions. Third, overload — warships only: once between maintenance stopovers, a warship may spend two fuel total for a two-hex shift. Fourth, apply deferred gravity: gravity hexes entered on the previous turn deflect the current move by one hex per hex entered. Fifth, move: the phasing player's ships travel simultaneously along their final plotted paths. Sixth, queue new gravity: gravity hexes entered during this move will apply on the following turn.

With that established, the detailed movement rules. Gravity takes effect on the turn after entry, not the turn of entry. A single weak-gravity hex may be ignored, but two consecutive weak-gravity hexes of the same body make the second deflection mandatory. A course that travels exactly along the edge of a gravity hex does not count as entering it. Ships keep their velocity vectors between turns, and a stationary ship has a zero vector. Any ship whose final course ends off the map is eliminated — intermediate hexes may leave the map as long as the final position lands back on it.

## Turn Structure

Each game turn consists of one player-turn per player. A player-turn has six stages.

One: Astrogation — plot fuel burns, overloads, and weak-gravity choices. Two: Ordnance — launch mines, torpedoes, or nukes, limited to one item per ship. Three: Movement — the phasing player's ships and ordnance move simultaneously. Four: Combat — resolve asteroid hazards, gunfire, counterattacks, planetary defense, and anti-nuke fire. Five: Logistics, which is conditional on whether the logistics rules are enabled — transfer fuel and cargo, and loot. Six: Advance — base resupply, damage recovery, and rotation of the phasing player.

After both players complete their turns, a new game turn begins. The engine's internal phase tracking collapses movement resolution into the astrogation phase for implementation purposes, as described in the protocol document.

## Ships and Cargo

Nine ship types plus orbital bases are available. Here is each type with its characteristics.

The Transport has a combat factor of one — the D suffix meaning it is a commercial vessel that may not attack or counterattack — with ten fuel capacity, fifty cargo capacity, and the ability to carry orbital bases. The Packet has a combat factor of two, ten fuel, fifty cargo, and can also carry orbital bases. The Tanker has a combat factor of one with the defensive suffix, fifty fuel, and no cargo capacity. The Liner has a combat factor of two with the defensive suffix, ten fuel, and no cargo. The Corvette has a combat factor of two, twenty fuel, and five cargo — the smallest warship. The Corsair has a combat factor of four, twenty fuel, and ten cargo — a mid-size warship. The Frigate has a combat factor of eight, twenty fuel, and forty cargo — a large warship. The Dreadnaught has a combat factor of fifteen, fifteen fuel, and fifty cargo — the heavy warship. The Torch has a combat factor of eight, unlimited fuel, and ten cargo, but may not transfer fuel to other ships. Finally, the Orbital Base has a combat factor of sixteen, unlimited fuel, and unlimited cargo, and is a stationary emplacement.

Turning to the special capacity rules: a combat factor with the defensive suffix marks a commercial ship that may not attack or counterattack. Only warships may overload. Only warships may launch torpedoes. Any ship may carry and launch nukes if it has the cargo capacity, but non-warships are limited to one nuke launch between resupplies. Only transports and packets may carry orbital bases. Fuel is not cargo.

Each ship tracks its position, velocity, fuel, cargo and ordnance load, damage state, detection state, and any scenario-specific flags such as capture status or heroism.

## Combat

Standard gun combat is the default for the online implementation.

The sequence is as follows. First, the phasing player declares attacks. Second, combine the chosen attackers' combat factors and compare them to the defender's factor to determine the odds — which fall into bands of one-to-four, one-to-two, one-to-one, two-to-one, three-to-one, or four-to-one. Third, apply the range modifier by subtracting one for each hex of range, measured as the attacker's closest approach to the target's final position. Fourth, apply the relative velocity modifier by subtracting one for each hex of relative velocity above two. Fifth, roll one six-sided die on the gun combat table. Sixth, counterattack is resolved before attack damage is implemented.

Next, the detailed mechanics. Line of sight is blocked by planets, moons, and Sol; ships, ordnance, and asteroids do not block line of sight. A defender may counterattack if still eligible, and ships sharing the defender's hex and course may join the counterattack. Attacks may be declared at less than full strength. When multiple ships attack together, use the greatest applicable range and velocity penalties, not the average. A ship may not attack more than once per combat phase. A group attacking from the same hex may split its combat strength across multiple targets if all targets share one hex. Planetary-defense shots follow normal gunfire rules except where a specific exception is noted.

With that established, the damage rules. Damage is expressed in disabled turns — values from one through five disable a ship for that many turns. Disabled ships drift on their current vector and may not maneuver, attack, counterattack, or launch ordnance. Damage is cumulative, and six or more accumulated disabled turns eliminates the ship. Every damaged ship repairs one disabled turn at the end of each of its own player-turns. Maintenance at a friendly base repairs all damage and restores one overload allowance.

Other damage sources work as follows. Torpedoes roll on the Other Damage Table and can hit only one ship. Mines roll on the Other Damage Table against every affected ship. Asteroids roll on the Other Damage Table for each asteroid hex entered at speed greater than one. Ramming rolls on the Other Damage Table for both ships. Nukes automatically destroy everything in the detonated hex.

## Ordnance

General ordnance rules apply to all types. All ordnance is affected by gravity. Ordnance moves only during its owner's movement phase. Each ship may release only one item per turn. A ship may not launch ordnance while at a base, while taking off or landing, while refueling or transferring fuel, or during any player-turn in which it resupplies. Mines, torpedoes, and nukes detonate when they enter a hex containing a ship, an astral body, another mine, a torpedo, or a nuke — and conversely, when any of those things enter their hex.

Turning to mines, which have a mass of ten. Mines inherit the launching ship's velocity vector. The launching ship must immediately change course so it does not remain in the mine's hex. Mines remain active for five turns, then self-destruct. They detonate on hex intersection. Guns and planetary defenses have no effect on mines.

Torpedoes have a mass of twenty. They inherit the launching ship's velocity vector, then may accelerate one to two hexes in any direction on the launch turn. Only warships may launch torpedoes. A torpedo hits only a single target; if multiple ships share the affected hex, they are resolved in random order until one is damaged or destroyed, or all roll no effect. Torpedoes continue moving if they miss.

Nukes also have a mass of twenty. They inherit the launching ship's velocity vector and remain active for five turns before self-destructing. A nuke explodes when it enters a hex containing a ship, base, asteroid, mine, or torpedo. It destroys everything in the detonated hex automatically. It converts an asteroid hex to clear space. If a nuke reaches a moon or planet without earlier detonation, it devastates one entire hex side — any base or ship on that side is destroyed. Guns and planetary defenses may attack nukes at two-to-one odds with normal range and velocity modifiers, and any disabling result destroys the nuke. Whether nukes are available at all is determined by scenario rules.

## Gravity, Orbit, Landing, Takeoff

Each gravity hex has an arrow pointing toward its parent body. Deflections are cumulative. Orbit is not a special game state — it emerges naturally from speed-one movement through the gravity ring.

Turning to landing and takeoff. To land on a planet or satellite, a ship must first be in orbit and then spend one fuel to land on a base hex side. Intersecting a planet or satellite any other way is a crash. A ship may land on Ceres, the clandestine asteroid, or an unnamed asteroid by stopping in that asteroid hex. Takeoff from a planetary base is free — boosters push the ship outward, surface gravity cancels that boost, and the ship begins stationary in the gravity hex directly above the base. After takeoff, fuel must still be spent normally to enter or leave orbit. Landed ships at planetary bases are immune to gunfire, mines, torpedoes, and ramming — but not nukes. Landed ships may not fire guns or launch ordnance.

## Bases, Detection, and Support

Planetary bases provide fuel, maintenance, cargo handling, ordnance reloads, detection coverage, and planetary defense. Each base may fire at every enemy ship in the gravity hex directly above it during its owner's combat phase, at two-to-one odds with no range or velocity modifiers.

Asteroid bases provide all normal base functions but have no planetary defense capability. They may launch one torpedo per turn. They are harmed only by nukes unless a specific scenario overrides this rule.

Orbital bases may be carried only by transports or packets. They may be emplaced in a gravity hex while the carrying ship is in orbit, or placed on an unoccupied world hex side. They do not literally orbit once emplaced. They may fire one torpedo per turn if not currently resupplying another ship. They cannot be moved once placed.

The clandestine base is a secret asteroid base that uses orbital-base statistics. Special dense-asteroid and scanner rules apply around it, as defined by the specific scenario.

Next, the resupply and maintenance rules. All bases provide unlimited fuel, mines, and torpedoes. Planetary bases resupply landed ships on their base hex side. Asteroid bases resupply ships stopped in the base hex. Orbital bases resupply ships that match the base's position and course. Refueling always includes maintenance — all damage is repaired and one overload allowance is restored. A ship may take any mix of mines and torpedoes that fits its cargo capacity. No ship may fire guns or launch ordnance during a player-turn in which it resupplies. An orbital base that resupplies any ship may not fire guns or launch ordnance that same player-turn.

Turning to detection. Ships and orbital bases detect at range three. Planetary bases detect at range five. Once detected, a ship remains detected until it reaches a friendly base. In hidden-identity scenarios such as Escape, an enforcer may reveal a hidden ship through inspection — ending a turn in the same hex with the identical velocity vector. Detection matters most in hidden-information scenarios; in fully open scenarios it has less player-facing impact.

## Other Rules

Asteroids: roll once on the Other Damage Table for each asteroid hex entered at speed greater than one. Moving along a hex edge between two asteroid hexes counts as entering one asteroid hex. Mines and torpedoes detonate on entering asteroid hexes.

Capture: a disabled ship can be captured by an enemy that matches its course and position. A captured ship may not fire and must be brought to a friendly base before reuse.

Surrender: ships may surrender by agreement, which is distinct from capture.

Looting and rescue: transfers happen only when positions and courses match. Only disabled or surrendered ships may be looted.

Heroism: longer scenarios can award a one-time plus-one attack bonus after a qualifying underdog success.

Advanced combat, which is the optional alternate combat model with separate weapon, drive, and structure damage tracks, is out of scope.

---

## Scenarios

Nine scenarios ship with the game, listed here in rough difficulty order.

### Bi-Planetary (learning scenario)

This two-player learning scenario has Player One starting with a corvette on Mars and Player Two starting with a corvette on Venus. The goal is for each player to navigate to the other player's starting world and land there. This scenario teaches vector movement, fuel management, gravity assists, and orbital mechanics.

### Escape (asymmetric)

This scenario pits Pilgrims against Enforcers. The Pilgrims control three transports departing from Terra; the Enforcers control one corvette near Terra and one corsair near Venus. The Pilgrims must escape the solar system while the Enforcers must stop them.

The scenario uses hidden identity: one of the three transports carries the fugitives, but the opponent does not know which one. The server strips the identity information from unrevealed opponent ships to enforce this. A moral victory is tracked if the Pilgrims disable an Enforcer ship before being lost.

### Lunar Evacuation (escort)

This escort scenario has Evacuees — a transport and corvette departing from Luna — facing an Interceptor controlling a corsair from Terra. Logistics and passenger-rescue rules are enabled. Victory requires landing survivors at Terra.

### Convoy (escort mission)

The Escort side controls a liner carrying passengers, a tanker, and a frigate, all departing from Mars. The Pirates control two corsairs and one corvette. Passenger-rescue logistics are enabled, and the target-body victory condition requires survivors to be aboard upon arrival.

### Duel (combat training)

Two frigates start near Mercury in a last-ship-standing battle. This scenario teaches combat mechanics, ordnance use, and gravity-assisted combat maneuvers.

### Blockade Runner

One packet ship faces one corvette in an asymmetric scenario where the packet must reach Mars. The dynamic is speed and agility against raw firepower.

### Fleet Action

A fleet-building battle with a tuned first-player ordering for a shorter, balanced clash. This is a full combined-arms engagement.

### Interplanetary War

A tuned fleet-building war using Terran and Rebel roles drawn from the original rulebook. It uses a smaller budget than the full paper campaign. The scenario emphasizes strategic home-base positioning and mixed-fleet combat.

### Grand Tour (race)

Each player starts with a corvette at a different habitable world. To win, a player must pass through at least one gravity hex of each major body — Sol, Mercury, Venus, Terra, Mars, Jupiter, Io, and Callisto — and then return to land at their starting world. There is no combat; this is a pure navigation and gravity-management race. Bases at Terra, Venus, Mars, and Callisto are shared.

### Unimplemented rulebook scenarios

Several scenarios from the original rulebook are out of scope due to dependencies on logistics and extended-economy mechanics that have not yet been built.

Lateral 7 is a short two-player scenario that requires dummy counters, a clandestine base, scanners, and dense asteroids. Piracy is a long three-player scenario requiring the clandestine base, scanners, trade cycles, cargo delivery, and the Merchants, Patrol, and Pirates faction roles. Nova is a short three-player scenario requiring an alien fleet AI, nova bombs, and multi-faction support. Retribution is a medium two-player scenario requiring sequential corvette reinforcements for the Sons of Liberty and a Freedom Fleet conversion mechanic. Fleet Mutiny is a long two-player scenario requiring hexside suppression, base capture, and planetary-defense suppression. Prospecting is a long multi-player scenario requiring automated mines, robot guards, ore, crystalline trading shards, and grapple mechanics. Campaign is a full multi-player scenario requiring a complete economy, a referee, and all of the above.

---

## Implementation Status

The backlog document is the authoritative list of open work. This section is a snapshot of what exists versus what diverges from the rulebook.

### Implemented faithfully

Vector movement with deferred gravity, weak-gravity player choice, and overload burns are all implemented. Overload allowance tracking is in place — warships may overload once between maintenance stopovers, and base resupply restores the allowance. The gun combat table matches the 2018 rulebook, including the minimum damage threshold and correct per-odds values. Per-source Other Damage Tables are implemented, with torpedo, mine, asteroid, and ramming each using their own column. Limited-strength attacks, multi-target attack queuing, and landed-ship immunity are implemented. Resupply-turn restrictions preventing firing or launching when resupplied are in place. Ordnance is implemented: mines with the five-turn self-destruct and course-change requirement, torpedoes with the one-to-two hex launch boost, and nukes with hex devastation, base destruction, and asteroid clearing. Anti-nuke fire at two-to-one odds for guns and planetary defense is implemented. Per-base ownership driving planetary defense, detection, and resupply is implemented. Hidden identity — including the Escape scenario's fugitive concealment and server-side state filtering — is implemented. Inspection mechanics that reveal hidden ships by matching position and velocity are in place. Split-fire, which allows allocating an attacking group's strength across multiple targets in one hex, is implemented. Detection at range three for ships and range five for bases, persistent once triggered, is implemented. Damage tracking with cumulative disabled turns, recovery, and elimination at six or more is implemented. The dreadnaught exception — allowing dreadnaughts to fire guns even when disabled — is in place. Landing validation requiring orbit first, takeoff mechanics, and landed-ship immunity are implemented. Ramming, asteroid hazards, and crash detection are implemented. The Escape inspection, concealment, and moral-victory flow are implemented. Counterattack targeting defaults to the strongest attacker. Event-sourced server recovery from a persisted match stream plus checkpoints is implemented.

### Accepted divergences

Contact geometry is approximated rather than exact. Mine and torpedo contact is determined by hex occupancy and path intersection rather than the stricter board-game rule requiring literal geometric line intersection with the printed hex area. This is a standard digital approximation; correcting it would require sub-hex geometry that is incompatible with axial coordinate math.

Torpedo lifetime has been aligned with mines and nukes: torpedoes now use the same five-turn self-destruct window rather than persisting indefinitely. This prevents orphan ordnance from drifting forever after a miss, and keeps all three ordnance types on the same lifetime contract.

Logistics are partially implemented. Surrender, fuel and cargo transfer, looting, passenger and colonist transfer, and the Torch fuel-transfer restriction are all implemented. Dummy counters for concealment scenarios and any rescue-scenario tuning beyond the Convoy scenario remain open.

Extended economy is deferred. Shipping lanes — including the Piracy trade cycles and cargo delivery — and asteroid prospecting — including automated mines, robot guards, ore, and crystalline trading shards — are scenario-specific economies from the Piracy and Interplanetary War scenarios. These are deferred until those scenarios are on the roadmap.

---

## Design Decisions

One: the game uses alternating turns rather than simultaneous movement, matching the original board game. Simultaneous movement would change game dynamics significantly.

Two: the standard combat system is used, with the disabled-turn damage model including implemented exceptions such as the dreadnaught disabled-fire rule and the orbital-base reduced-operation rule.

Three: contact geometry uses digital hex-path intersection rather than literal geometric line intersection on the printed map.

Four: the game is two-player only. The original board game supports two or more players with a referee. Multi-player support would require lobby changes, turn ordering, and faction assignment in the user interface.
