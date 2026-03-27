# Type System Analysis: Delta-V

> **Framing:** This analysis treats the types as documentation — could someone read the type definitions and understand what a tactical space combat game *is*, how turns work, what entities exist, what actions are possible? Or do the types feel like implementation artifacts that happen to be typed?

---

## Summary Verdict

The type system is genuinely good in places and has meaningful gaps in others. It is not uniformly one or the other. The top-level entities (`Ship`, `Ordnance`, `SolarSystemMap`), the command protocol (`C2S`), and the event log (`EngineEvent`) are all legible to a new reader. You can read `C2S` and understand what a player can *do* on their turn. You can read `EngineEvent` and reconstruct what *happened* in a match. That's real documentary value.

But the types feel like they were written alongside the implementation rather than ahead of it — capturing the structure of data at rest rather than the concepts that give that data meaning. Several critical mechanics are either untyped, scattered across unrelated interfaces, or require implementation knowledge to interpret. A new contributor could understand the shape of game state from the types, but would struggle to understand the *rules* that govern it.

---

## What Works Well

### Entities are recognisable

`Ship`, `Ordnance`, `SolarSystemMap`, `CelestialBody` map cleanly to real game concepts. Anyone who has played the game or read the rules would recognise them immediately. `PositionedEntity` as a shared base for `Ship` and `Ordnance` correctly captures that both are objects in space with position and velocity — a genuine abstraction, not just code reuse.

### The command protocol reads like a rule book

```typescript
export type C2S =
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | { type: 'beginCombat' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'logistics'; transfers: TransferOrder[] }
  | { type: 'surrender'; shipIds: string[] }
  | { type: 'skipOrdnance' }
  | { type: 'skipCombat' }
  | { type: 'skipLogistics' }
  // ...
```

This is excellent. A reader can understand the full grammar of player actions from one type definition. The `skip*` variants make it explicit that each of these phases is optional (you can pass). The alternation between "do something" and "skip" variants documents a game decision structure cleanly.

### The event log reads like a match history

`EngineEvent` is a well-structured discriminated union. The section comments (`// Game lifecycle`, `// Fleet building`, `// Ship movement`, `// Ordnance`, `// Combat`, `// Logistics`, `// Hidden identity / race`) act as a table of contents for everything that can happen in a match. Reading it linearly gives a reasonable high-level understanding of the game's event vocabulary. `EventEnvelope` wrapping it with `gameId`, `seq`, `ts`, and `actor` correctly models event sourcing without leaking implementation.

### The phase processor pattern is clean

Pure functions of the form:

```
(GameState, PlayerId, Input, Map, RNG?) → Success | EngineError
```

This is a good architectural decision. The processor functions are referentially transparent, testable, and clearly bounded. The pattern is consistent enough that a reader can understand the engine structure from looking at two or three examples.

### `Result<T, E>` is correctly minimal

```typescript
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

No magic, no library dependency, does the job. Used appropriately in event projection.

### `GravityInfo` / `GravityEffect` are expressive

```typescript
export interface GravityInfo {
  direction: number;
  bodyName: string;
  strength: 'full' | 'weak';
}

export interface GravityEffect extends GravityInfo {
  hex: HexCoord;
  ignored: boolean;
}
```

The extension here is meaningful: a `GravityEffect` is a `GravityInfo` situated at a specific hex and with a decision attached (`ignored`). This is a good use of interface extension to model a richer version of a simpler concept.

### Action handler pattern is well-typed

```typescript
export type GameStateActionHandler<
  T extends GameStateActionType,
  Success extends StatefulActionSuccess = StatefulActionSuccess,
> = {
  run: (gameState: GameState, playerId: number, message: GameStateActionMessageOf<T>) => Success | EngineFailure | Promise<Success | EngineFailure>;
  publish: (playerId: number, result: Success) => Promise<void>;
};
```

The generic parameter `T` threading through `GameStateActionMessageOf<T>` is correct — it ties the handler's input type to the specific C2S message variant. The `run`/`publish` separation cleanly models the server's two responsibilities.

---

## Problems

### 1. The turn structure is not documented by the types

`Phase` is a flat string union:

```typescript
export type Phase =
  | 'waiting'
  | 'fleetBuilding'
  | 'astrogation'
  | 'ordnance'
  | 'movement'
  | 'logistics'
  | 'combat'
  | 'resupply'
  | 'gameOver';
