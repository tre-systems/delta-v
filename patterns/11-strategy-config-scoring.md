# Strategy (Config-Weighted Scoring)

## Category

Behavioral

## Intent

Make AI decision-making fully data-driven by externalizing every scoring weight, threshold, and behavioral toggle into a configuration record keyed by difficulty level. The Strategy pattern allows the same scoring algorithms to produce qualitatively different behavior (easy, normal, hard) by swapping weight sets rather than branching on difficulty in code.

## How It Works in Delta-V

The AI system uses a **score-and-select** approach: for each decision point (astrogation, combat targeting, ordnance launch), it evaluates every candidate option, assigns a numeric score using weighted scoring functions, and selects the highest-scoring option.

### Configuration Layer (`config.ts`)

`AIDifficultyConfig` is an interface with ~70 numeric fields organized by concern: escape strategy, navigation, gravity danger, combat positioning, interception, ordnance, and combat targeting. The `AI_CONFIG` record provides three complete configurations keyed by `AIDifficulty` (`'easy' | 'normal' | 'hard'`).

Difficulty differences are expressed through weights and thresholds:
- `multiplier`: Global scoring amplifier (0.7 easy, 1.0 normal, 1.5 hard)
- `ordnanceSkipChance`: 30% for easy (randomly skip ordnance), 0% for normal/hard
- `singleAttackOnly`: `true` for easy (only one attack per turn)
- `minRollThreshold`: 3 for easy (skips low-probability attacks), 0 for hard
- `torpedoRange` / `mineRange`: Larger for hard difficulty

### Scoring Layer (`scoring.ts`)

Individual scoring strategies are pure functions that each evaluate one concern:

- `scoreEscape` -- Rewards distance from center and speed for escape objectives
- `scoreNavigation` -- Rewards proximity to target, landing bonuses, velocity alignment
- `scoreRaceDanger` -- Penalizes high speed near gravity wells in race scenarios
- `scoreGravityLookAhead` -- Projects one turn ahead through deferred gravity effects
- `scoreCombatPositioning` -- Handles interception, pure combat, and objective-balanced fighting

The combiner `scoreCourse` calls each strategy and sums the results plus inline scoring for map boundary avoidance and fuel-related concerns.

### Decision Layer (`astrogation.ts`, `combat.ts`, `ordnance.ts`, `logistics.ts`)

Each AI decision module iterates candidate actions, scores them using the config-weighted functions, and selects the best. For example, `aiAstrogation` evaluates every possible burn direction (including overloads and landing) for each ship, calling `scoreCourse` for each candidate.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/shared/ai/config.ts` | 1-251 | `AIDifficultyConfig` interface + `AI_CONFIG` record |
| `src/shared/ai/scoring.ts` | 1-424 | Individual scoring strategies + `scoreCourse` combiner |
| `src/shared/ai/astrogation.ts` | 371-828 | `aiAstrogation` -- course evaluation loop |
| `src/shared/ai/combat.ts` | 1-217 | `aiCombat` -- target scoring and attacker assignment |
| `src/shared/ai/ordnance.ts` | -- | `aiOrdnance` -- launch decisions |
| `src/shared/ai/logistics.ts` | -- | `aiLogistics` -- transfer decisions |
| `src/shared/ai/index.ts` | 1-7 | Public exports |
| `src/shared/ai/types.ts` | -- | `AIDifficulty` type definition |

## Code Examples

Config structure (excerpt from `config.ts`):

```typescript
export interface AIDifficultyConfig {
  multiplier: number;
  escapeDistWeight: number;
  escapeSpeedWeight: number;
  escapeLandedPenalty: number;
  navDistWeight: number;
  navTargetLandingBonus: number;
  // ... ~70 fields total
  singleAttackOnly: boolean;
}

