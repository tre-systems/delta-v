# Visitor (Event Projection)

## Category

Behavioral

## Intent

Project an ordered stream of domain events into game state by routing each event type to a specialized handler. This keeps replay logic explicit and type-directed while letting each projector own one category of mutations.

## How It Works in Delta-V

The projector is organized around three handler families:

- **Lifecycle projector** for setup, phase, and turn-level events
- **Ship projector** for ship/base/resource mutations
- **Conflict projector** for ordnance and combat mutations

Instead of a giant switch in the top-level fold, `event-projector/index.ts` builds a typed handler registry keyed by `EngineEvent['type']`. That registry is checked with `satisfies ProjectEventRegistry`, so adding a new event type forces the registry to stay complete.

`projectGameStateFromStream` then folds the event envelopes in order, passing the current state, event payload, game ID, and map to the registered handler for each event.

## Key Locations

| File | Role |
|---|---|
| `src/shared/engine/engine-events.ts` | `EngineEvent` and `EventEnvelope` |
| `src/shared/engine/event-projector/index.ts` | typed handler registry and fold |
| `src/shared/engine/event-projector/lifecycle.ts` | lifecycle projection |
| `src/shared/engine/event-projector/ships.ts` | ship/resource/base projection |
| `src/shared/engine/event-projector/conflict.ts` | ordnance/combat projection |
| `src/shared/engine/event-projector/support.ts` | lookup and migration helpers |

## Code Examples

Typed registry instead of a large dispatch switch:

```typescript
const PROJECT_EVENT_HANDLERS = {
  gameCreated: projectLifecycle,
  fleetPurchased: projectLifecycle,
  astrogationOrdersCommitted: projectLifecycle,
  ordnanceLaunchesCommitted: projectLifecycle,
  logisticsTransfersCommitted: projectLifecycle,
  surrenderDeclared: projectLifecycle,
  fugitiveDesignated: projectLifecycle,
  phaseChanged: projectLifecycle,
  turnAdvanced: projectLifecycle,
  identityRevealed: projectLifecycle,
  checkpointVisited: projectLifecycle,
  gameOver: projectLifecycle,
  shipMoved: projectShip,
  shipLanded: projectShip,
  shipCrashed: projectShip,
  shipDestroyed: projectShip,
  shipCaptured: projectShip,
  asteroidDestroyed: projectShip,
  baseDestroyed: projectShip,
  shipResupplied: projectShip,
  fuelTransferred: projectShip,
  cargoTransferred: projectShip,
  passengersTransferred: projectShip,
  shipSurrendered: projectShip,
  baseEmplaced: projectShip,
  ordnanceLaunched: projectConflict,
  ordnanceMoved: projectConflict,
  ordnanceExpired: projectConflict,
  ordnanceDetonated: projectConflict,
  ramming: projectConflict,
  ordnanceDestroyed: projectConflict,
  combatAttack: projectConflict,
} satisfies ProjectEventRegistry;
```

Stream fold:

```typescript
export const projectGameStateFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
  initialState: GameState | null = null,
): Result<GameState> => {
  let state = initialState
    ? migrateGameState(structuredClone(initialState))
    : null;

  for (const envelope of events) {
    const projected = projectEvent(state, envelope.event, envelope.gameId, map);

    if (!projected.ok) {
      return projected;
    }

    state = projected.value;
  }

  return state === null
    ? { ok: false, error: 'empty event stream' }
    : { ok: true, value: state };
};
```

Lifecycle bootstrap for `gameCreated`:

```typescript
case 'gameCreated': {
  if (state !== null) {
    return { ok: false, error: 'duplicate gameCreated event' };
  }

  const scenario = resolveScenarioByName(event.scenario);

  if (!scenario) {
    return { ok: false, error: `unknown scenario: ${event.scenario}` };
  }

  return {
    ok: true,
    value: migrateGameState(
      createGame(scenario, map, gameId, findBaseHex, () => 0),
    ),
  };
}
```

## Consistency Analysis

**Strengths:**

- The top-level registry is exhaustively typed, so missing event handlers fail at compile time.
- Category-specific projectors keep event logic grouped by domain instead of scattering state mutations across the fold.
- Projection failure is explicit via `Result<T>` rather than exceptions.

**Current gaps:**

- `gameCreated` projection currently ignores the event's `matchSeed` and rebuilds setup with `() => 0`, then depends on later corrective events such as `fugitiveDesignated`.
- `turnAdvanced` projection currently replays player rotation and damage recovery but not turn-advance scenario-rule mutations such as reinforcements or fleet conversion.
- Because projectors mutate the in-progress state object for performance, callers must continue cloning at fold boundaries, which the current implementation correctly does.

## Completeness Check

- The handler registry is structurally complete for the current `EngineEvent` union.
- The next improvement is to make setup and turn-advance projection fully faithful to engine behavior rather than depending on follow-up correction events or scenario rules staying unused.

## Related Patterns

- **Event Sourcing** (01) — this is the replay mechanism for the event stream.
- **Pipeline** (15) — stream projection is a sequential fold pipeline.
- **Parity Check** (32) — the server uses projection output to verify live-state parity.