```

Reading this, a new reader cannot determine:

- Which phases are **player-driven** (astrogation, ordnance, combat, logistics) versus **server-resolved** (movement, resupply).
- Which phases are **simultaneous** (both players submit before resolution) versus **alternating** (only `activePlayer` acts).
- What the actual turn *sequence* is. The values appear to be in turn order, but there is nothing guaranteeing this; the compiler cannot help if a refactor changes the ordering.
- Why `astrogation` and `movement` are separate phases. This split — player submits orders, then server resolves movement — is the central architectural decision of the turn system, yet it is invisible in the type.

Additionally, `'waiting'` and `'gameOver'` are lifecycle states, not turn phases. They are conflated with the active turn sequence in the same union. A reader cannot tell from the type whether `waiting` can appear mid-game or only before it starts.

`activePlayer: number` compounds this. There is no `PlayerId = 0 | 1` type, so the two-player constraint is implicit everywhere. `players: [PlayerState, PlayerState]` uses a tuple which hints at it, but `activePlayer: number` does not enforce it.

### 2. `Ship.type: string` — the most important property is opaque

Every ship's behaviour is determined by its type. It controls the `combat`, `fuel`, `cargo`, and `cost` values from `ShipStats`. But `type: string` is unconstrained at the type level. The valid values (`'transport'`, `'packet'`, `'tanker'`, `'liner'`, `'corvette'`, `'corsair'`, `'frigate'`, `'dreadnaught'`, `'torch'`, `'orbitalBase'`) exist only in `constants.ts` as keys of a `Record`.

This means `ShipStats` (documenting what a ship type *is*) is entirely disconnected from `Ship` (documenting what a ship instance *is*). You cannot navigate from a ship to its stats through the type system. The same gap exists in `FleetPurchase.shipType: string`, `ScenarioShip.type: string`, and `availableShipTypes?: string[]`. The ship type vocabulary is the most game-specific concept in the codebase and is not expressed as a type.

### 3. Ownership and control are muddled

```typescript
export interface Ship {
  owner: number;
  originalOwner: number;
  control: ShipControl; // 'own' | 'captured' | 'surrendered'
}
```

Three fields encoding two dimensions, and the invariant relating them is not documented. Does `owner` change when a ship is captured? If it does, then `originalOwner` is equivalent to what `owner` was at game start, and `control: 'captured'` means "`owner` ≠ `originalOwner`". If `owner` stays fixed and `control` tracks current status, then `originalOwner` is redundant. A reader must trace the mutation code to know which model is correct.

The naming also introduces a subtle inconsistency. `control: 'own'` means "this player controls it" as a present-tense status, while `owner` implies permanent attribution. The distinction between "the ship you started the game with", "a ship you captured", and "a ship that surrendered to you" are all meaningful and distinct game states, but the type system doesn't make them legible.

### 4. Win conditions are scattered and incomplete

A reader trying to understand "how does someone win?" would need to find:

- `PlayerState.escapeWins: boolean` — something about escaping
- `ScenarioRules.escapeEdge?: 'any' | 'north'` — which edge you escape from
- `ScenarioRules.checkpointBodies?: string[]` — waypoint racing
- `ScenarioRules.targetWinRequiresPassengers?: boolean` — bring passengers to win
- `GameState.escapeMoralVictoryAchieved: boolean` — ???
- `GameState.winner: number | null; winReason: string | null` — the outcome, as a free-form string

There is no `WinCondition` type. The game clearly has distinct scenario archetypes — attack-defend, escort/escape, checkpoint race, rescue — but the type system expresses them as optional flags dispersed across `ScenarioRules`. You cannot read the types and understand what the game modes *are*.

`escapeMoralVictoryAchieved` is the worst offender. "Moral victory" is game jargon. The concept does not appear in any other type, is not explained by any comment on the field, and a new reader would have no idea what it represents or what triggers it.

### 5. `ScenarioRules` is a feature-toggle accumulator

```typescript
export interface ScenarioRules {
  allowedOrdnanceTypes?: Array<Ordnance['type']>;
  planetaryDefenseEnabled?: boolean;
  hiddenIdentityInspection?: boolean;
  escapeEdge?: 'any' | 'north';
  combatDisabled?: boolean;
  checkpointBodies?: string[];
  sharedBases?: string[];
  logisticsEnabled?: boolean;
  passengerRescueEnabled?: boolean;
  targetWinRequiresPassengers?: boolean;
  reinforcements?: Reinforcement[];
  fleetConversion?: FleetConversion;
}
```

Twelve independent optional fields with no grouping or structure. This reads like a changelog of feature additions rather than a model of the scenario design space. A reader cannot tell:

- Which flags are orthogonal and which are linked (does `passengerRescueEnabled` imply `logisticsEnabled`? do the types tell you?).
- Which combinations of flags define recognisable scenario types.
- Whether there are invalid combinations of flags.

`ScenarioRules` is also embedded in `GameState` as a runtime snapshot, while `ScenarioDefinition` holds the configuration-time version. The relationship between these two representations — and why `ScenarioRules` needs to live in `GameState` at all — is not documented by the types.

### 6. `AstrogationOrder.weakGravityChoices` is completely opaque

```typescript
export interface AstrogationOrder {
  shipId: string;
  burn: number | null;
  overload?: number | null;
  weakGravityChoices?: Record<string, boolean>;
}
```

Gravity navigation is one of the most distinctive mechanics in the game. When a ship enters a weak gravity hex, the player chooses whether to be pulled by that gravity. This choice is modelled as `Record<string, boolean>` — a map of hex coordinates encoded as strings to whether the effect is applied.

The type says nothing about this. A reader sees `weakGravityChoices` and has no idea what the keys represent, what the booleans mean, or why this only applies to *weak* gravity (not full). The `GravityEffect` and `GravityInfo` types exist and are expressive, but they are not connected to `AstrogationOrder` via any type-level relationship. This is the most significant case of a rich mechanic being obscured by a primitive type.

### 7. `DamageType` is inconsistent with `MovementEvent`

```typescript
// domain.ts
export type DamageType = 'none' | 'disabled' | 'eliminated';

