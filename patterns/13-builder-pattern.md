# Builder

## Category

Behavioral

## Intent

Construct complex data structures (view models, rendering primitives, order lists, map layouts) through dedicated `build*` functions that encapsulate construction logic, validation, and default handling. This keeps construction separate from consumption and ensures each built artifact has a well-defined shape.

## How It Works in Delta-V

Unlike the classic GoF Builder with method chaining, Delta-V uses a **functional builder** approach: standalone `build*` functions that take input data and return a fully formed output. These are pure functions (no side effects, deterministic) that transform domain state into view-layer or protocol-layer data structures.

The builders fall into several categories:

### 1. Rendering View Builders

Functions in `src/client/renderer/` that transform game state into rendering primitives (pixel coordinates, colors, line styles). The renderer calls these builders each frame, then passes the result to Canvas drawing functions.

### 2. UI View Builders

Functions in `src/client/ui/` that transform game state and client state into UI-ready data (button visibility, text content, screen visibility).

### 3. Order/Protocol Builders

Functions that assemble player orders from planning state for submission to the game engine.

### 4. Map/Asset Builders

Functions that construct the solar system map, fleet purchases, and other game setup data.

## Key Locations

### Rendering builders (`src/client/renderer/`)

| File | Function | Builds |
|------|----------|--------|
| `vectors.ts` | `buildDetectionRangeViews` | Circle overlays for detection ranges |
| `vectors.ts` | `buildVelocityVectorViews` | Arrow views for ship velocity |
| `vectors.ts` | `buildShipTrailViews` | Trail line views |
| `vectors.ts` | `buildOrdnanceTrailViews` | Ordnance trail views |
| `vectors.ts` | `buildBaseThreatZoneViews` | Base threat zone overlays |
| `vectors.ts` | `buildMovementPathViews` | Movement path preview views |
| `course.ts` | `buildAstrogationCoursePreviewViews` | Course preview overlays |
| `entities.ts` | `buildShipLabelView` | Ship name label views |
| `combat-fx.ts` | `buildCombatEffectsForResults` | Combat visual effects |
| `map.ts` | `buildBodyView`, `buildBaseMarkerView`, `buildMapBorderView`, `buildAsteroidDebrisView`, `buildLandingObjectiveView` | Map element views |
| `minimap.ts` | `buildMinimapSceneView` | Minimap scene data |
| `toast.ts` | `buildCombatResultToastLines` | Combat result toast text |

### UI builders (`src/client/ui/`)

| File | Function | Builds |
|------|----------|--------|
| `hud.ts` | `buildHUDView` | Complete HUD state (buttons, text, visibility) |
| `screens.ts` | `buildScreenVisibility` | Screen display states |
| `screens.ts` | `buildWaitingScreenCopy` | Waiting screen text |
| `screens.ts` | `buildGameOverView` | Game over screen content |
| `screens.ts` | `buildReconnectView` | Reconnect overlay content |
| `screens.ts` | `buildRematchPendingView` | Rematch pending view |
| `ship-list.ts` | `buildShipListView` | Ship list panel content |

### Order builders

| File | Function | Builds |
|------|----------|--------|
| `astrogation-orders.ts` | `buildAstrogationOrders` | `AstrogationOrder[]` from planning state |
| `combat.ts` | `buildCurrentAttack` | `CombatAttack` from combat planning state |
| `session-links.ts` | `buildGameRoute`, `buildJoinCheckUrl`, `buildWebSocketUrl` | URL strings |

### Infrastructure builders

| File | Function | Builds |
|------|----------|--------|
| `map-layout.ts` | `buildSolarSystemMap` | `SolarSystemMap` from definitions |
| `hud-chrome-input.ts` | `buildHudChromeInputFromViewModel` | HUD chrome input from view model |
| `ai/fleet.ts` | `buildAIFleetPurchases` | AI fleet purchase list |

## Code Examples

Rendering view builder (`map.ts`):

