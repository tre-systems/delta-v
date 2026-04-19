import type { AIDifficulty } from './types';

// AI scoring configuration.
//
// Weights are applied by `src/shared/ai/scoring.ts` on each candidate
// course; bonuses/penalties are additive, ranges are in hexes, and "weight"
// fields multiply the relevant distance or velocity term. Raising a weight
// makes the AI care more about that objective; raising a penalty makes it
// avoid the related state more strongly.
//
// Many fields are identical across all three difficulty levels today —
// difficulty is primarily expressed through `multiplier`, `singleAttackOnly`,
// `minRollThreshold`, `easyRandomBurnProbability`, `ordnanceSkipChance`,
// `torpedoRange`, `mineRange`, and `distributeInterceptTargets`. Fields that
// are left equal across levels are candidates for future tuning sweeps; see
// `npm run simulate:duel-sweep` for the measurement harness.
export interface AIDifficultyConfig {
  // Global scoring multiplier applied to every per-ship course score. A
  // lower value softens the AI's preferences (easy) and a higher value
  // sharpens them (hard).
  multiplier: number;

  // --- Escape strategy ---
  // How strongly a candidate is rewarded for heading to the escape edge.
  escapeDistWeight: number;
  // Reward for carrying enough speed to actually reach the edge this turn.
  escapeSpeedWeight: number;
  // Penalty for remaining landed when the objective is to escape.
  escapeLandedPenalty: number;

  // --- Navigation (objective bodies / bases) ---
  // How strongly a candidate is rewarded for closing with the target hex.
  navDistWeight: number;
  // Big bonus for a course that successfully lands at the scenario target.
  navTargetLandingBonus: number;
  // Smaller bonus for landing at any friendly base (refuel/repair).
  navBaseLandingBonus: number;
  // Penalty for committing to a non-target planet when you have an objective.
  navWrongBodyPenalty: number;
  // Penalty for staying landed when the objective requires movement.
  navStayLandedPenalty: number;
  // Weight on aligning velocity with the objective bearing.
  navVelocityAlignWeight: number;
  // Penalty for overshooting the objective; scaled by how far past it.
  navOvershootPenalty: number;
  // Hex range at which overshoot scoring activates.
  navOvershootRange: number;
  // Penalty for unnecessary braking near the objective.
  navBrakingPenalty: number;

  // --- Race / gravity danger (applied when close to strong gravity wells) ---
  // Hex buffer around a gravity well before danger scoring activates.
  gravityDangerPadding: number;
  // Speed-based penalty for flying fast through dangerous gravity.
  gravityDangerSpeedPenalty: number;
  // Flat penalty for entering a known-risky gravity cell (can be negative
  // to encourage risk-taking in specific scenarios).
  gravityRiskPenalty: number;

  // --- Deferred gravity look-ahead ---
  // Weight on gravity assists that help the escape objective.
  gravityEscapeWeight: number;
  // Weight on gravity assists that aid normal navigation.
  gravityNavWeight: number;
  // Weight on gravity moves that put the ship in combat range.
  gravityCombatProximity: number;

  // --- Combat positioning (no objective) ---
  // Reward for courses that reduce distance to the enemy fleet.
  combatClosingWeight: number;
  // Flat bonus for being within combat range after the course.
  combatCloseBonus: number;
  // Hex radius that counts as "close" for combatCloseBonus.
  combatCloseRange: number;
  // Reward for improving expected combat odds turn over turn.
  combatImprovementWeight: number;
  // Penalty for mismatched velocities vs the target.
  combatVelocityPenalty: number;
  // Hex radius within which velocity matching matters.
  combatVelocityMatchRange: number;
  // Hex radius within which speed management matters at all.
  combatSpeedManageRange: number;
  // Speed (hexes/turn) above which we consider the ship "fast".
  combatSpeedThreshold: number;
  // Penalty per point of speed differential at close range.
  combatSpeedDiffPenalty: number;
  // Penalty for staying landed when combat is available.
  combatStayLandedPenalty: number;

  // --- Interception (enemy escaping) ---
  // Hex radius considered close enough for a cut-off intercept.
  interceptCloseRange: number;
  interceptCloseWeight: number;
  interceptCloseBonus: number;
  // Reward for reducing intercept distance turn over turn.
  interceptImprovementWeight: number;
  // Penalty for mismatched intercept velocity.
  interceptVelocityPenalty: number;
  // Weight / bonus when committing to a far-range intercept.
  interceptFarWeight: number;
  interceptFarBonus: number;
  // Penalty when multiple ships pile onto the same intercept target.
  interceptAssignedPenalty: number;