export const AI_CONFIG: Record<AIDifficulty, AIDifficultyConfig> = {
  easy: {
    multiplier: 0.7,
    ordnanceSkipChance: 0.3,
    singleAttackOnly: true,
    minRollThreshold: 3,
    // ...
  },
  normal: {
    multiplier: 1.0,
    ordnanceSkipChance: 0,
    singleAttackOnly: false,
    minRollThreshold: 1,
    // ...
  },
  hard: {
    multiplier: 1.5,
    torpedoRange: 12,
    mineRange: 6,
    minRollThreshold: 0,
    // ...
  },
};
```

Individual scoring strategy (`scoring.ts`):

```typescript
export const scoreEscape = (
  ship: Ship,
  course: CourseResult,
  cfg: AIDifficultyConfig,
): number => {
  const mult = cfg.multiplier;
  let score = 0;
  const distFromCenter = hexDistance(course.destination, { q: 0, r: 0 });
  score += distFromCenter * cfg.escapeDistWeight * mult;
  const speed = hexVecLength(course.newVelocity);
  score += speed * cfg.escapeSpeedWeight * mult;
  if (
    ship.lifecycle === 'landed' &&
    course.destination.q === ship.position.q &&
    course.destination.r === ship.position.r
  ) {
    score -= cfg.escapeLandedPenalty * mult;
  }
  return score;
};
```

Strategy selection in the combiner:

```typescript
export const scoreCourse = (p: ScoreCourseParams): number => {
  let score = 0;
  if (escapeWins) {
    score += scoreEscape(ship, course, cfg);
  } else if (targetHex) {
    score += scoreNavigation(ship, course, targetHex, targetBody, cfg);
  }
  if (isRace && map) {
    score += scoreRaceDanger(course, map, targetHex, cfg);
  }
  score += scoreGravityLookAhead(course, escapeWins, targetHex, enemyShips, cfg);
  score += scoreCombatPositioning(ship, course, enemyShips, /* ... */);
  return score;
};
```

## Consistency Analysis

**Strengths:**

- Every scoring function takes `cfg: AIDifficultyConfig` as a parameter rather than reading a global. This makes the scoring functions pure and testable in isolation.
- The config record provides a complete set of weights for every difficulty, avoiding partial configs or fallback chains.
- The `multiplier` field acts as a global scaling knob, applied consistently across all strategies via `cfg.multiplier * mult`.
- Combat targeting in `aiCombat` uses config-driven thresholds (`minRollThreshold`, `singleAttackOnly`) to vary aggression.

**Potential gaps / hardcoded behavior:**

- Map boundary avoidance in `scoreCourse` (lines 363-388) uses hardcoded constants (`severity * severity * 25`, `edgeDist < 5`, `edgeDist < 8`) rather than config values. This behavior is identical across difficulties.
- The `combatStayLandedPenalty` is applied inline in `scoreCourse` rather than inside a dedicated scoring function, breaking the pattern slightly.
- In `aiAstrogation`, the easy-mode random burn override (`rng() < 0.25`) uses a hardcoded probability rather than a config value.
- Hard-mode target distribution in `scoreCombatPositioning` is gated by `difficulty === 'hard'` string comparison rather than a config flag.
- The passenger escort emergency scoring and look-ahead simulation in `astrogation.ts` use hardcoded weights (e.g., `* 5`, `* 180`, `* 10`) that are not part of `AIDifficultyConfig`.

**Recommendations:**

- Extract boundary avoidance weights, easy-mode randomness probability, and passenger escort weights into `AIDifficultyConfig`.
- Replace the `difficulty === 'hard'` string check with a config boolean like `distributeInterceptTargets`.

## Completeness Check

- The config covers astrogation, combat, ordnance, logistics, and interception concerns comprehensively.
- All four AI decision phases (astrogation, ordnance, logistics, combat) use the config system.
- The scoring functions cleanly separate concerns -- each scores one aspect independently. The combiner adds them linearly, which is simple and predictable.
- Missing: there is no mechanism for runtime config tuning (e.g., adjusting weights while observing AI behavior). The configs are compile-time constants.

## Related Patterns

- **Derive/Plan** (12) -- `deriveAIActionPlan` produces an AI action plan from game state, using the scoring strategies internally.
- **Builder** (13) -- `buildAIFleetPurchases` uses config-adjacent logic for fleet composition.
- **Pipeline** (15) -- The AI evaluation is itself a pipeline: enumerate candidates -> score each -> select best.
