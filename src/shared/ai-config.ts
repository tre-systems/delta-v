import type { AIDifficulty } from './ai-types';

export interface AIDifficultyConfig {
  // Global scoring multiplier
  multiplier: number;

  // --- Escape strategy ---
  escapeDistWeight: number;
  escapeSpeedWeight: number;
  escapeLandedPenalty: number;

  // --- Navigation ---
  navDistWeight: number;
  navTargetLandingBonus: number;
  navBaseLandingBonus: number;
  navWrongBodyPenalty: number;
  navStayLandedPenalty: number;
  navVelocityAlignWeight: number;
  navOvershootPenalty: number;
  navOvershootRange: number;
  navBrakingPenalty: number;

  // --- Race / gravity danger ---
  gravityDangerPadding: number;
  gravityDangerSpeedPenalty: number;
  gravityRiskPenalty: number;

  // --- Deferred gravity look-ahead ---
  gravityEscapeWeight: number;
  gravityNavWeight: number;
  gravityCombatProximity: number;

  // --- Combat positioning (no objective) ---
  combatClosingWeight: number;
  combatCloseBonus: number;
  combatCloseRange: number;
  combatImprovementWeight: number;
  combatVelocityPenalty: number;
  combatVelocityMatchRange: number;
  combatSpeedManageRange: number;
  combatSpeedThreshold: number;
  combatSpeedDiffPenalty: number;
  combatStayLandedPenalty: number;

  // --- Interception (enemy escaping) ---
  interceptCloseRange: number;
  interceptCloseWeight: number;
  interceptCloseBonus: number;
  interceptImprovementWeight: number;
  interceptVelocityPenalty: number;
  interceptFarWeight: number;
  interceptFarBonus: number;
  interceptAssignedPenalty: number;

  // --- Objective + combat (has target) ---
  objectiveStrongWeight: number;
  objectiveWeakWeight: number;

  // --- Fuel seeking ---
  fuelSeekLandingBonus: number;
  fuelDriftBonus: number;
  fuelOverloadPenalty: number;

  // --- Ordnance ---
  torpedoRange: number;
  mineRange: number;
  ordnanceSkipChance: number;
  nukeStrengthRange: number;

  // --- Combat targeting ---
  targetDistPenalty: number;
  targetModPenalty: number;
  targetDisabledBonus: number;
  nukeThreatBase: number;
  nukeThreatWeight: number;
  nukeThreatRange: number;
  minRollThreshold: number;
  singleAttackOnly: boolean;
}

export const AI_CONFIG: Record<AIDifficulty, AIDifficultyConfig> = {
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
    torpedoRange: 8,
    mineRange: 4,
    ordnanceSkipChance: 0.3,
    nukeStrengthRange: 6,
    targetDistPenalty: 2,
    targetModPenalty: 3,
    targetDisabledBonus: 5,
    nukeThreatBase: 18,
    nukeThreatWeight: 8,
    nukeThreatRange: 6,
    minRollThreshold: 3,
    singleAttackOnly: true,
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
    torpedoRange: 8,
    mineRange: 4,
    ordnanceSkipChance: 0,
    nukeStrengthRange: 6,
    targetDistPenalty: 2,
    targetModPenalty: 3,
    targetDisabledBonus: 5,
    nukeThreatBase: 18,
    nukeThreatWeight: 8,
    nukeThreatRange: 6,
    minRollThreshold: 1,
    singleAttackOnly: false,
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
    torpedoRange: 12,
    mineRange: 6,
    ordnanceSkipChance: 0,
    nukeStrengthRange: 6,
    targetDistPenalty: 2,
    targetModPenalty: 3,
    targetDisabledBonus: 5,
    nukeThreatBase: 18,
    nukeThreatWeight: 8,
    nukeThreatRange: 6,
    minRollThreshold: 0,
    singleAttackOnly: false,
  },
};
