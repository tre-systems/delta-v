# Data-Driven Maps

## Category

Scenario & Configuration

## Intent

Define the solar system map as a data structure built from declarative body definitions rather than hand-placing every hex. Body definitions specify centre coordinates, surface radius, gravity parameters, base directions, and rendering properties. The `buildSolarSystemMap()` function generates all hex terrain, gravity fields, and base positions from these definitions.

## How It Works in Delta-V

The map generation system in `map-layout.ts` works in layers:

### 1. Body definitions

A `BODY_DEFS` array defines each celestial body:

```typescript
interface BodyDefinition {
  name: string;
  center: HexCoord;
  surfaceRadius: number;
  gravityRings: number;
  gravityStrength: 'full' | 'weak';
  destructive: boolean;
  color: string;
  renderRadius: number;
  baseDirections: number[];
}
```

11 bodies are defined: Sol, Mercury, Venus, Terra, Luna, Mars, Ceres, Jupiter, Io, Callisto, and Ganymede. Each body's properties drive automatic generation of surface hexes, gravity rings, and orbital base positions.

### 2. Map generation (`buildSolarSystemMap`)

The function iterates over body definitions and:
- Creates surface hexes with appropriate terrain (`planetSurface` or `sunSurface`)
- Generates gravity hexes in rings around each body, with direction vectors pointing toward the body centre
- Places base hexes at computed orbital positions using `baseDirections`
- Adds asteroid belt hexes from coordinate arrays
- Returns a `SolarSystemMap` with a `Map<HexKey, MapHex>`, body metadata, and bounds

### 3. Helper functions

- `getBodyOffset(bodyName, dq, dr)` -- computes absolute hex coordinates relative to a body's centre
- `getControlledBaseHexes(...bodyNames)` -- returns all base hexes for given bodies
- `findBaseHex(map, bodyName)` / `findBaseHexes(map, bodyName)` -- reverse lookup from map data
- `bodyHasGravity(bodyName, map)` -- checks if a body has gravity hexes

These helpers are used by scenario definitions (pattern 62) to place ships and assign bases without hardcoding hex coordinates.

## Key Locations

- `src/shared/map-layout.ts` (lines 24-146) -- `BODY_DEFS` array (11 bodies)
- `src/shared/map-layout.ts` (lines 148-198) -- asteroid belt hex coordinates
- `src/shared/map-layout.ts` (lines 246-379) -- `buildSolarSystemMap()`
- `src/shared/map-layout.ts` (lines 226-244) -- `getBodyOffset`, `getControlledBaseHexes`
- `src/shared/map-data.ts` -- re-export barrel

## Code Examples

Body definition driving automatic map generation:

```typescript
{
  name: 'Venus',
  center: { q: -7, r: 7 },
  surfaceRadius: 1,
  gravityRings: 1,
  gravityStrength: 'full',
  destructive: false,
  color: '#e8c87a',
  renderRadius: 1.2,
  baseDirections: [0, 1, 2, 3, 4, 5],
},
```

This single definition causes `buildSolarSystemMap` to:
- Create surface hexes at centre + ring 1 (7 hexes) with `planetSurface` terrain
- Create gravity hexes in ring 2 around the centre, each with a gravity vector pointing inward
- Place 6 orbital bases at ring 1 positions in all 6 hex directions

Helper function for body-relative positioning:

```typescript
export const getBodyOffset = (
  bodyName: string,
  dq: number,
  dr: number,
): HexCoord => {
  const def = BODY_DEF_BY_NAME[bodyName];
  if (!def) {
    throw new Error(`Unknown body in map-data helper: ${bodyName}`);
  }
  return {
    q: def.center.q + dq,
    r: def.center.r + dr,
  };
};
```

Gravity ring generation:

```typescript
for (let ring = def.surfaceRadius + 1;
     ring <= def.surfaceRadius + def.gravityRings;
     ring++) {
  const ringHexes = hexRing(def.center, ring);
  for (const gravityHex of ringHexes) {
    const hex = ensureHex(gravityHex);
    const dir = hexDirectionToward(gravityHex, def.center);
    hex.gravity = {
      direction: dir,
      strength: def.gravityStrength,
      bodyName: def.name,
    };
  }
}
```

## Consistency Analysis

All bodies follow the same declarative pattern. The generation algorithm handles bodies uniformly regardless of size (Sol with radius 2 and Jupiter with radius 2 use the same code path as Mercury with radius 0).

Asteroid belt hexes are an exception -- they are specified as explicit coordinate arrays rather than generated from a formula. This is pragmatic (asteroid belts have irregular shapes) but breaks the declarative pattern. The Clandestine Base hex is another special case with hardcoded coordinates.

The `BODY_DEF_BY_NAME` lookup map is derived from the array at module load time, ensuring it stays in sync.

## Completeness Check

- **Single map**: The codebase has exactly one map. The architecture supports scenario-specific maps in theory (the map is a parameter to engine functions), but no infrastructure exists for defining alternative maps.
- **No map validation**: There are no checks for overlapping bodies, gravity conflicts, or unreachable bases. The current map is hand-verified to be correct, but programmatic validation would catch future mistakes.
- **Bounds are hardcoded**: The map bounds in `buildSolarSystemMap` are hardcoded constants rather than computed from body positions. If a body is moved outside these bounds, rendering would clip.
- **Test coverage**: `map-data.test.ts` exists and validates the generated map structure.

## Related Patterns

- **62 -- Config-Driven Scenarios**: Scenarios reference bodies by name and use `getBodyOffset` / `getControlledBaseHexes` for ship placement.
- **61 -- Scenario Rules as Feature Flags**: `sharedBases` and `checkpointBodies` reference body names from the map.
- **52 -- Property-Based Testing**: Movement property tests use the generated map for realistic gravity interactions.