// Also in domain.ts, on MovementEvent:
damageType: 'none' | 'disabled' | 'eliminated' | 'captured';
```

`'captured'` is a valid damage outcome for movement events but is not part of `DamageType`. So `DamageType` is not the type for "the outcome of damage" — it is the type for "the outcome of combat damage specifically". The inline union in `MovementEvent` is a silent extension that breaks the contract implied by the name `DamageType`.

A related inconsistency: in `EngineEvent`, `combatAttack.attackType` is typed as `string`, while in `CombatResult` (the in-memory result of the same event) it is typed as `'gun' | 'baseDefense' | 'asteroidHazard' | 'antiNuke'`. The event record loses type precision compared to the in-memory result it is meant to represent. These should be the same type.

### 8. Phase processor signatures have no common interface

The processors are:

```typescript
processAstrogation → MovementResult | StateUpdateResult | { error: EngineError }
processOrdnance   → MovementResult | { error: EngineError }
processLogistics  → { state: GameState; engineEvents: EngineEvent[] } | { error: EngineError }
skipLogistics     → StateUpdateResult | { error: EngineError }
```

`processLogistics` returns `{ state: GameState; engineEvents: EngineEvent[] }` inline — structurally identical to `StateUpdateResult` but not the same named type. No shared interface exists for "a thing that processes a phase". If you wanted to build a table of processors keyed by phase, iterate over them, or make the turn-processing loop generic, the type system would not help. The architectural pattern that exists in practice — pure functions mapping state to state — is not documented as an abstraction.

### 9. Opaque fields carrying unexplained game mechanics

Several fields on `Ship` represent meaningful game rules but carry no documentation at the type level:

- **`heroismAvailable: boolean`** — What is heroism? There is no `HeroismRule`, no event, no comment. The mechanic is invisible from the types.
- **`nukesLaunchedSinceResupply: number`** — This tracks a nuke rate-limit rule. The field name encodes the reset condition (resupply), implying a rule that is not expressed anywhere in the type system. Why `nukesLaunchedSinceResupply` and not `nukesLaunched`? The difference is meaningful but opaque.
- **`pendingGravityEffects?: GravityEffect[]`** on both `Ship` and `Ordnance` — populated during movement resolution, consumed somewhere downstream. The lifecycle of this data — when it is set, when it is cleared, what it means when present — is not documented by the type.
- **`baseStatus?: 'carryingBase' | 'emplaced'`** — The orbital base mechanic is modelled as a flag on a ship, implying a ship can *become* a base or carry one. This is a meaningful game concept with no dedicated abstraction. The optional nature (`?`) means a ship without a base has `undefined` here rather than a clean `baseStatus: 'none'` state.
- **`resuppliedThisTurn: boolean`** — A transient flag that resets each turn. A reader cannot know from the type whether this persists across turns or is a within-turn state.

### 10. `pendingAstrogationOrders: AstrogationOrder[] | null`

Both `null` and `[]` are representable. The `| null` implies semantic significance — that "no orders received yet" is distinct from "orders received with zero items". But the type does not document which is which, or whether `null` can appear mid-game or only before orders are submitted. This is a small but symptomatic issue: the representation encodes a distinction that the type does not explain.

### 11. The S2C protocol is inconsistent in its event structure

`movementResult` and `combatResult` are dedicated message types with structured data. Logistics results arrive as a generic `stateUpdate` with optional `transferEvents` tacked on:

```typescript
| { type: 'stateUpdate'; state: GameState; transferEvents?: LogisticsTransferLogEvent[] }
```

The `?` on `transferEvents` means a plain state update and a logistics result are the same message type, distinguished only by the presence of a field. This is a partial discriminated union. A client handler switching on `type: 'stateUpdate'` must additionally check `transferEvents` to know what caused the update. Why logistics events are structured differently from movement and combat events is not documented.

---

## Missing Abstractions

### `PlayerId = 0 | 1`

The two-player constraint is implicit throughout the codebase. `activePlayer: number`, `owner: number`, `originalOwner: number`, `playerId: number` in events, `players: [PlayerState, PlayerState]` — all of these encode the same invariant (`0` or `1`) without expressing it. A single type alias would make the constraint visible and enable the compiler to catch misuse.

### `TurnPhase` vs `GamePhase`

`Phase` conflates two different concepts:
- **Game lifecycle states**: `'waiting'`, `'gameOver'` — not part of a turn.
- **Turn phases**: `'fleetBuilding'`, `'astrogation'`, `'ordnance'`, `'movement'`, `'logistics'`, `'combat'`, `'resupply'` — the active turn sequence.

Separating these would also enable documenting the player-driven vs. server-resolved distinction. Even comments on the union values would be an improvement, but a structural split would be better.

### `PhaseProcessor<TInput, TSuccess>`

The engine has a consistent pattern that is not named:

```typescript
type PhaseProcessor<TInput, TSuccess> = (
  state: GameState,
  playerId: PlayerId,
  input: TInput,
  map: SolarSystemMap,
  rng?: () => number,
) => TSuccess | { error: EngineError };
```

Naming this interface would document the pattern, enable a processor registry keyed by phase, and make the architectural boundary between "engine core" and "game rules" explicit.

### `WinCondition`

The game has distinguishable scenario archetypes. Even an approximate union would document the design space:

```typescript
type WinCondition =
  | { type: 'destroyFleet' }
  | { type: 'escape'; edge: 'any' | 'north' }
  | { type: 'reachTarget'; requiresPassengers?: boolean }
  | { type: 'checkpointRace'; bodies: string[] };
