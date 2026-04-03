# Composite

## Category

Structural

## Intent

Compose a complex rendered scene from multiple independent drawing layers that are painted in a fixed order onto a single canvas, so that each layer can be developed, tested, and reasoned about in isolation while the final frame is a straightforward sequential composition of all layers.

## How It Works in Delta-V

The renderer (`renderer.ts`) paints a complete game frame by calling a series of layer-drawing functions in a specific order within `renderFrame`. Each layer is a pure or near-pure function that takes a `CanvasRenderingContext2D`, the current game state, and layer-specific parameters, then draws its content. The layers do not communicate with each other -- they all read from the same shared state and paint onto the same canvas context.

The composition is organized into three coordinate spaces:

### 1. Static Scene Layer (cached, world-space)

The first layer rendered is the static scene, which is drawn to an offscreen canvas and cached using a key-based invalidation scheme. This layer contains elements that change infrequently:

- **Stars** (`renderStars`) -- Background star field
- **Hex grid** (`renderHexGrid`) -- The game board
- **Asteroids** (`renderAsteroids`) -- Destructible terrain
- **Gravity indicators** (`renderGravityIndicators`) -- Directional arrows
- **Bodies** (`renderBodies`) -- Planets and suns with glow effects

The cache key is computed from camera position, zoom, canvas dimensions, a time bucket (for body animation), and destroyed asteroid state. If the key matches the previous frame, the cached bitmap is blitted directly, skipping all five sub-layer draws.

### 2. Dynamic World-Space Layers (per-frame, camera-transformed)

After the static layer, the renderer applies the camera transform and paints dynamic content in order:

- **Map border** (`renderMapBorder`) -- Pulsing boundary indicator
- **Base markers** (`renderBaseMarkers`) -- Orbital base diamonds
- **Landing target** (`renderLandingTarget`) -- Objective ring/markers
- **Threat zones** (`drawBaseThreatZones`) -- Semi-transparent danger areas
- **Detection ranges** (`renderDetectionRanges`) -- Sensor range circles
- **Velocity vectors** (`drawVelocityVectorLayer`) -- Ship velocity arrows
- **Course preview** (`drawAstrogationCoursePreviewLayer`) -- Planned movement paths
- **Ordnance** (`renderOrdnance`) -- Torpedoes, mines, nukes with animations
- **Torpedo guidance** (`renderTorpedoGuidance`) -- Aiming UI overlay
- **Combat overlay** (`renderCombatOverlay`) -- Attack lines and odds display
- **Trails** (`drawShipAndOrdnanceTrails`) -- Historical movement trails
- **Animated paths** (`drawAnimatedMovementPaths`) -- In-progress movement animation
- **Ships** (`drawShipsLayer`) -- Ship icons with decorations
- **Hex flashes** (`drawHexFlashes`) -- Transient flash effects
- **Combat effects** (`drawCombatEffects`) -- Beam and explosion animations

### 3. Screen-Space Overlays (no camera transform)

After restoring the canvas context, screen-space overlays are painted:

- **Screen flash** (`drawScreenFlash`) -- Full-screen color flash for dramatic events
- **Toast notifications** (`drawToasts`) -- Combat result and movement event popups
- **Minimap** (`drawMinimapOverlay`) -- Corner minimap with ship positions

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/renderer/renderer.ts` | 226-386 | `renderFrame` -- the composite orchestrator |
| `src/client/renderer/static-scene.ts` | 17-51 | `repaintStaticLayer` -- cached static sub-composite |
| `src/client/renderer/static-scene.ts` | 53-99 | `drawStaticSceneWithCache` -- cache-or-blit logic |
| `src/client/renderer/static-layer.ts` | 1-67 | `StaticSceneLayer` type and cache key computation |
| `src/client/renderer/scene.ts` | all | Static scene drawing functions |
| `src/client/renderer/ships.ts` | 61-90 | `drawShipsLayer` |
| `src/client/renderer/overlay.ts` | all | Ordnance, torpedo guidance, combat overlay layers |
| `src/client/renderer/trails.ts` | all | Ship and ordnance trail layers |
| `src/client/renderer/effects.ts` | all | Combat effects and hex flash layers |
| `src/client/renderer/minimap-draw.ts` | all | Minimap overlay layer |
| `src/client/renderer/toast-draw.ts` | all | Toast notification overlay layer |

## Code Examples

The composite orchestrator in `renderFrame`:

```ts
const renderFrame = (
  now: number,
  w = canvas.clientWidth,
  h = canvas.clientHeight,
): void => {
  const layerCtx = ctx;
  layerCtx.fillStyle = '#08081a';
  layerCtx.fillRect(0, 0, w, h);

  // Layer 1: Static scene (cached offscreen)
  let renderedStatic = false;
  if (map) {
    renderedStatic = drawStaticSceneWithCache({
      mainCtx: layerCtx,
      layerRef: staticLayerRef,
      now, width: w, height: h,
      camera, map, gameState, stars, hexSize: HEX_SIZE,
    });
  }

  layerCtx.save();
  camera.applyTransform(layerCtx);

  // Layer 2+: Dynamic world-space layers
  if (map) {
    if (!renderedStatic) {
      // Fallback: draw static elements directly if cache unavailable
      renderStarsFn(layerCtx, stars, camera.zoom);
      renderHexGridFn(layerCtx, map, HEX_SIZE, (x, y) =>
        camera.isVisible(x, y));
      // ...
    }
    if (gameState) {
      renderMapBorderFn(layerCtx, map, gameState, playerId, HEX_SIZE, now);
    }
    // ... more world-space layers ...
    drawShipsLayer({ ctx: layerCtx, state: gameState, /* ... */ });
    hexFlashes = drawHexFlashes(layerCtx, hexFlashes, now, HEX_SIZE);
    combatEffects = drawCombatEffects(layerCtx, combatEffects, now);
  }

  layerCtx.restore();

  // Layer 3: Screen-space overlays
  drawScreenFlash(layerCtx, now, w, h);
  drawToasts(layerCtx, now, w);
  if (map && gameState) {
    drawMinimapOverlay({ ctx: layerCtx, map, state: gameState, /* ... */ });
  }
};
```

The static scene cache mechanism:

```ts
export const drawStaticSceneWithCache = (input: {
  mainCtx: CanvasRenderingContext2D;
  layerRef: { layer: StaticSceneLayer | null };
  // ...
}): boolean => {
  const key = computeStaticSceneLayerKey({
    map: input.map, camera: input.camera,
    gameState: input.gameState, now: input.now,
    width: input.width, height: input.height,
  });
  if (key === null) return false;

  let layer = input.layerRef.layer;
  if (!layer || layer.width !== input.width || layer.height !== input.height) {
    layer = createStaticSceneLayer(input.width, input.height);
    input.layerRef.layer = layer;
  }
  if (!layer) return false;

  if (layer.key !== key) {
    repaintStaticLayer(layer, { /* ... */ });
    layer.key = key;
  }
  input.mainCtx.drawImage(layer.canvas as CanvasImageSource, 0, 0);
  return true;
};
```

Individual layers are pure functions with focused responsibilities:

```ts
// effects.ts -- returns filtered array, pruning expired effects
export const drawCombatEffects = (
  ctx: CanvasRenderingContext2D,
  effects: CombatEffect[],
  now: number,
): CombatEffect[] => {
  const live = effects.filter((e) => now < e.startTime + e.duration);
  for (const effect of live) {
    // draw beam, explosion, or gameOverExplosion based on type
  }
  return live;
};
```

## Consistency Analysis

The composite pattern is applied consistently with a few notable characteristics:

**Consistent aspects:**
- Every layer function follows the same signature pattern: takes a `CanvasRenderingContext2D` as the first parameter, game state and configuration as subsequent parameters, and returns void (or a filtered array for effect layers).
- Layer functions are organized into dedicated files by concern: `scene.ts` for static map elements, `ships.ts` for ship rendering, `overlay.ts` for gameplay overlays, `trails.ts` for movement trails, `effects.ts` for combat effects, `minimap-draw.ts` for the minimap.
- The paint order is deterministic -- later layers paint over earlier ones, which gives a natural z-ordering.
- Layer functions are extracted as pure functions with no shared mutable state between them. Each reads from the same `gameState` and `map` but does not write to them.

**Inconsistencies:**
- Some layers are conditional on animation state (`drawBaseThreatZones` and `drawCourseLayers` bail out if `animState()` is truthy), while others handle the animation case internally (e.g. `drawShipsLayer` adjusts position interpolation when animating). The "am I animating?" check is not uniformly placed.
- The `drawHexFlashes` and `drawCombatEffects` functions return their pruned arrays, and the caller must reassign the local variable. Other layers are fire-and-forget void functions. This creates a slight inconsistency in how the composite orchestrator interacts with effect layers versus static layers.
- The minimap is drawn in `minimap-draw.ts` via `drawMinimapOverlay`, but the minimap view model is built in a separate `minimap.ts` file. Other layers tend to keep their view-model building and drawing in the same file or in closely paired files.

## Completeness Check

**Strengths:**
- The static scene cache is a well-implemented optimization. The key-based invalidation avoids expensive redraws when the camera has not moved and no state has changed.
- The fallback path (drawing static elements directly when the cache is unavailable) ensures the renderer works even in environments without `OffscreenCanvas`.
- The layer decomposition makes it easy to add new visual elements -- a new layer function can be inserted at the appropriate z-order position in `renderFrame` without modifying existing layers.
- Per-frame camera visibility culling (`camera.isVisible`) is passed as a callback to static layers, keeping the culling concern out of the drawing logic.

**Potential improvements:**
- **No formal layer abstraction.** Layers are just functions called in sequence. A more formal composite pattern could define a `RenderLayer` interface with `draw(ctx, state, now)` and iterate over an array of layers. This would make it easier to add/remove/reorder layers and could support per-layer debug toggling.
- **Coupled animation state.** Several layers check `animState()` and change behavior based on whether an animation is playing. This shared dependency on animation state creates implicit coupling between layers. Extracting animation state into a formal render context passed to all layers would make this coupling explicit.
- **The `renderFrame` function is long (~160 lines).** While each layer call is a single function invocation, the orchestrator accumulates conditionals (`if (map)`, `if (gameState)`, `if (gameState && map)`) that add complexity. Grouping related layers into sub-composites (as `drawStaticSceneWithCache` does for static elements) could reduce the orchestrator's complexity.
- **Effect lifetime management is spread.** `combatEffects` and `hexFlashes` are managed as mutable arrays in the renderer closure, updated by the return values of their draw functions. `combatResults` and `movementEvents` are managed separately with time-based expiry in `drawToasts`. A unified effect lifecycle manager could simplify this.

## Related Patterns

- **Proxy / Lazy Evaluation (pattern 18):** The static scene cache (`drawStaticSceneWithCache`) is a lazy-evaluation technique applied to rendering -- the scene is only repainted when the cache key changes, otherwise the cached bitmap is reused.
- **Facade (pattern 17):** `createRenderer` acts as a facade over the composite layer system, exposing a simple API (`setGameState`, `animateMovements`, `showCombatResults`) while hiding the 20+ layer functions and their orchestration.
- **Adapter (pattern 16):** The renderer is created by the game client facade and receives state updates through adapter-mediated transport -- the transport resolves a game state, which flows through the facade into `renderer.setGameState`, which then affects what all composite layers draw.
- **Strategy:** Individual layer functions can be seen as strategies -- the renderer delegates "draw the ships" to `drawShipsLayer`, "draw combat effects" to `drawCombatEffects`, etc. Each strategy encapsulates its own drawing logic.
