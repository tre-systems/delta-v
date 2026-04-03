# Camera/Viewport Transform

## Category
Client-Specific

## Intent
Centralize all coordinate transforms between screen space and world space into a single camera object, so that input handling, rendering, and UI positioning all share one consistent view transformation. This prevents raw pixel calculations from being scattered across the codebase and ensures zoom, pan, and shake effects are applied uniformly.

## How It Works in Delta-V

The `createCamera()` factory returns a `Camera` object that maintains:

- **Current position** (`x`, `y`) and **zoom level** (`zoom`) -- smoothly interpolated.
- **Target position** (`targetX`, `targetY`) and **target zoom** (`targetZoom`) -- set by game logic, lerped toward by `update()`.
- **Shake state** -- intensity and decay for screen-shake effects.
- **Canvas dimensions** (`canvasW`, `canvasH`) -- updated each frame for centering.

The camera provides these core operations:

1. **`applyTransform(ctx)`** -- Translates the canvas context to center the viewport, applies zoom, and offsets by camera position plus shake. All world-space rendering happens between `ctx.save()` and `ctx.restore()` with this transform active.

2. **`screenToWorld(sx, sy)`** -- Converts screen pixel coordinates to world coordinates: `(sx - canvasW/2) / zoom + x`. Used by the input handler to determine which hex the player clicked.

3. **`worldToScreen(wx, wy)`** -- Inverse of `screenToWorld`. Used for UI overlays that need to position elements relative to world objects.

4. **`zoomAt(sx, sy, factor)`** -- Zooms toward a screen point (mouse cursor or pinch center), adjusting the target position so the point under the cursor stays fixed. Clamps to `[minZoom, maxZoom]`.

5. **`pan(dx, dy)`** -- Adjusts target position by screen-space deltas divided by zoom, for drag panning.

6. **`frameBounds(minX, maxX, minY, maxY, padding)`** -- Centers the camera on a bounding box and computes the zoom level needed to fit it on screen.

7. **`isVisible(wx, wy, margin)`** -- Culling test: returns whether a world-space point is within the visible viewport plus a margin. Used by rendering functions to skip off-screen hexes.

8. **`shake(intensity, decay)`** -- Triggers screen shake for combat hits or game-over effects.

9. **`snapToTarget()`** -- Instantly jumps to target position/zoom without interpolation. Used for initial camera setup.

The `update(dt, canvasW, canvasH)` method is called once per frame and:
- Stores current canvas dimensions.
- Lerps position and zoom toward targets using `CAMERA_LERP_SPEED`.
- Steps shake decay.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/renderer/camera.ts` | 8-33 | `Camera` interface |
| `src/client/renderer/camera.ts` | 77-167 | `createCamera()` factory |
| `src/client/renderer/camera.ts` | 44-52 | `lerpTowardTargets()` |
| `src/client/renderer/camera.ts` | 54-65 | `stepShake()` |
| `src/client/renderer/camera.ts` | 67-75 | `applyCameraTransform()` |
| `src/client/renderer/renderer.ts` | 251-252 | `camera.applyTransform(layerCtx)` in render frame |
| `src/client/input.ts` | 67-68 | `camera.screenToWorld(screenX, screenY)` for input |
| `src/client/input.ts` | 59-60 | `camera.targetX/targetY` for minimap navigation |

## Code Examples

Screen-to-world conversion:

```typescript
// src/client/renderer/camera.ts
screenToWorld: (sx: number, sy: number): PixelCoord => ({
  x: (sx - p.canvasW / 2) / c.zoom + c.x,
  y: (sy - p.canvasH / 2) / c.zoom + c.y,
}),
```

Zoom-at-point preserving the point under cursor:

```typescript
// src/client/renderer/camera.ts
zoomAt: (sx: number, sy: number, factor: number): void => {
  const newZoom = clamp(c.targetZoom * factor, c.minZoom, c.maxZoom);
  const worldX = (sx - p.canvasW / 2) / c.targetZoom + c.targetX;
  const worldY = (sy - p.canvasH / 2) / c.targetZoom + c.targetY;
  c.targetZoom = newZoom;
  c.targetX = worldX - (sx - p.canvasW / 2) / newZoom;
  c.targetY = worldY - (sy - p.canvasH / 2) / newZoom;
},
```

Visibility culling used by hex grid rendering:

```typescript
// src/client/renderer/renderer.ts
renderHexGridFn(layerCtx, map, HEX_SIZE, (x, y) =>
  camera.isVisible(x, y),
);
```

Applying the transform in the render loop:

```typescript
// src/client/renderer/renderer.ts
layerCtx.save();
camera.applyTransform(layerCtx);
// ... all world-space drawing ...
layerCtx.restore();
```

## Consistency Analysis

All coordinate transforms go through the camera:

- **Input handling** (`input.ts`): Uses `camera.screenToWorld()` for hex click resolution.
- **Rendering** (`renderer.ts`): Uses `camera.applyTransform()` for all world-space drawing and `camera.isVisible()` for culling.
- **Static scene caching** (`static-scene.ts`): Applies `camera.applyTransform()` to the offscreen canvas context.
- **Minimap**: The minimap has its own projection (`minimap.ts`) which is separate from the camera because it renders a scaled-down view, but minimap clicks are resolved back to camera target coordinates.
- **Camera control commands**: The command router's `panCamera` and `zoomCamera` handlers go through `camera.pan()` and `camera.zoomAt()`.

**No raw pixel calculations** were found outside the camera for screen/world conversion. The `hexToPixel` and `pixelToHex` functions in `shared/hex.ts` convert between hex coordinates and pixel coordinates in world space, which is the correct abstraction level -- they do not deal with screen space.

## Completeness Check

The camera implementation is clean and complete:

- **Private state** (`CameraPrivate`) is separate from the public interface, preventing external access to canvas dimensions and shake offsets.
- **Lerp smoothing** provides smooth camera movement without abrupt jumps.
- **Shake effect** decays over time and is additive to the camera position.
- **Zoom clamping** prevents extreme zoom levels.
- **Frame bounds** computation correctly computes the minimum zoom to fit a bounding box.

One observation: the `isVisible` culling uses a simple rectangular check with margin, which is appropriate for a flat hex grid. If the game ever needed rotated or perspective views, this would need updating.

## Related Patterns

- **Canvas Renderer Factory** (Pattern 42): The renderer creates and owns the camera.
- **3-Layer Input Pipeline** (Pattern 41): Layer 1 uses the camera for coordinate conversion.
- **Animation Manager** (Pattern 44): Camera framing (`frameCameraOnAnimatedHexes`) positions the camera to show movement animations.
