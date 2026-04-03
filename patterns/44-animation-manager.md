# Animation Manager

## Category
Client-Specific

## Intent
Separate animation timing and state from game logic, so that movement animations are a purely visual concern that does not affect the authoritative game state. The animation manager tracks animation progress, manages completion callbacks, handles visibility changes, and accumulates trail history independently of the game engine.

## How It Works in Delta-V

The `createMovementAnimationManager()` factory returns a `MovementAnimationManager` that handles ship and ordnance movement animations. The design principles are:

### Animation State Isolation

The `AnimationState` is a separate data structure from `GameState`:

```
AnimationState {
  movements: ShipMovement[]
  ordnanceMovements: OrdnanceMovement[]
  startTime: number
  duration: number
  onComplete: () => void
}
```

The game state is updated to the post-movement state before the animation starts. The animation merely interpolates visual positions along the movement paths. This means the game is always in a consistent state -- the animation is cosmetic.

### Lifecycle

1. **Start**: `start(movements, ordnanceMovements, onComplete)` records trails, sets up animation state with a start time and duration (from `MOVEMENT_ANIM_DURATION`), and schedules a fallback timeout. If the document is hidden, the animation completes immediately (no point animating an invisible tab).

2. **Progress**: `getAnimationProgress(state, now)` returns a 0-to-1 fraction. The renderer queries this to interpolate ship positions along their paths each frame.

3. **Completion**: Either the render loop calls `completeIfElapsed(now)` when enough time has passed, or the fallback timer fires (duration + 500ms safety margin). The `onComplete` callback is invoked, which typically triggers the next game phase.

4. **Visibility change**: If the tab becomes hidden during an animation, `handleVisibilityChange()` completes the animation immediately to prevent the game from getting stuck.

### Trail Accumulation

The manager maintains `shipTrails` and `ordnanceTrails` (both `Map<string, HexCoord[]>`) that accumulate movement paths across turns. New paths are appended with deduplication at the join point (avoiding duplicate hexes where a trail end matches a new path start). Trails are cleared on game reset via `clearTrails()`.

### Dependency Injection for Testing

The factory accepts optional dependencies (`now`, `setTimeout`, `clearTimeout`, `isDocumentHidden`, `durationMs`) allowing full control over timing in tests without real timers.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/renderer/animation.ts` | 6-11 | `AnimationState` interface |
| `src/client/renderer/animation.ts` | 22-37 | `MovementAnimationManager` interface |
| `src/client/renderer/animation.ts` | 86-199 | `createMovementAnimationManager()` factory |
| `src/client/renderer/animation.ts` | 64-72 | `getAnimationProgress()` |
| `src/client/renderer/animation.ts` | 74-84 | `collectAnimatedHexes()` for camera framing |
| `src/client/renderer/animation.ts` | 39-62 | `appendTrailPath()` with deduplication |
| `src/client/renderer/renderer.ts` | 100-105 | Renderer queries animation state |
| `src/client/renderer/renderer.ts` | 404 | `movementAnimation.completeIfElapsed(now)` in render loop |

## Code Examples

Animation start with visibility check and fallback timer:

```typescript
// src/client/renderer/animation.ts
const start = (
  movements: ShipMovement[],
  ordnanceMovements: OrdnanceMovement[],
  onComplete: () => void,
): void => {
  recordTrails(movements, ordnanceMovements);
  clearFallbackTimer();
  animationState = null;

  if (isDocumentHidden()) {
    onComplete();
    return;
  }

  animationState = {
    movements,
    ordnanceMovements,
    startTime: now(),
    duration: durationMs,
    onComplete,
  };

  fallbackTimer = setTimeoutFn(() => {
    fallbackTimer = null;
    completeAnimation();
  }, durationMs + 500);
};
```

Trail path appending with deduplication:

```typescript
// src/client/renderer/animation.ts
const appendTrailPath = (
  trails: Map<string, HexCoord[]>,
  id: string,
  path: HexCoord[],
): void => {
  const existing = trails.get(id);
  if (!existing) {
    trails.set(id, [...path]);
    return;
  }
  const start =
    existing.length > 0 && path.length > 0 &&
    existing[existing.length - 1].q === path[0].q &&
    existing[existing.length - 1].r === path[0].r
      ? 1 : 0;
  for (let i = start; i < path.length; i++) {
    existing.push(path[i]);
  }
};
```

The renderer queries animation state for rendering:

```typescript
// src/client/renderer/renderer.ts
const animState = (): AnimationState | null =>
  movementAnimation.getAnimationState();

// In renderFrame:
const a = animState();
if (a) {
  drawAnimatedMovementPaths(layerCtx, gameState, playerId, a, now, HEX_SIZE);
}
```

## Consistency Analysis

Animation state is properly separated from game state:

- The `GameState` is updated to its post-movement state before `animateMovements()` is called on the renderer.
- The `AnimationState` contains only the movement paths and timing -- it does not duplicate or modify game state.
- Rendering code checks `animState()` to decide whether to draw animated positions or final positions, and several layers (velocity vectors, course previews, base threat zones) are skipped during animation.

The fallback timer and visibility handler ensure the animation always completes, preventing the game from getting stuck in an animation state.

## Completeness Check

The pattern is well-implemented:

- **Timer cleanup**: `clearFallbackTimer()` is called before starting a new animation, preventing timer accumulation.
- **Immediate completion**: If the document is hidden when an animation starts, `onComplete` fires immediately.
- **Mid-animation tab hide**: Completes the animation if the tab becomes hidden.
- **Trail management**: Trails accumulate across turns and are only cleared on game reset, providing visual movement history.
- **Testability**: All timing dependencies are injectable, enabling deterministic tests.

One minor note: the `completeAnimation()` function clears `animationState` before calling `onComplete()`, which is the correct order to prevent re-entrant issues if `onComplete` triggers another animation.

## Related Patterns

- **Canvas Renderer Factory** (Pattern 42): The renderer owns the animation manager and queries it during frame rendering.
- **Camera/Viewport Transform** (Pattern 43): `collectAnimatedHexes()` provides data for `frameCameraOnAnimatedHexes()` to position the camera during animations.
- **Session Model** (Pattern 38): Animation completion callbacks trigger state transitions on the session.
