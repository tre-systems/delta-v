# State Machine

## Category

Behavioral

## Intent

Model the client's lifecycle as an explicit finite state machine so that only valid phase transitions can occur, the UI always knows what to show, and the input system knows which interactions to allow. Prevent impossible states by encoding every legal game phase as a union member.

## How It Works in Delta-V

The state machine operates at two levels:

### 1. Client State (`phase.ts`)

`ClientState` is a string literal union that enumerates every possible client-side phase:

```
menu -> connecting -> waitingForOpponent -> playing_fleetBuilding
     -> playing_astrogation -> playing_ordnance -> playing_logistics
     -> playing_combat -> playing_movementAnim -> playing_opponentTurn
     -> gameOver
```

Transitions are **derived, not imperative**. The pure function `derivePhaseTransition` examines the authoritative `GameState` (received from the server or computed locally) and produces a `PhaseTransitionPlan` describing what client state to move to, what banner to show, whether to play a sound, and whether to run local AI. The plan is then applied by `applyClientStateTransition`.

### 2. Interaction Mode (`interaction-fsm.ts`)

`deriveInteractionMode` maps `ClientState` to a coarser `InteractionMode` that controls what hex-click and keyboard behaviors are active. This is a pure function with an exhaustive switch and a `never` guard on the default branch, guaranteeing at compile time that every `ClientState` is handled.

### 3. Phase Entry Rules (`phase-entry.ts`)

Each `ClientState` has a corresponding entry in `CLIENT_STATE_ENTRY_RULES`, a record keyed by state. The `deriveClientStateEntryPlan` function looks up the rule for the target state and produces a `ClientStateEntryPlan` describing what side effects the transition requires (start/stop timer, frame camera on ships, enter planning phase, auto-skip combat, trigger tutorial).

### 4. Engine Phase (server-side)

The server engine uses `GameState.phase` (a simpler enum: `fleetBuilding | astrogation | ordnance | logistics | combat | gameOver`). The client maps this authoritative phase into its richer `ClientState` via `derivePhaseTransition`.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/game/phase.ts` | 1-179 | `ClientState` union, `PhaseTransitionPlan`, `derivePhaseTransition` |
| `src/client/game/interaction-fsm.ts` | 1-44 | `InteractionMode` + `deriveInteractionMode` |
| `src/client/game/phase-entry.ts` | 1-159 | `ClientStateEntryPlan` + `CLIENT_STATE_ENTRY_RULES` |
| `src/client/game/state-transition.ts` | 1-115 | `applyClientStateTransition` -- imperative shell |
| `src/client/game/session-model.ts` | 33 | `state: ClientState` as a reactive signal |
| `src/shared/types/domain.ts` | -- | `GameState.phase` server-side phase |

## Code Examples

The client state union (`phase.ts`):

```typescript
export type ClientState =
  | 'menu'
  | 'connecting'
  | 'waitingForOpponent'
  | 'playing_fleetBuilding'
  | 'playing_astrogation'
  | 'playing_ordnance'
  | 'playing_logistics'
  | 'playing_combat'
  | 'playing_movementAnim'
  | 'playing_opponentTurn'
  | 'gameOver';
```

Exhaustive interaction mode derivation (`interaction-fsm.ts`):

```typescript
export const deriveInteractionMode = (state: ClientState): InteractionMode => {
  switch (state) {
    case 'menu':
      return 'menu';
    case 'connecting':
    case 'waitingForOpponent':
      return 'waiting';
    case 'playing_fleetBuilding':
      return 'fleetBuilding';
    case 'playing_astrogation':
      return 'astrogation';
    // ... all cases covered
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
};
```

Data-driven entry rules (`phase-entry.ts`):

```typescript
const CLIENT_STATE_ENTRY_RULES: Record<ClientState, ClientStateEntryRule> = {
  menu: { hideTutorial: true, resetCamera: true },
  playing_astrogation: {
    startTurnTimer: startRemoteTurnTimer,
    frameOnShips: true,
    planningPhase: 'astrogation',
    deriveSelectedShipId: getFirstActionableShipId,
    tutorialPhase: 'astrogation',
  },
  playing_combat: {
    startTurnTimer: startRemoteTurnTimer,
    planningPhase: 'combat',
    deriveSelectedShipId: getFirstActionableShipId,
    autoSkipCombatIfNoTargets: true,
    tutorialPhase: 'combat',
  },
  // ...
};
```

## Consistency Analysis

**Strengths:**

- `ClientState` is the single source of truth for the client's lifecycle position. It is a reactive signal (`session-model.ts`), so all UI, input, and rendering code automatically reacts to transitions.
- The `never` exhaustiveness guard in `deriveInteractionMode` and `applyClientStateTransition` ensures adding a new state without handling it everywhere is a compile error.
- Phase transitions are always derived from authoritative `GameState` data, not from ad-hoc imperative calls. This prevents the client from entering states the server does not support.
- The `CLIENT_STATE_ENTRY_RULES` record is keyed by the full `ClientState` union, guaranteeing every state has an entry rule (even if empty).

**Potential gaps:**

- The `'playing_movementAnim'` state is set directly by the movement animation system rather than being derived from `GameState.phase`. This is necessary because animation is a purely client-side concept, but it means there are two paths into the state machine: derived transitions (from server state) and imperative transitions (from animation start).
- The `connecting` and `waitingForOpponent` states are set imperatively from connection lifecycle code, not from `derivePhaseTransition`. This is appropriate since these pre-game states have no corresponding `GameState`.

**Impossible states:**

- The type system prevents representing states like "in combat but game is over" -- `ClientState` is a flat union, not a product type, so only one phase is active at a time.
- However, there is no compile-time enforcement of which transitions are legal (e.g., `menu` -> `playing_combat` is representable but semantically invalid). Transition validity relies on `derivePhaseTransition` only returning sensible next states.

## Completeness Check

- All game phases from the server engine (`fleetBuilding`, `astrogation`, `ordnance`, `logistics`, `combat`, `gameOver`) have corresponding `ClientState` values.
- Client-only states (`menu`, `connecting`, `waitingForOpponent`, `playing_movementAnim`, `playing_opponentTurn`) cover the full non-gameplay lifecycle.
- Spectator mode is handled by producing `playing_opponentTurn` for most phases when the viewer is not a player.
- A possible improvement would be encoding transition rules as a typed adjacency map (e.g., `Record<ClientState, Set<ClientState>>`) for runtime validation, though the current derive-based approach makes illegal transitions unlikely in practice.

## Related Patterns

- **Command** (08) -- The interaction FSM determines which commands are valid in the current state. `deriveKeyboardAction` checks `ClientState` before producing actions.
- **Derive/Plan** (12) -- `derivePhaseTransition`, `deriveInteractionMode`, and `deriveClientStateEntryPlan` are all pure derive functions. The imperative shell is `applyClientStateTransition`.
- **Reactive Signals** (10) -- `ClientState` is stored as a reactive signal, so effects and computeds automatically respond to transitions.
