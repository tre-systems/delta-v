# Deterministic RNG Injection

**Category:** Persistence & State

## Intent

Ensure that all randomness in the game engine is reproducible given the same inputs. By injecting the RNG as a function parameter rather than calling `Math.random()` directly, the engine supports three use cases:

1. **Server-side determinism:** Each action derives its RNG from a match-scoped seed and the current event sequence number, making replays possible.
2. **Test reproducibility:** Tests can pass fixed RNG functions (e.g., `() => 0.5`) to get predictable outcomes.
3. **Client-side flexibility:** Local AI play can use `Math.random` directly since those games are not replayed.

## How It Works in Delta-V

### The PRNG Implementation

Delta-V uses **mulberry32**, a fast 32-bit PRNG with a full 2^32 period. It produces values in [0, 1) from a 32-bit integer seed.

Each match is assigned a **match seed** at creation time via `crypto.getRandomValues`. This seed is stored in Durable Object storage under `matchSeed:{gameId}`.

### Per-Action RNG Derivation

Rather than advancing a single PRNG stream across the entire match (which would require tracking exact call counts), Delta-V derives a **fresh PRNG per action** using `deriveActionRng(matchSeed, actionSeq)`. This combines the match seed with the current event sequence number using a Knuth multiplicative hash to spread adjacent sequence numbers into well-separated seed space.

This means:
- Two actions with the same match seed and sequence number produce identical random streams.
- The PRNG state does not need to be persisted between actions -- only the seed and sequence counter matter.

### Injection Points

All turn-resolution engine entry points require `rng: () => number` as a mandatory parameter:
- `processAstrogation(inputState, playerId, orders, map, rng)`
- `processOrdnance(inputState, playerId, launches, map, rng)`
- `skipOrdnance(inputState, playerId, map, rng)`
- `beginCombatPhase(inputState, playerId, map, rng)`
- `processCombat(inputState, playerId, attacks, map, rng)`
- `processSingleCombat(inputState, playerId, attack, map, rng)`
- `skipCombat(inputState, playerId, map, rng)`
- `endCombat(inputState, playerId, map, rng)`

Internal utility functions also require the RNG parameter:
- `rollD6(rng)`, `shuffle(array, rng)`, `randomChoice(array, rng)`
- `resolveCombat(...)`, `resolveBaseDefense(...)`, `checkRamming(...)`
- `moveOrdnance(...)`, `resolvePendingAsteroidHazards(...)`

### Server-Side Wiring

The `GameDO` class derives the action RNG by reading the match seed and current event sequence length:

```ts
// src/server/game-do/game-do.ts, lines 225-242
private async getActionRng(): Promise<() => number> {
  const gameId = await this.getLatestGameId();

  if (!gameId) {
    return Math.random;
  }

  const [seed, seq] = await Promise.all([
    getMatchSeed(this.storage, gameId),
    getEventStreamLength(this.storage, gameId),
  ]);

  if (seed === null) {
    return Math.random;
  }

  return deriveActionRng(seed, seq);
}
```

## Key Locations

| File | Lines | Purpose |
|------|-------|---------|
| `src/shared/prng.ts` | 1-12 | `mulberry32` -- the core PRNG algorithm |
| `src/shared/prng.ts` | 14-25 | `deriveActionRng` -- per-action seed derivation |
| `src/server/game-do/game-do.ts` | 225-242 | `getActionRng` -- server-side RNG wiring |
| `src/server/game-do/archive.ts` | 210-228 | `allocateMatchIdentity` -- match seed generation via `crypto.getRandomValues` |
| `src/shared/engine/astrogation.ts` | 123-130 | `processAstrogation` -- rng parameter |
| `src/shared/engine/combat.ts` | 269-272 | `beginCombatPhase` -- rng parameter |
| `src/shared/prng.test.ts` | 1-102 | PRNG determinism and distribution tests |

## Code Examples

The PRNG and derivation function:

```ts
// src/shared/prng.ts
// mulberry32 -- fast 32-bit PRNG with full 2^32 period.
// Returns () => number producing values in [0, 1).
export const mulberry32 = (seed: number): (() => number) => {
  let s = seed | 0;

  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
};

// Knuth multiplicative hash constant (golden ratio
// scaled to 32 bits) -- spreads adjacent seq numbers
// into well-separated seed space.
const KNUTH = 0x9e3779b9;

// Derive a per-action RNG from a match seed and the
// current event sequence number.
export const deriveActionRng = (
  matchSeed: number,
  actionSeq: number,
): (() => number) => mulberry32((matchSeed ^ Math.imul(actionSeq, KNUTH)) | 0);
```

Match seed allocation using cryptographic randomness:

```ts
// src/server/game-do/archive.ts, lines 210-228
export const allocateMatchIdentity = async (
  storage: Storage,
  code: string,
): Promise<{
  gameId: string;
  matchNumber: number;
  matchSeed: number;
}> => {
  const matchNumber = ((await storage.get<number>('matchNumber')) ?? 0) + 1;
  const gameId = buildMatchId(code, matchNumber);
  const seedBuf = new Uint32Array(1);
  crypto.getRandomValues(seedBuf);
  const matchSeed = seedBuf[0];

  await storage.put('matchNumber', matchNumber);
  await storage.put(matchSeedKey(gameId), matchSeed);

  return { gameId, matchNumber, matchSeed };
};
```

## Consistency Analysis

**The turn-resolution path is fully covered.** All `process*` and `skip*` engine functions require `rng` as a mandatory parameter with no default value. Internal random functions (`rollD6`, `shuffle`, `randomChoice`, `resolveCombat`, etc.) also require the RNG parameter. There are no `Math.random` fallbacks in the turn-resolution path.

**Intentional exceptions exist in non-turn-resolution code:**

- `createGame` (game creation/setup) accepts `rng` with a `Math.random` default, since game creation is not replayed from events.
- AI heuristic functions (`aiAstrogation`, `aiOrdnance`) accept optional `rng` with `Math.random` default, since AI decisions are inputs to the engine rather than deterministic outputs.
- Client-side local play (`src/client/game/local.ts`) passes `Math.random` to all engine calls, which is correct since local games are not persisted or replayed.
- Scripts (`load-test.ts`, `simulate-ai.ts`, `llm-player.ts`) use `Math.random` appropriately for non-production scenarios.

**Known consistency gap:** The architecture documentation notes that server-side alarm timeout auto-advance wiring (`src/server/game-do/turns.ts`) passes the `rng` parameter from the caller, but the `GameDO` alarm handler provides the RNG. The `resolveTurnTimeoutOutcome` function itself correctly accepts `rng` as a parameter. The `getActionRng` method in `GameDO` has fallback paths that return `Math.random` when no game ID or seed is found -- these fallbacks exist for backward compatibility with pre-seed matches.

**Non-engine `Math.random` usage is appropriate:**
- Audio effects (white noise generation in `audio.ts`)
- Camera shake in the renderer (`camera.ts`)
- UI randomization in session controller

## Completeness Check

**The PRNG is well tested** (`prng.test.ts`):
- Deterministic output for a given seed
- Values in [0, 1) range
- Roughly uniform distribution
- Different seeds produce different sequences
- Low collision rate over 10k values
- Snapshot test locking down exact output for seed 42
- `deriveActionRng` produces identical sequences for same seed+seq
- Adjacent sequence numbers diverge immediately

**Possible improvements:**

1. **Eliminate `Math.random` fallbacks in `getActionRng`:** The fallback to `Math.random` when no seed is found means pre-seed legacy matches lose determinism. If all active matches now have seeds, the fallback could be replaced with an error.
2. **Match seed in `gameCreated` event:** The match seed is stored in the `gameCreated` engine event (`matchSeed` field), which enables replay tooling to reconstruct the RNG for any action given the event stream.

## Related Patterns

- **Event Stream + Checkpoint Recovery (Pattern 31):** The event sequence number used to derive the RNG comes from the same sequence counter maintained by the event stream.
- **Mutable Clone Pattern (Pattern 35):** Engine entry points clone the input state before using the injected RNG to make random modifications, ensuring the original state is never mutated.
