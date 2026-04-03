# Canvas Renderer Factory

## Category
Client-Specific

## Intent
Organize the 2D canvas rendering pipeline as a factory function that composes multiple drawing layers (static scene, ships, trails, effects, overlays, minimap) into a single animation loop, while keeping each layer's rendering logic in its own module. The factory owns the render loop and exposes a clean API for game state updates, animation triggers, and camera control.

## How It Works in Delta-V

The `createRenderer(canvas, planningState)` factory function in `renderer.ts` returns a `Renderer` object that encapsulates the entire rendering pipeline. The design has several key aspects:

### Layer Composition

Each frame is drawn by composing multiple rendering layers in a specific order:

1. **Background fill** -- dark space color
2. **Static scene layer** (cached) -- stars, hex grid, asteroids, gravity indicators, celestial bodies. Cached on an offscreen canvas and redrawn only when camera/state changes.
3. **Camera transform** -- all subsequent layers draw in world coordinates
4. **Map border and base markers** -- phase-dependent map decorations
5. **Base threat zones** -- enemy base detection zones (skipped during animation)
6. **Detection ranges** -- sensor ranges for selected ships
7. **Velocity vectors and course previews** -- astrogation planning visualization
8. **Ordnance and torpedo guidance** -- missile positions and targeting
9. **Combat overlay** -- attack lines and strength indicators
10. **Trails** -- ship and ordnance movement history
11. **Animated movement paths** -- during movement animation phase
12. **Ships layer** -- ship icons with selection highlights
13. **Hex flashes and combat effects** -- transient visual effects
14. **Camera restore** -- back to screen coordinates
15. **Screen flash** -- full-screen alpha flash for game events
16. **Toast overlays** -- combat results and movement event notifications
17. **Minimap** -- overview map in corner

### Static Scene Caching

The `drawStaticSceneWithCache()` function renders hex grids, stars, asteroids, gravity indicators, and bodies to an offscreen canvas (`StaticSceneLayer`). A cache key composed of camera position/zoom, canvas dimensions, body animation bucket, and destroyed asteroids determines when to repaint. This avoids re-rendering thousands of hexes every frame.

### Animation Loop

The `loop()` function runs via `requestAnimationFrame`, computing delta time, checking for canvas resize, updating the camera, rendering the frame, and completing elapsed animations.

### Module Organization

Each rendering concern lives in its own file:

- `scene.ts` -- stars, hex grid, bodies, gravity, asteroids, map border, base markers, detection ranges, landing targets
- `ships.ts` -- ship icon rendering with stacking and selection
- `trails.ts` -- ship and ordnance movement trails
- `overlay.ts` -- ordnance, torpedo guidance, combat overlays
- `course-draw.ts` -- astrogation course preview
- `vel-draw.ts` -- velocity vector layer
- `effects.ts` -- combat effects and hex flashes
- `toast-draw.ts` -- combat results and movement event toasts
- `minimap-draw.ts` -- minimap overlay
- `draw.ts` -- low-level shape drawing utilities
- `text.ts` -- font scaling
- `combat-fx.ts` -- combat effect generation
- `frame.ts` -- camera framing helpers
- `static-scene.ts` -- static layer caching logic
- `static-layer.ts` -- offscreen canvas creation and key computation

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/renderer/renderer.ts` | 69-553 | `createRenderer()` factory |
| `src/client/renderer/renderer.ts` | 226-386 | `renderFrame()` -- layer composition |
| `src/client/renderer/renderer.ts` | 388-406 | `loop()` -- animation loop |
| `src/client/renderer/static-scene.ts` | 1-100 | Static scene caching |
| `src/client/renderer/static-layer.ts` | 1-67 | Offscreen canvas and cache key |
| `src/client/renderer/scene.ts` | 1+ | Individual scene drawing functions |
| `src/client/renderer/ships.ts` | 1+ | Ship rendering |
| `src/client/renderer/overlay.ts` | 1+ | Combat/ordnance overlays |

## Code Examples

The renderer factory returns a public API:

```typescript
// src/client/renderer/renderer.ts
return {
  canvas,
  camera,
  setMap: (next: SolarSystemMap) => { map = next; invalidateStatic(); },
  setGameState: (state: GameState | null) => { gameState = state; },
  setPlayerId: (id: number) => { playerId = id as PlayerId; },
  clearTrails: () => { movementAnimation.clearTrails(); },
  animateMovements: (movements, ordnanceMovements, onComplete) => { /* ... */ },
  showCombatResults: (results, previousState) => { /* ... */ },
  showMovementEvents: (events) => { /* ... */ },
  showLandingEffect: (hex) => { /* ... */ },
  triggerGameOverEffect: (won) => { /* ... */ },
  isAnimating: () => movementAnimation.isAnimating(),
  resetCamera: () => { /* ... */ },
  centerOnHex: (hex) => { /* ... */ },
  frameOnShips: () => { /* ... */ },
  start: () => { resize(); /* start loop */ },
};
```

Static layer cache key computation:

```typescript
// src/client/renderer/static-layer.ts
export const computeStaticSceneLayerKey = (input: {
  map: SolarSystemMap | null;
  camera: Camera;
  gameState: GameState | null;
  now: number;
  width: number;
  height: number;
}): string | null => {
  const bodyAnimationBucket = Math.floor(input.now / 250);
  const destroyedAsteroids = input.gameState?.destroyedAsteroids.join('|') ?? '';
  return [
    input.width, input.height,
    input.camera.x.toFixed(2), input.camera.y.toFixed(2),
    input.camera.zoom.toFixed(4),
    bodyAnimationBucket, destroyedAsteroids,
  ].join(':');
};
```

## Consistency Analysis

All rendering goes through the `createRenderer` factory and its `renderFrame` function. No rendering was found outside this pipeline:

- **Ships, ordnance, trails, effects, overlays, minimap** -- all drawn within `renderFrame()`.
- **Static scene elements** -- drawn either via the cache or as a fallback within `renderFrame()`.
- **Toast overlays** -- drawn after the camera restore, in screen coordinates.

Each rendering module exports pure drawing functions that receive a `CanvasRenderingContext2D` and data, making them independently testable. The renderer module imports these and orchestrates calling order.

The `renderFrameForTests` method exposes the frame rendering for test use without starting the animation loop.

## Completeness Check

The layer composition is thorough and well-ordered. Observations:

- **The `document.addEventListener('visibilitychange', ...)` at line 107** is added without a corresponding removal. Since the renderer lives for the lifetime of the application, this is acceptable but noted.
- **The `window.addEventListener('resize', resize)` at line 542** is similarly permanent. No `removeEventListener` is provided -- acceptable for an app-lifetime renderer.
- **OffscreenCanvas fallback**: `static-layer.ts` gracefully falls back to a regular canvas if `OffscreenCanvas` is unavailable, ensuring browser compatibility.
- **The `HEX_SIZE` constant** (28) is defined in `renderer.ts` and imported by other modules that need it, keeping the hex scale centralized.

## Related Patterns

- **Camera/Viewport Transform** (Pattern 43): The renderer owns the camera and applies its transform each frame.
- **Animation Manager** (Pattern 44): The renderer owns the `MovementAnimationManager` and queries its state during rendering.
- **Planning Store** (Pattern 37): The renderer reads `planningState` for course preview and combat overlay rendering.
- **3-Layer Input Pipeline** (Pattern 41): The input handler uses the renderer's camera for coordinate conversion.