  // --- Objective + combat (has target) ---
  // Multiplier on navigation when the AI also has a combat objective.
  objectiveStrongWeight: number;
  // Softer multiplier used when the combat objective is secondary.
  objectiveWeakWeight: number;

  // --- Fuel seeking ---
  // Reward for landing at a refuel base when low on fuel.
  fuelSeekLandingBonus: number;
  // Small reward for drifting (no burn) to conserve fuel.
  fuelDriftBonus: number;
  // Penalty per fuel unit spent on overloads.
  fuelOverloadPenalty: number;

  // --- Ordnance (launch filtering, not scoring) ---
  // Max hex range at which torpedoes are considered useful.
  torpedoRange: number;
  // Max hex range at which defensive mines are considered useful.
  mineRange: number;
  // 0..1 probability the AI skips ordnance this turn (used for difficulty
  // differentiation; easy AI sometimes forgoes its launch).
  ordnanceSkipChance: number;
  // Hex radius used to assess nuke engagement geometry.
  nukeStrengthRange: number;
  // Minimum modelled probability (0..1) that a nuke survives grouped
  // anti-nuke volleys through its intercept window. When 0, the gate is
  // disabled (easy / normal). Hard uses a conservative floor so the AI
  // does not burn 300 MCr ordnance into obvious intercept geometry.
  nukeMinReachProbability: number;

  // --- Map boundary avoidance ---
  // Hex distance from the edge at which avoidance kicks in.
  boundaryAvoidanceThreshold: number;
  // Multiplier on avoidance severity as the ship nears the edge.
  boundaryAvoidanceSeverityMultiplier: number;
  // Speed threshold above which a ship near the edge is penalized more.
  boundaryVelocityThreshold: number;
  // Flat penalty per speed unit above the threshold.
  boundaryVelocityPenalty: number;

  // --- Behavioral quirks ---
  // 0..1 probability an easy-tier ship picks a random burn direction.
  easyRandomBurnProbability: number;
  // When true (hard only), distribute intercept targets across the fleet
  // rather than piling onto the nearest enemy.
  distributeInterceptTargets: boolean;

  // --- Combat targeting ---
  // Penalty per hex of range to an attack target.
  targetDistPenalty: number;
  // Penalty for unfavorable to-hit modifiers.
  targetModPenalty: number;
  // Bonus for picking off already-disabled targets.
  targetDisabledBonus: number;
  // Flat base weight on nuke-threat scoring (before range scaling).
  nukeThreatBase: number;
  nukeThreatWeight: number;
  nukeThreatRange: number;
  // Minimum dice-roll the AI is willing to attempt an attack at (higher =
  // fewer low-odds attacks). Easy stays conservative; hard takes long shots.
  minRollThreshold: number;
  // When true (easy), fire only one attack per turn per ship.
  singleAttackOnly: boolean;

  // --- Fleet composition ---
  // Max per-match count of each high-end capital ship. Lower tiers keep
  // these off the board; the hard tier opens them up for fleet-action
  // scenarios where concentrated firepower matters.
  maxDreadnaughts: number;
  maxTorches: number;
  // When true, the AI will route orbital-base purchases through the
  // fleet-building logic (carrier allocation + base-carrier slot check).
  // Gated on hard today because the tactical payoff only shows up when
  // the AI can reliably escort the base through early-game combat.
  allowsOrbitalBases: boolean;

  // --- Ordnance doctrine ---
  // When true the AI is willing to spend a nuke on favourable mid-game
  // geometry. Easy / normal keep nukes holstered so a human scrimmage
  // partner doesn't get one-shot by an opening attack.
  willCommitNukes: boolean;

  // --- Logistics doctrine ---
  // Upper bound on transfer orders issued per logistics phase. Easy
  // micromanages poorly (one per turn); normal is balanced; hard runs
  // the full three-transfer budget the rules allow.
  maxLogisticsTransfersPerTurn: number;
}

export const AI_CONFIG: Readonly<
  Record<AIDifficulty, Readonly<AIDifficultyConfig>>
