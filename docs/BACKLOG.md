# Delta-V Backlog

Prioritized list of remaining work items. P0 = rule correctness, P1 = robustness, P2 = code quality, P3 = test coverage.

## P0 — Rule Correctness

### Edge-of-gravity geometric rule
`hexLineDraw` cannot distinguish edge-grazing from true hex entry. The Triplanetary rules state that a ship passing along the edge of a gravity hex (not through it) should not be affected. This is a known limitation of the hex line-draw algorithm and would require a geometric check at hex boundaries.

**Files:** `src/shared/hex.ts`, `src/shared/movement.ts`

### Asteroid hexside-between-two rule
Moving along a hexside shared by two asteroid hexes should count as a single asteroid encounter, not two. The current implementation checks each hex independently.

**Files:** `src/shared/game-engine.ts` (asteroid hazard resolution)

## P1 — Robustness

### Fix potential null ship position in createGame
In `src/shared/game-engine.ts` (around line 170), `findBaseHex` can return null. The fallback `baseHex ?? def.position` assumes `def.position` is always valid. Should add explicit validation.

**Files:** `src/shared/game-engine.ts`

### Add player count validation
`createGame` does not validate that the number of players matches the scenario requirements. Invalid player counts could produce undefined behavior.

**Files:** `src/shared/game-engine.ts`

## P2 — Code Quality

### Decompose game-engine.ts
At over 1000 lines, `game-engine.ts` handles game creation, astrogation, ordnance, combat, and turn management. Extract into focused modules (e.g., `game-create.ts`, `game-ordnance.ts`, `game-combat-phase.ts`) while keeping the orchestrator thin.

**Files:** `src/shared/game-engine.ts`

### Refactor nested ternary in ship placement
Lines ~156-172 of `game-engine.ts` contain a nested ternary with IIFEs for ship placement logic. Refactor into a named helper function with clear early returns.

**Files:** `src/shared/game-engine.ts`

## P3 — Test Coverage

### Add map-data.test.ts
`src/shared/map-data.ts` has no unit tests. Cover `bodyHasGravity`, scenario generation, and hex map construction.

### Add processEmplacement tests
The orbital base emplacement logic in `game-engine.ts` is untested. Add tests for valid/invalid placements and cost validation.

### Add constants validation tests
Add basic sanity tests for `SHIP_STATS` (e.g., no negative values, warships have `canOverload: true`, `defensiveOnly` ships have low combat ratings).