```typescript
export const buildBodyView = (
  body: CelestialBody,
  hexSize: number,
  now: number,
) => {
  const center = hexToPixel(body.center, hexSize);
  const radius = body.renderRadius * hexSize;
  const ripples = computeRipples(body, hexSize, now);
  return {
    center,
    radius,
    label: body.name,
    labelY: center.y + radius + 18,
    ripples,
    glowStops: computeGlowStops(body),
    coreColor: computeCoreColor(body),
    edgeColor: computeEdgeColor(body),
  };
};
```

Order builder (`astrogation-orders.ts`):

```typescript
export const buildAstrogationOrders = (
  state: GameState,
  playerId: PlayerId | -1,
  planning: AstrogationOrdersPlanningSnapshot,
): AstrogationOrder[] => {
  if (playerId < 0) return [];
  const pid = playerId as PlayerId;
  return getOrderableShipsForPlayer(state, pid)
    .filter(isOrderableShip)
    .map((ship) => {
      const burn = planning.burns.get(ship.id) ?? null;
      const overload = planning.overloads.get(ship.id) ?? null;
      const order: AstrogationOrder = { shipId: ship.id, burn, overload };
      if (planning.landingShips.has(ship.id)) order.land = true;
      if (weakGravityChoices) order.weakGravityChoices = weakGravityChoices;
      return order;
    });
};
```

UI view builder (`screens.ts` excerpt pattern):

```typescript
export const buildScreenVisibility = (
  mode: UIScreenMode,
  interactionMode: InteractionMode,
  hasGameState: boolean,
): UIScreenVisibility => {
  return {
    menu: mode === 'menu' ? 'flex' : 'none',
    scenario: mode === 'scenario' ? 'flex' : 'none',
    waiting: mode === 'waiting' ? 'flex' : 'none',
    hud: mode === 'hud' ? 'block' : 'none',
    // ...
  };
};
```

## Consistency Analysis

**Strengths:**

- The `build*` naming convention is used consistently across ~30+ functions, making them immediately identifiable.
- All builders are pure functions: they take inputs and return new objects without side effects.
- Rendering builders return view-layer types (`CircleOverlayView`, `TrailView`, `VelocityVectorView`, etc.) that are consumed by Canvas drawing functions. This cleanly separates data construction from rendering.
- The rendering architecture follows a "build then draw" pattern: `buildBodyView` computes positions and styles, then `renderBodies` in `scene.ts` draws them. This makes view computation testable without a Canvas.

**Consistency gaps:**

- Some builder-like functions use `derive*` naming instead (e.g., `deriveHudViewModel` could arguably be `buildHudViewModel`). The distinction is that `derive*` typically computes a decision or plan while `build*` constructs a data structure. `deriveHudViewModel` straddles this line since it both computes derived state and builds a view model.
- `buildHudChromeInputFromViewModel` transforms one view model to another, which is more of a mapping than a building operation. The name is still clear though.
- The `create*` naming convention (e.g., `createPlanningStore`, `createInputHandler`, `createRenderer`) is used for stateful object construction, distinct from `build*` which produces immutable data. This is a good separation.

**Recommendations:**

- The boundary between `build*` and `derive*` could be clarified: `build*` for constructing data structures, `derive*` for computing decisions/transitions.
- Some inline object construction in rendering code could be extracted into named builders for testability.

## Completeness Check

- Every rendering layer (vectors, entities, map, minimap, combat effects, toasts, courses) uses builders.
- All UI screens (waiting, game over, reconnect, rematch, HUD) have corresponding builders.
- Game protocol data (orders, attacks, URLs) has builders.
- Game setup (map, fleet) has builders.
- The pattern is most dense in `src/client/renderer/` (15+ builders) and `src/client/ui/` (7+ builders).
- No builder function appears to have side effects, maintaining the purity guarantee.

## Related Patterns

- **Derive/Plan** (12) -- `derive*` and `build*` are complementary: derive computes what to do, build constructs the data to do it with. Some functions blur the line.
- **Pipeline** (15) -- Builders are often stages in a pipeline: build view data, then draw/render it.
- **Visitor** (14) -- Event projection builds new game state from events, similar to how builders construct data from inputs.