```

This would replace the scattered flags in `ScenarioRules` with a model that communicates what the game is trying to achieve.

### `ShipType` string union

The ship type vocabulary (`'transport'`, `'packet'`, `'tanker'`, `'liner'`, `'corvette'`, `'corsair'`, `'frigate'`, `'dreadnaught'`, `'torch'`, `'orbitalBase'`) exists only as keys in a `Record` in `constants.ts`. Extracting it as a named type and referencing it from `Ship.type`, `FleetPurchase.shipType`, `ScenarioShip.type`, and `availableShipTypes` would connect the stat lookup system to the entity model through the type system.

### `MovementOutcome`

A named type that extends `DamageType` with `'captured'` for the movement context:

```typescript
type MovementOutcome = DamageType | 'captured';
```

This resolves the inconsistency in `MovementEvent` and makes the relationship explicit (a movement outcome is a superset of a combat damage type).

### `CelestialBodyName` as a type alias

`targetBody: string`, `homeBody: string`, `bodyName: string`, `checkpointBodies: string[]`, `sharedBases: string[]` — all reference celestial body names as plain strings. A `CelestialBodyName = string` alias, or better a union derived from the scenario definitions, would make the concept a first-class citizen and enable finding all usages through the type system.

### `GravityChoice` replacing `Record<string, boolean>`

Even a named alias with a comment would improve `AstrogationOrder`:

```typescript
// Key is hex coordinate encoded as string; value is true if the player chooses
// to accept the gravity pull from that hex.
type GravityChoices = Record<HexKey, boolean>;
```

But ideally this would reference `GravityEffect` and document the relationship between the player's choice and the gravity mechanics.

---

## Reusability Assessment

### Portable as-is (no delta-v concepts)

| Type / Pattern | Notes |
|---|---|
| `Result<T, E>` | Generic, well-done |
| `HexCoord`, `HexVec`, `PixelCoord` | Clean hex grid types with no game assumptions |
| `EventEnvelope` | Generic event sourcing wrapper |
| `EngineError`, `ErrorCode` | Generic validation error model |
| `GameStateActionHandler<T>` pattern | The `run`/`publish` split is reusable |
| Phase processor pattern | Pure function convention, no delta-v concepts |
| `C2S`/`S2C` discriminated union protocol pattern | Pattern is portable, values are game-specific |

### Portable to other space/physics games

| Type / Pattern | Notes |
|---|---|
| `SolarSystemMap`, `CelestialBody` | Would need renaming but the shape is generic |
| `MapHex` with gravity | Gravity as a hex property is clean |
| `GravityEffect`, `GravityInfo` | Space-physics concept |
| `AstrogationOrder` | Movement with burns/gravity, space-specific |
| `CourseResult` | Physics simulation result |
| `PositionedEntity` | Velocity-based movement |

### Tightly coupled to delta-v's specific rules

These would need to be removed or generalised to build a different game on the same engine:

| Type / Field | Coupling |
|---|---|
| `ScenarioRules` (as a whole) | Encodes delta-v's specific feature flags |
| `Ship.heroismAvailable` | Delta-v mechanic with no general analogue |
| `Ship.nukesLaunchedSinceResupply` | Delta-v ordnance rate-limit rule |
| `Ship.baseStatus` | Orbital base deployment mechanic |
| `Ship.identity` | Hidden identity mechanic |
| `Ship.passengersAboard` | Rescue scenario mechanic |
| `GameState.escapeMoralVictoryAchieved` | Delta-v-specific victory condition |
| `GameState.destroyedAsteroids`, `destroyedBases` | Delta-v map mutation |
| `PlayerState.escapeWins`, `visitedBodies` | Scenario-objective tracking |
| `PlayerState.totalFuelSpent` | Delta-v stat tracking |
| `FleetConversion`, `Reinforcement` | Delta-v scenario event types |
| `Phase` names `'astrogation'`, `'resupply'` | Delta-v turn vocabulary |
| `MovementEvent` types `'ramming'`, `'mineDetonation'` | Delta-v collision rules |
| `OrdnanceLaunch.torpedoAccelSteps` | Delta-v torpedo mechanic |

### The implicit engine boundary

The engine core vs. game-specific separation exists implicitly — the pure functions in `shared/engine/` consuming `GameState` are close to an engine boundary. But there is no explicit abstraction making the separation visible. `GameState` mixes canonical entity state (`ships`, `ordnance`, `phase`) with delta-v-specific rule state (`escapeMoralVictoryAchieved`, `destroyedAsteroids`, `pendingAstrogationOrders`). To build a second game on the same engine, you would need to read through `GameState` and hand-pick which fields belong to "engine" versus "this game's rules". The type does not separate them.

A clean split would be something like:

```typescript
interface EngineState {
  gameId: string;
  turnNumber: number;
  phase: TurnPhase;
  activePlayer: PlayerId;
  ships: Ship[];
  ordnance: Ordnance[];
  players: [PlayerState, PlayerState];
  winner: PlayerId | null;
  winReason: string | null;
}

