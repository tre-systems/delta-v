# Viewer-Aware Filtering

## Category

Protocol & Communication

## Intent

Prevent information leakage by filtering the authoritative `GameState` before it reaches each player or spectator. Different viewers see different subsets of game data based on what their role permits, while the server always holds the complete truth.

## How It Works in Delta-V

The `filterStateForPlayer` function in `resolve-movement.ts` accepts a `GameState` and a `ViewerId` (which is either a `PlayerId` number or the string `'spectator'`). It strips hidden information from the state before the server serialises and sends it.

Currently the primary hidden information is **ship identity** in escape scenarios. Ships in the escape scenario have an `identity` field with `{ hasFugitives: boolean; revealed: boolean }`. The filtering rules are:

1. If the scenario does not use hidden identity rules and no ships have identity fields, the function returns the original state object by reference (zero-cost no-op).
2. For **player viewers**: own ships keep their identity; opponent ships with unrevealed identity have the `identity` field stripped entirely.
3. For **spectators**: all unrevealed identities are stripped. Only revealed identities remain visible.

The server broadcast layer in `broadcast.ts` calls filtering at the point of transmission. `broadcastFilteredMessage` checks whether the state has hidden information. If not, it falls back to a single `broadcastMessage` call. If yes, it iterates over player sockets (found via Durable Object WebSocket tags like `player:0`, `player:1`) and spectator sockets, creating a filtered copy for each group.

## Key Locations

- `src/shared/engine/resolve-movement.ts` (lines 30-60) -- `filterStateForPlayer`, `ViewerId`
- `src/server/game-do/broadcast.ts` (lines 31-80) -- `broadcastFilteredMessage`
- `src/shared/engine/viewer-filter.test.ts` -- comprehensive test suite
- `src/server/game-do/projection.ts` -- replay projection also uses filtering

## Code Examples

The core filtering function:

```typescript
export type ViewerId = number | 'spectator';

export const filterStateForPlayer = (
  state: GameState,
  viewer: ViewerId,
): GameState => {
  if (
    !usesEscapeInspectionRules(state) &&
    !state.ships.some((s) => s.identity?.hasFugitives)
  ) {
    return state;
  }
  return {
    ...state,
    ships: state.ships.map((ship) => {
      if (viewer === 'spectator') {
        if (ship.identity?.revealed) return ship;
        const { identity, ...rest } = ship;
        return rest;
      }
      if (ship.owner === viewer) return ship;
      if (ship.identity?.revealed) return ship;
      const { identity, ...rest } = ship;
      return rest;
    }),
  };
};
```

Server-side per-viewer broadcast:

```typescript
export const broadcastFilteredMessage = (
  sockets: { getWebSockets: (tag?: string) => WebSocket[] },
  msg: S2C & { state: GameState },
) => {
  const hasHiddenInfo =
    msg.state.scenarioRules.hiddenIdentityInspection ||
    msg.state.ships.some((ship) => ship.identity && !ship.identity.revealed);

  if (!hasHiddenInfo) {
    broadcastMessage(sockets, msg);
    return;
  }

  for (let playerId = 0; playerId < 2; playerId++) {
    const playerSockets = sockets.getWebSockets(`player:${playerId}`);
    if (playerSockets.length === 0) continue;
    const filteredMessage = {
      ...msg,
      state: filterStateForPlayer(msg.state, playerId),
    };
    const data = JSON.stringify(filteredMessage);
    for (const ws of playerSockets) {
      try { ws.send(data); } catch {}
    }
  }
  // spectator sockets get spectator-filtered state ...
};
```

## Consistency Analysis

Filtering is applied in all three broadcast contexts: live game broadcasts (`broadcastFilteredMessage`), replay projection, and AI flow. The test suite covers player 0, player 1, spectator, revealed identity, and the no-op fast path.

The early return (reference equality) when no hidden info exists is a smart performance optimisation -- most scenarios never use identity, so no cloning occurs.

One gap: the filtering only handles `identity` stripping today. If future scenarios add fog-of-war (e.g., hiding ship positions), the function would need extension. The current structure makes this straightforward since it is a single chokepoint.

## Completeness Check

- **Fog of war**: Not yet implemented. The architecture supports it since all state flows through `filterStateForPlayer`, but the function currently only handles identity.
- **Spectator delay**: There is no time-delay for spectator filtering. A spectator sees the same timing as players, which could theoretically be exploited in a competitive context.
- **Replay filtering**: Replay timelines also pass through filtering, ensuring archived games do not leak hidden state.

## Related Patterns

- **47 -- Discriminated Union Messages**: Filtering is applied to the `state` field of S2C state-bearing messages.
- **48 -- Single State-Bearing Message**: Because each message carries full state, filtering only needs to run once per message per viewer group.
- **50 -- Hibernatable WebSocket**: Socket tags (`player:0`, `spectator`) are used to route filtered messages.