> = {
  easy: {
    multiplier: 0.7,
    escapeDistWeight: 10,
    escapeSpeedWeight: 5,
    escapeLandedPenalty: 100,
    navDistWeight: 20,
    navTargetLandingBonus: 1000,
    navBaseLandingBonus: 500,
    navWrongBodyPenalty: 30,
    navStayLandedPenalty: 50,
    navVelocityAlignWeight: 2,
    navOvershootPenalty: 15,
    navOvershootRange: 8,
    navBrakingPenalty: 25,
    gravityDangerPadding: 5,
    gravityDangerSpeedPenalty: 15,
    gravityRiskPenalty: -20,
    gravityEscapeWeight: 4,
    gravityNavWeight: 6,
    gravityCombatProximity: 5,
    combatClosingWeight: 3,
    combatCloseBonus: 40,
    combatCloseRange: 3,
    combatImprovementWeight: 5,
    combatVelocityPenalty: 2,
    combatVelocityMatchRange: 6,
    combatSpeedManageRange: 5,
    combatSpeedThreshold: 5,
    combatSpeedDiffPenalty: 3,
    combatStayLandedPenalty: 80,
    interceptCloseRange: 5,
    interceptCloseWeight: 4,
    interceptCloseBonus: 60,
    interceptImprovementWeight: 6,
    interceptVelocityPenalty: 5,
    interceptFarWeight: 3,
    interceptFarBonus: 50,
    interceptAssignedPenalty: 2,
    objectiveStrongWeight: 1.5,
    objectiveWeakWeight: 0.5,
    fuelSeekLandingBonus: 800,
    fuelDriftBonus: 0.5,
    fuelOverloadPenalty: 1,
    boundaryAvoidanceThreshold: 5,
    boundaryAvoidanceSeverityMultiplier: 25,
    boundaryVelocityThreshold: 8,
    boundaryVelocityPenalty: 20,
    easyRandomBurnProbability: 0.25,
    distributeInterceptTargets: false,
    torpedoRange: 8,
    mineRange: 4,
    ordnanceSkipChance: 0.3,
    nukeStrengthRange: 6,
    nukeMinReachProbability: 0,
    targetDistPenalty: 2,
    targetModPenalty: 3,
    targetDisabledBonus: 5,
    nukeThreatBase: 18,
    nukeThreatWeight: 8,
    nukeThreatRange: 6,
    minRollThreshold: 3,
    singleAttackOnly: true,
    maxDreadnaughts: 0,
    maxTorches: 0,
    allowsOrbitalBases: false,
    willCommitNukes: false,
    maxLogisticsTransfersPerTurn: 1,
  },
  normal: {
    multiplier: 1.0,
    escapeDistWeight: 10,
    escapeSpeedWeight: 5,
    escapeLandedPenalty: 100,
    navDistWeight: 20,
    navTargetLandingBonus: 1000,
    navBaseLandingBonus: 500,
    navWrongBodyPenalty: 30,
    navStayLandedPenalty: 50,
    navVelocityAlignWeight: 2,
    navOvershootPenalty: 15,
    navOvershootRange: 8,
    navBrakingPenalty: 25,
    gravityDangerPadding: 5,
    gravityDangerSpeedPenalty: 15,
    gravityRiskPenalty: -20,
    gravityEscapeWeight: 4,
    gravityNavWeight: 6,
    gravityCombatProximity: 5,
    combatClosingWeight: 3,
    combatCloseBonus: 40,
    combatCloseRange: 3,
    combatImprovementWeight: 5,
    combatVelocityPenalty: 2,
    combatVelocityMatchRange: 6,
    combatSpeedManageRange: 5,
    combatSpeedThreshold: 5,
    combatSpeedDiffPenalty: 3,
    combatStayLandedPenalty: 80,
    interceptCloseRange: 5,
    interceptCloseWeight: 4,
    interceptCloseBonus: 60,
    interceptImprovementWeight: 6,
    interceptVelocityPenalty: 5,
    interceptFarWeight: 3,
    interceptFarBonus: 50,
    interceptAssignedPenalty: 2,
    objectiveStrongWeight: 1.5,
    objectiveWeakWeight: 0.5,
    fuelSeekLandingBonus: 800,
    fuelDriftBonus: 0.5,
    fuelOverloadPenalty: 1,
    boundaryAvoidanceThreshold: 5,
    boundaryAvoidanceSeverityMultiplier: 25,
    boundaryVelocityThreshold: 8,
    boundaryVelocityPenalty: 20,
    easyRandomBurnProbability: 0,
    distributeInterceptTargets: false,
    torpedoRange: 7,
    mineRange: 4,
    ordnanceSkipChance: 0,
    nukeStrengthRange: 6,
    nukeMinReachProbability: 0,
    targetDistPenalty: 2,
    targetModPenalty: 3,
    targetDisabledBonus: 5,
    nukeThreatBase: 18,
    nukeThreatWeight: 8,
    nukeThreatRange: 6,
    minRollThreshold: 2,
    singleAttackOnly: false,
    maxDreadnaughts: 0,
    maxTorches: 0,
    allowsOrbitalBases: false,
    willCommitNukes: false,
    maxLogisticsTransfersPerTurn: 2,
  },
  hard: {
    multiplier: 1.5,
    escapeDistWeight: 10,
    escapeSpeedWeight: 5,
    escapeLandedPenalty: 100,
    navDistWeight: 20,
    navTargetLandingBonus: 1000,
    navBaseLandingBonus: 500,
    navWrongBodyPenalty: 30,
    navStayLandedPenalty: 50,
    navVelocityAlignWeight: 2,
    navOvershootPenalty: 15,
    navOvershootRange: 8,
    navBrakingPenalty: 25,
    gravityDangerPadding: 5,
    gravityDangerSpeedPenalty: 15,
    gravityRiskPenalty: -20,
    gravityEscapeWeight: 4,
    gravityNavWeight: 6,
    gravityCombatProximity: 5,
    // Reduced from 3 → 1 and 40 → 10. The old weights made hard AI
    // converge fast in no-objective combat scenarios (duel ended in 2–3
    // turns in early scrimmage, 6 after the nuke-guard pass). Halving
    // the closing pressure lets the AI play more patient, range-managed
    // fights. Other scenarios (biplanetary, escape, fleetAction,
    // interplanetaryWar, grandTour, blockade, evacuation, convoy) all
    // have navigation objectives that dominate over these weights, so
    // this only moves the needle in duel-style positional combat.
    // Measured in a 16-seed × 30-game sweep: duel avg 6.0 → 8.9 turns
    // with seat balance held at 45% P0. See AGENT_IMPROVEMENTS_LOG.md
    // for the full measurement table.
    combatClosingWeight: 3,
    combatCloseBonus: 40,
    combatCloseRange: 3,
    combatImprovementWeight: 5,
    combatVelocityPenalty: 2,
    combatVelocityMatchRange: 6,
    combatSpeedManageRange: 5,
    combatSpeedThreshold: 5,
    combatSpeedDiffPenalty: 3,
    combatStayLandedPenalty: 80,
    interceptCloseRange: 5,
    interceptCloseWeight: 4,
    interceptCloseBonus: 60,
    interceptImprovementWeight: 6,
    interceptVelocityPenalty: 5,
    interceptFarWeight: 3,
    interceptFarBonus: 50,
    interceptAssignedPenalty: 2,
    objectiveStrongWeight: 1.5,
    objectiveWeakWeight: 0.5,
    fuelSeekLandingBonus: 800,
    fuelDriftBonus: 0.5,
    fuelOverloadPenalty: 1,
    boundaryAvoidanceThreshold: 5,
    boundaryAvoidanceSeverityMultiplier: 25,
    boundaryVelocityThreshold: 8,
    boundaryVelocityPenalty: 20,
    easyRandomBurnProbability: 0,
    distributeInterceptTargets: true,
    torpedoRange: 12,
    mineRange: 6,
    ordnanceSkipChance: 0,
    nukeStrengthRange: 6,
    nukeMinReachProbability: 0.28,
    targetDistPenalty: 1,
    targetModPenalty: 2,
    targetDisabledBonus: 5,
    nukeThreatBase: 18,
    nukeThreatWeight: 8,
    nukeThreatRange: 6,
    minRollThreshold: 0,
    singleAttackOnly: false,
    maxDreadnaughts: 1,
    maxTorches: 1,
    allowsOrbitalBases: true,
    willCommitNukes: true,
    maxLogisticsTransfersPerTurn: 3,
  },
};

// Resolve the AI scoring config for a given difficulty, honouring any
// scenario-scoped overrides. This lets scenarios tune specific weights
// (for example, duel wants the AI to hold range rather than rush close
// combat) without affecting global difficulty behaviour. Only fields
// explicitly listed in the override are replaced; everything else falls
// through to the base difficulty config.
export const resolveAIConfig = (
  difficulty: AIDifficulty,
  overrides?: Partial<AIDifficultyConfig>,
): Readonly<AIDifficultyConfig> => {
  const base = AI_CONFIG[difficulty];
  if (!overrides) return base;
  return { ...base, ...overrides };
};