interface DeltaVGameState extends EngineState {
  scenario: string;
  scenarioRules: ScenarioRules;
  escapeMoralVictoryAchieved: boolean;
  pendingAstrogationOrders: AstrogationOrder[] | null;
  pendingAsteroidHazards: AsteroidHazard[];
  destroyedAsteroids: string[];
  destroyedBases: string[];
}
```

This is a significant refactor but would make the architectural boundary explicit in the types.

---

## Concrete Suggestions (Prioritised)

### High value, low effort

1. **`type PlayerId = 0 | 1`** — One line. Use it everywhere `number` currently represents a player index. Eliminates a whole class of implicit assumptions.

2. **Extract `ShipType` from `constants.ts`** — `export type ShipType = keyof typeof SHIP_STATS`. Reference it from `Ship.type`, `FleetPurchase.shipType`, `ScenarioShip.type`, and `availableShipTypes`. Connects the stat system to the entity model.

3. **Name `MovementOutcome = DamageType | 'captured'`** — Use it in `MovementEvent.damageType`. Resolves the inconsistency with `DamageType` and documents the relationship.

4. **Fix `combatAttack.attackType` in `EngineEvent`** — Change `string` to the same union used in `CombatResult`. Events should be at least as precise as the in-memory results they represent.

5. **`type GravityChoices = Record<HexKey, boolean>`** with a comment explaining the mechanic — Replace `Record<string, boolean>` in `AstrogationOrder`. Make the gravity navigation choice legible without requiring implementation knowledge.

### Medium value, medium effort

6. **Split `Phase` into `TurnPhase | GamePhase`** — Separate the turn sequence from lifecycle states. Add JSDoc comments on turn phases documenting which are player-driven vs. server-resolved and which are simultaneous vs. alternating.

7. **`type CelestialBodyName = string`** — At minimum, a type alias makes it searchable and nameable. Better: derive it from the map definitions.

8. **Document the `owner`/`originalOwner`/`control` invariant** — Either via comments making the invariant explicit, or by restructuring into a model that makes the capture lifecycle legible (e.g. `capturedFrom?: PlayerId` instead of `originalOwner`).

9. **Define `PhaseProcessor<TInput, TSuccess>`** — Name the pattern the engine already uses. Even if no code changes, the named interface documents the architectural convention and makes the engine boundary explicit.

10. **`StateUpdateResult` consistently** — Eliminate the inline `{ state: GameState; engineEvents: EngineEvent[] }` in `processLogistics` and use `StateUpdateResult` everywhere the same shape is returned.

### Higher effort, architectural

11. **`WinCondition` type** — Model the scenario archetypes as a discriminated union rather than as flags in `ScenarioRules`. This would require changes to scenario definitions and the victory-checking logic but would document the game's design space clearly.

12. **Separate `EngineState` from `DeltaVGameState`** — The most impactful structural change. Would make the engine/game boundary explicit and enable building other games on the same core. Significant refactor touching all processors.

13. **`stateUpdate` split** — Either give logistics a dedicated `logisticsResult` message type (parallel to `movementResult` and `combatResult`), or document explicitly why it is a `stateUpdate` with optional events rather than a first-class result type.
