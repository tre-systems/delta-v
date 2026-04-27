import { canAttack, getCombatStrength } from '../combat';
import { SHIP_STATS } from '../constants';
import {
  beginCombatPhase,
  processAstrogation,
  processCombat,
  processLogistics,
  processOrdnance,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../engine/game-engine';
import { type HexKey, hexAdd, hexDistance, hexKey, hexVecLength } from '../hex';
import { findBaseHexes } from '../map-data';
import { computeCourse, detectOrbit } from '../movement';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { maxBy, minBy } from '../util';
import { aiCombat } from './combat';
import {
  estimateFuelForTravelDistance,
  estimateMovementCostToHex,
  estimateRemainingCheckpointTourCost,
  estimateTurnsToTargetLanding,
  findDirectionToward,
  findNearestRefuelBase,
  findReachableRefuelBase,
  getHomeDefenseThreat,
  getInterceptContinuationPreference,
  pickNextCheckpoint,
  planShortHorizonMovementToHex,
  projectShipAfterCourse,
  scoreObjectiveHomeDefenseCourse,
} from './common';
import { resolveAIConfig } from './config';
import type { ShipRole } from './logistics';
import {
  aiLogistics,
  assignPassengerShipRoles,
  assignTurnShipRoles,
  getPassengerTransferFormationOrders,
  getPrimaryPassengerCarrier,
  getThreateningEnemies,
  isPassengerEscortMission,
  scorePassengerCarrierEvasion,
  scorePassengerEscortCourse,
} from './logistics';
import { aiOrdnance } from './ordnance';
import {
  choosePassengerFuelSupportPlan,
  choosePostCarrierLossPursuitPlan,
} from './plans/passenger';
import { scoreCourse } from './scoring';
import type { AIDifficulty } from './types';

// Difficulty-aware constant RNG used exclusively inside the passenger-escort
// lookahead. Lookahead simulates one to two turns of ordnance/combat to
// score candidate orders; using the real match RNG would bake a single dice
// sequence into the score. A stable constant bias per difficulty reflects
// each tier's risk posture without random noise:
//   - easy: 0.4 — plan conservatively, assume the dice are slightly against you
//   - normal: 0.42 — still cautious, but willing to project modestly favorable lines
//   - hard: 0.7 — assume dice are favorable enough to commit to better openings
//
// The triple below was picked by the `scripts/ai-bias-sweep.ts` harness;
// see docs/SIMULATION_TESTING.md for the measurement protocol. Expose as
// `let` so the sweep script can mutate in-process without a rebuild.
export let LOOKAHEAD_BIAS_BY_DIFFICULTY: Record<AIDifficulty, number> = {
  easy: 0.4,
  normal: 0.42,
  hard: 0.7,
};

// Test/sweep-only override. Production callers never touch this.
export const __setLookaheadBiasForSweep = (
  next: Record<AIDifficulty, number>,
): void => {
  LOOKAHEAD_BIAS_BY_DIFFICULTY = next;
};

const createLookaheadRng = (difficulty: AIDifficulty): (() => number) => {
  const bias = LOOKAHEAD_BIAS_BY_DIFFICULTY[difficulty];
  return () => bias;
};

const resolvePreferredLandingTarget = (
  bodyName: string,
  origin: { q: number; r: number },
  map: SolarSystemMap,
): { q: number; r: number } | null => {
  const bases = findBaseHexes(map, bodyName);

  if (bases.length > 0) {
    return (
      minBy(bases, (base) => hexDistance(origin, base)) ?? bases[0] ?? null
    );
  }

  return map.bodies.find((body) => body.name === bodyName)?.center ?? null;
};

const scoreTargetLandingLookahead = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
  targetBody: string,
  map: SolarSystemMap,
  destroyedBases: HexKey[],
  cfg: ReturnType<typeof resolveAIConfig>,
): number => {
  const turnsToLanding =
    course.outcome === 'landing'
      ? course.landedAt === targetBody
        ? 0
        : null
      : estimateTurnsToTargetLanding(
          projectShipAfterCourse(ship, course),
          targetBody,
          map,
          destroyedBases,
        );

  if (turnsToLanding === null || turnsToLanding === 0) {
    return 0;
  }

  if (turnsToLanding === 1) {
    return cfg.navTargetLandingBonus * 0.18 + cfg.navImminentLandingBonus;
  }

  if (turnsToLanding === 2) {
    return cfg.navTargetLandingBonus * 0.1;
  }

  return 0;
};

const scoreObjectiveRaceLine = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
  targetBody: string,
  enemyShip: Ship | null,
  enemyTargetBody: string,
  map: SolarSystemMap,
  destroyedBases: HexKey[],
  cfg: ReturnType<typeof resolveAIConfig>,
): number => {
  if (!targetBody || !enemyShip || !enemyTargetBody) {
    return 0;
  }

  const currentLandingTurns = estimateTurnsToTargetLanding(
    ship,
    targetBody,
    map,
    destroyedBases,
    3,
  );
  const nextLandingTurns =
    course.outcome === 'landing'
      ? course.landedAt === targetBody
        ? 0
        : null
      : estimateTurnsToTargetLanding(
          projectShipAfterCourse(ship, course),
          targetBody,
          map,
          destroyedBases,
          3,
        );
  const enemyLandingTurns = estimateTurnsToTargetLanding(
    enemyShip,
    enemyTargetBody,
    map,
    destroyedBases,
    3,
  );
  let score = 0;
  const nearFinish =
    currentLandingTurns === 1 ||
    currentLandingTurns === 2 ||
    nextLandingTurns === 1 ||
    nextLandingTurns === 2 ||
    enemyLandingTurns === 1 ||
    enemyLandingTurns === 2;

  if (!nearFinish) {
    return 0;
  }

  if (
    currentLandingTurns !== null &&
    currentLandingTurns <= 2 &&
    nextLandingTurns === null
  ) {
    score -= cfg.navTargetLandingBonus * 0.3;
  }

  if (
    currentLandingTurns === 1 &&
    nextLandingTurns !== 0 &&
    nextLandingTurns !== 1
  ) {
    score -= cfg.navTargetLandingBonus * 0.4;
  }

  if (currentLandingTurns === 2 && nextLandingTurns === 1) {
    score += cfg.navImminentLandingBonus * 0.95;
  }

  if (
    currentLandingTurns === 2 &&
    nextLandingTurns !== null &&
    nextLandingTurns > 2
  ) {
    score -= cfg.navImminentLandingBonus * 0.8;
  }

  if (
    nextLandingTurns === 1 &&
    (enemyLandingTurns == null || enemyLandingTurns > 1)
  ) {
    score += cfg.navImminentLandingBonus * 0.6;
  }

  if (
    enemyLandingTurns === 1 &&
    nextLandingTurns !== null &&
    nextLandingTurns > 1
  ) {
    score -= cfg.navImminentLandingBonus * 0.3;
  }

  return score;
};

const scoreRaceRoleCourse = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
  targetHex: { q: number; r: number } | null,
  targetBody: string,
  enemyShips: Ship[],
  cfg: ReturnType<typeof resolveAIConfig>,
): number => {
  if (targetHex == null) {
    return 0;
  }

  const currentDist = hexDistance(ship.position, targetHex);
  const newDist = hexDistance(course.destination, targetHex);
  const nextDist = hexDistance(
    {
      q: course.destination.q + course.newVelocity.dq,
      r: course.destination.r + course.newVelocity.dr,
    },
    targetHex,
  );
  const speed = hexVecLength(course.newVelocity);
  let score =
    (currentDist - newDist) * cfg.navDistWeight * cfg.multiplier * 0.75 +
    (currentDist - nextDist) * cfg.navFinalApproachWeight * cfg.multiplier;

  if (course.outcome === 'landing' && course.landedAt === targetBody) {
    score += cfg.navTargetLandingBonus * 0.4;
  }

  if (newDist <= 3 && speed > 1) {
    score -= (speed - 1) * cfg.navTargetLandingBonus * 0.12;
  }

  const nearestEnemyDist = Math.min(
    ...enemyShips
      .filter(canAttack)
      .map((enemy) => hexDistance(course.destination, enemy.position)),
    Number.POSITIVE_INFINITY,
  );

  if (nearestEnemyDist <= 2 && course.outcome !== 'landing') {
    score -= (3 - nearestEnemyDist) * 45;
  }

  return score;
};

const scoreRaceEscortRoleCourse = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
  raceShip: Ship | null,
  enemyShips: Ship[],
  role: ShipRole | undefined,
): number => {
  if (
    raceShip == null ||
    ship.id === raceShip.id ||
    (role !== 'escort' && role !== 'screen') ||
    !canAttack(ship)
  ) {
    return 0;
  }

  const currentRaceDist = hexDistance(ship.position, raceShip.position);
  const newRaceDist = hexDistance(course.destination, raceShip.position);
  const threateningEnemies = getThreateningEnemies(enemyShips);
  const primaryThreat = minBy(threateningEnemies, (enemy) =>
    hexDistance(raceShip.position, enemy.position),
  );
  let score =
    (currentRaceDist - newRaceDist) * 18 -
    Math.max(0, newRaceDist - 3) * 24 +
    (newRaceDist <= 2 ? 28 : 0);

  if (primaryThreat == null) {
    return score;
  }

  const threatToRaceDist = hexDistance(
    primaryThreat.position,
    raceShip.position,
  );
  const currentThreatDist = hexDistance(ship.position, primaryThreat.position);
  const newThreatDist = hexDistance(course.destination, primaryThreat.position);

  if (threatToRaceDist <= 7) {
    score += (currentThreatDist - newThreatDist) * 26;

    if (newThreatDist <= 2) {
      score += 48;
    }
  } else if (role === 'screen' && newThreatDist <= 2) {
    score -= 60;
  }

  return score;
};

const CHECKPOINT_BOUNDARY_CONTINUATION_DEPTH = 2;

const isInsideMapBounds = (
  position: { q: number; r: number },
  map: SolarSystemMap,
): boolean => {
  const { minQ, maxQ, minR, maxR } = map.bounds;

  return (
    position.q >= minQ &&
    position.q <= maxQ &&
    position.r >= minR &&
    position.r <= maxR
  );
};

const hasInMapContinuation = (
  ship: Ship,
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
  depth: number,
): boolean => {
  if (depth <= 0) {
    return true;
  }

  const directions = [null, 0, 1, 2, 3, 4, 5] as const;

  for (const burn of directions) {
    if (burn !== null && ship.fuel <= 0) {
      continue;
    }

    const course = computeCourse(ship, burn, map, { destroyedBases });

    if (course.outcome === 'crash') {
      continue;
    }

    if (course.outcome === 'landing') {
      return true;
    }

    if (!isInsideMapBounds(course.destination, map)) {
      continue;
    }

    const projectedShip = projectShipAfterCourse(ship, course);

    if (hasInMapContinuation(projectedShip, map, destroyedBases, depth - 1)) {
      return true;
    }
  }

  return false;
};

const scoreCheckpointBoundaryContinuation = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
  cfg: ReturnType<typeof resolveAIConfig>,
): number => {
  if (course.outcome === 'landing') {
    return 0;
  }

  if (!isInsideMapBounds(course.destination, map)) {
    return -cfg.navTargetLandingBonus * cfg.multiplier * 4;
  }

  const projectedShip = projectShipAfterCourse(ship, course);

  return hasInMapContinuation(
    projectedShip,
    map,
    destroyedBases,
    CHECKPOINT_BOUNDARY_CONTINUATION_DEPTH,
  )
    ? 0
    : -cfg.navTargetLandingBonus * cfg.multiplier * 3;
};

const scoreCheckpointRammingAvoidance = (
  course: ReturnType<typeof computeCourse>,
  enemyShips: Ship[],
  cfg: ReturnType<typeof resolveAIConfig>,
): number => {
  if (course.outcome === 'landing') {
    return 0;
  }

  const activeEnemyAtDestination = enemyShips.some(
    (enemy) =>
      enemy.lifecycle === 'active' &&
      enemy.position.q === course.destination.q &&
      enemy.position.r === course.destination.r,
  );

  return activeEnemyAtDestination
    ? -cfg.navTargetLandingBonus * cfg.multiplier * 3
    : 0;
};

const pickFuelAwareCheckpointTarget = (
  player: GameState['players'][PlayerId],
  checkpoints: readonly string[],
  ship: Ship,
  map: SolarSystemMap,
  sharedBases: readonly string[],
  destroyedBases: GameState['destroyedBases'],
): string | null => {
  const nextBody = pickNextCheckpoint(player, checkpoints, map, ship.position);

  if (!nextBody) {
    return null;
  }

  const visitedBodies = new Set(player.visitedBodies ?? []);
  const nextCenter = map.bodies.find((body) => body.name === nextBody)?.center;
  const nextHasRefuelBase =
    nextBody === player.homeBody || sharedBases.includes(nextBody);

  if (!nextCenter || nextHasRefuelBase) {
    return nextBody;
  }

  const nextCheckpointCost = estimateMovementCostToHex(
    ship,
    nextCenter,
    map,
    destroyedBases,
    4,
  );
  const fuelForTrip = nextCheckpointCost.estimatedFuelCost;
  const continuationBase = findNearestRefuelBase(
    nextCenter,
    player.bases,
    sharedBases,
    map,
  );
  const continuationFuel =
    continuationBase == null
      ? Number.POSITIVE_INFINITY
      : estimateFuelForTravelDistance(
          hexDistance(nextCenter, continuationBase),
        );

  if (ship.fuel >= fuelForTrip + continuationFuel) {
    return nextBody;
  }

  const fuelBaseCandidates = checkpoints.filter(
    (body) =>
      !visitedBodies.has(body) &&
      body !== nextBody &&
      (body === player.homeBody || sharedBases.includes(body)),
  );

  if (fuelBaseCandidates.length === 0) {
    return nextBody;
  }

  const bestFuelCandidate = minBy(fuelBaseCandidates, (body) => {
    const center = map.bodies.find(
      (candidate) => candidate.name === body,
    )?.center;

    if (!center) {
      return Number.POSITIVE_INFINITY;
    }

    const directCost = estimateMovementCostToHex(
      ship,
      center,
      map,
      destroyedBases,
      4,
    );

    if (!directCost.reachableWithinFuel) {
      return Number.POSITIVE_INFINITY;
    }

    const remainingTourCost = estimateRemainingCheckpointTourCost(
      {
        ...player,
        visitedBodies: [...visitedBodies, body],
      },
      checkpoints,
      map,
      center,
    );

    return directCost.score + remainingTourCost * 40;
  });

  return bestFuelCandidate ?? nextBody;
};

const getPassengerEmergencyEscortOrders = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  targetHex: { q: number; r: number } | null,
  targetBody: string,
  escapeWins: boolean,
  enemyShips: Ship[],
  difficulty: AIDifficulty,
  enemyEscaping: boolean,
  enemyHasPassengerObjective: boolean,
  // The lookahead no longer consumes the outer match RNG — it uses a
  // difficulty-biased constant via `createLookaheadRng` instead (easy 0.4,
  // normal 0.42, hard 0.7). We accept the parameter for API parity with the
  // enclosing `aiAstrogation` signature, but intentionally don't pass it
  // into the simulation. Underscore-prefixed so lint flags any future
  // misuse.
  _rng: () => number,
): Map<string, AstrogationOrder> => {
  if (!isPassengerEscortMission(state, playerId)) {
    return new Map();
  }

  const passengerShipRoles = assignPassengerShipRoles(state, playerId, map);
  const primaryCarrier = getPrimaryPassengerCarrier(state, playerId, map);

  if (primaryCarrier == null) {
    return new Map();
  }

  const threats = getThreateningEnemies(enemyShips);
  const primaryThreat = minBy(threats, (enemy) =>
    hexDistance(primaryCarrier.position, enemy.position),
  );

  if (
    primaryThreat == null ||
    hexDistance(primaryCarrier.position, primaryThreat.position) > 2
  ) {
    return new Map();
  }

  const escort = maxBy(
    state.ships.filter((ship) => {
      const role = passengerShipRoles.get(ship.id);

      return (
        ship.owner === playerId &&
        ship.id !== primaryCarrier.id &&
        ship.lifecycle !== 'destroyed' &&
        canAttack(ship) &&
        (role === 'escort' || role === 'screen')
      );
    }),
    (ship) =>
      getCombatStrength([ship]) * 10 -
      hexDistance(ship.position, primaryCarrier.position),
  );

  if (!escort) {
    return new Map();
  }

  // Difficulty-aware RNG bias for lookahead. The lookahead simulates one or
  // two future turns' ordnance/combat to score candidate orders; using the
  // outer match RNG would bake one particular dice sequence into the score
  // and make the AI's expected-value reasoning brittle. A constant mid-bias
  // (easy < normal < hard) keeps the lookahead stable and mirrors each
  // difficulty's risk posture — easy AI anticipates slightly unfavourable
  // rolls, hard AI slightly favourable.
  const lookaheadRng = createLookaheadRng(difficulty);

  const evaluateCandidateOutcome = (
    carrierOrder: AstrogationOrder,
    escortOrder: AstrogationOrder,
  ): number => {
    let simulated = structuredClone(state);
    const myOrders = simulated.ships
      .filter((ship) => ship.owner === playerId)
      .map((ship) => {
        if (ship.id === carrierOrder.shipId) {
          return carrierOrder;
        }

        if (ship.id === escortOrder.shipId) {
          return escortOrder;
        }

        return {
          shipId: ship.id,
          burn: null,
          overload: null,
        };
      });
    const firstResult = processAstrogation(
      simulated,
      playerId,
      myOrders,
      map,
      lookaheadRng,
    );

    if ('error' in firstResult) {
      return -Infinity;
    }
    simulated = firstResult.state;

    while (
      simulated.phase !== 'gameOver' &&
      simulated.turnNumber <= state.turnNumber + 1
    ) {
      if (
        simulated.phase === 'astrogation' &&
        simulated.activePlayer === playerId &&
        simulated.turnNumber > state.turnNumber
      ) {
        break;
      }

      const actor = simulated.activePlayer;

      if (simulated.phase === 'astrogation') {
        const orders = aiAstrogation(
          simulated,
          actor,
          map,
          difficulty,
          lookaheadRng,
        );
        const result = processAstrogation(
          simulated,
          actor,
          orders,
          map,
          lookaheadRng,
        );

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      if (simulated.phase === 'ordnance') {
        const launches = aiOrdnance(
          simulated,
          actor,
          map,
          difficulty,
          lookaheadRng,
        );
        const result =
          launches.length > 0
            ? processOrdnance(simulated, actor, launches, map, lookaheadRng)
            : skipOrdnance(simulated, actor, map, lookaheadRng);

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      if (simulated.phase === 'logistics') {
        const transfers = aiLogistics(simulated, actor, map, difficulty);
        const result =
          transfers.length > 0
            ? processLogistics(simulated, actor, transfers, map)
            : skipLogistics(simulated, actor, map);

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      if (simulated.phase === 'combat') {
        const preResult = beginCombatPhase(simulated, actor, map, lookaheadRng);

        if ('error' in preResult) {
          return -Infinity;
        }
        simulated = preResult.state;
        if (simulated.phase !== 'combat') {
          continue;
        }

        const attacks = aiCombat(simulated, actor, map, difficulty);
        const result =
          attacks.length > 0
            ? processCombat(simulated, actor, attacks, map, lookaheadRng)
            : skipCombat(simulated, actor, map, lookaheadRng);

        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      break;
    }

    const simulatedCarrier = simulated.ships.find(
      (ship) => ship.id === primaryCarrier.id,
    );

    if (!simulatedCarrier) {
      return -Infinity;
    }

    if (
      simulated.outcome?.winner === 1 ||
      simulatedCarrier.lifecycle === 'destroyed'
    ) {
      return -10_000;
    }

    const distToTarget =
      targetHex == null ? 0 : hexDistance(simulatedCarrier.position, targetHex);

    return (
      (simulatedCarrier.passengersAboard ?? 0) * 5 -
      simulatedCarrier.damage.disabledTurns * 180 -
      distToTarget * 10 +
      (simulated.phase === 'gameOver' && simulated.outcome?.winner === playerId
        ? 5_000
        : 0)
    );
  };

  const cfg = resolveAIConfig(
    difficulty,
    state.scenarioRules?.aiConfigOverrides as
      | Parameters<typeof resolveAIConfig>[1]
      | undefined,
  );
  const carrierBurns = [0, 1, 2, 3, 4, 5] as const;
  const escortBurns = [null, 0, 1, 2, 3, 4, 5] as const;
  let bestScore = -Infinity;
  let bestCarrierOrder: AstrogationOrder | null = null;
  let bestEscortOrder: AstrogationOrder | null = null;

  for (const carrierBurn of carrierBurns) {
    const carrierCourse = computeCourse(primaryCarrier, carrierBurn, map, {
      destroyedBases: state.destroyedBases,
    });

    if (carrierCourse.outcome === 'crash') {
      continue;
    }

    const projectedCarrier = projectShipAfterCourse(
      primaryCarrier,
      carrierCourse,
    );

    for (const escortBurn of escortBurns) {
      const escortStats = SHIP_STATS[escort.type];
      const escortOverloads =
        escortBurn != null &&
        difficulty !== 'easy' &&
        escortStats?.canOverload &&
        escort.fuel >= 2 &&
        !escort.overloadUsed &&
        deriveCapabilities(state.scenarioRules).combatEnabled
          ? [null, 0, 1, 2, 3, 4, 5]
          : [null];

      for (const escortOverload of escortOverloads) {
        const escortCourse = computeCourse(escort, escortBurn, map, {
          ...(escortOverload != null ? { overload: escortOverload } : {}),
          destroyedBases: state.destroyedBases,
        });

        if (escortCourse.outcome === 'crash') {
          continue;
        }

        const spacing = hexDistance(
          carrierCourse.destination,
          escortCourse.destination,
        );
        const score =
          scoreCourse({
            ship: primaryCarrier,
            course: carrierCourse,
            targetHex,
            targetBody,
            escapeWins,
            escapeEdge: state.scenarioRules.escapeEdge ?? 'any',
            enemyShips,
            cfg,
            map,
            isRace: false,
            enemyEscaping,
            enemyHasPassengerObjective,
            shipIndex: 0,
          }) +
          scorePassengerCarrierEvasion(
            primaryCarrier,
            carrierCourse,
            enemyShips,
          ) +
          scoreCourse({
            ship: escort,
            course: escortCourse,
            targetHex: null,
            targetBody: '',
            escapeWins: false,
            escapeEdge: state.scenarioRules.escapeEdge ?? 'any',
            enemyShips,
            cfg,
            map,
            isRace: false,
            enemyEscaping,
            enemyHasPassengerObjective,
            shipIndex: 1,
          }) +
          scorePassengerEscortCourse(
            escort,
            escortCourse,
            projectedCarrier,
            enemyShips,
          ) +
          (spacing === 0 ? 220 : spacing === 1 ? 40 : -spacing * 30) +
          evaluateCandidateOutcome(
            {
              shipId: primaryCarrier.id,
              burn: carrierBurn,
              overload: null,
            },
            {
              shipId: escort.id,
              burn: escortBurn,
              overload: escortOverload,
            },
          );

        if (score > bestScore) {
          bestScore = score;
          bestCarrierOrder = {
            shipId: primaryCarrier.id,
            burn: carrierBurn,
            overload: null,
          };
          bestEscortOrder = {
            shipId: escort.id,
            burn: escortBurn,
            overload: escortOverload,
          };
        }
      }
    }
  }

  if (bestCarrierOrder == null || bestEscortOrder == null) {
    return new Map();
  }

  return new Map([
    [bestCarrierOrder.shipId, bestCarrierOrder],
    [bestEscortOrder.shipId, bestEscortOrder],
  ]);
};

export const aiAstrogation = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty,
  // rng is required — no default. The AI's passenger-escort lookahead
  // simulates ordnance and combat internally, so the caller must supply
  // the same RNG used for the outer turn resolution so simulation stays
  // deterministic with production play and replay. Forgetting is a compile
  // error, which is the point: a production call that accidentally relied
  // on `Math.random` would silently desync from the authoritative engine.
  rng: () => number,
): AstrogationOrder[] => {
  const cfg = resolveAIConfig(
    difficulty,
    state.scenarioRules?.aiConfigOverrides as
      | Parameters<typeof resolveAIConfig>[1]
      | undefined,
  );
  const orders: AstrogationOrder[] = [];
  const { targetBody, escapeWins } = state.players[playerId];
  const player = state.players[playerId];
  const passengerEscortMission = isPassengerEscortMission(state, playerId);
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const enemyEscaping = state.players[opponentId]?.escapeWins === true;
  const enemyHasTargetObjective = !!state.players[opponentId]?.targetBody;
  const enemyHasPassengerObjective =
    enemyHasTargetObjective &&
    state.ships.some(
      (ship) =>
        ship.owner === opponentId &&
        ship.lifecycle !== 'destroyed' &&
        (ship.passengersAboard ?? 0) > 0,
    );
  const defaultTargetHex: {
    q: number;
    r: number;
  } | null = targetBody
    ? (map.bodies.find((body) => body.name === targetBody)?.center ?? null)
    : null;
  const caps = deriveCapabilities(state.scenarioRules);
  const checkpoints = caps.isCheckpointRace ? caps.checkpointBodies : null;
  const enemyShips = state.ships.filter(
    (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
  );
  const myCombatShips = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      ship.baseStatus !== 'emplaced' &&
      canAttack(ship),
  );
  const enemyCombatShips = enemyShips.filter(canAttack);
  const objectiveRaceOpponent =
    !caps.isCheckpointRace &&
    !caps.targetWinRequiresPassengers &&
    player.targetBody &&
    player.homeBody &&
    myCombatShips.length === 1 &&
    enemyCombatShips.length === 1
      ? enemyCombatShips[0]
      : null;
  const objectiveRaceOpponentTargetBody =
    objectiveRaceOpponent != null
      ? (state.players[objectiveRaceOpponent.owner]?.targetBody ?? '')
      : '';
  const homeDefenseThreat =
    !escapeWins && !passengerEscortMission
      ? getHomeDefenseThreat(state, playerId, map, enemyShips)
      : null;
  const homeDefenseHex =
    homeDefenseThreat != null
      ? (map.bodies.find((body) => body.name === player.homeBody)?.center ??
        null)
      : null;
  const primaryPassengerCarrier = passengerEscortMission
    ? getPrimaryPassengerCarrier(state, playerId, map)
    : null;
  const turnShipRoles = assignTurnShipRoles(state, playerId, map);
  const raceRoleShipId = [...turnShipRoles.entries()].find(
    ([, role]) => role === 'race',
  )?.[0];
  const raceRoleShip =
    raceRoleShipId != null
      ? (state.ships.find((candidate) => candidate.id === raceRoleShipId) ??
        null)
      : null;
  const primaryPassengerThreatDist =
    passengerEscortMission && primaryPassengerCarrier != null
      ? Math.min(
          ...getThreateningEnemies(enemyShips).map((enemy) =>
            hexDistance(primaryPassengerCarrier.position, enemy.position),
          ),
          Number.POSITIVE_INFINITY,
        )
      : Number.POSITIVE_INFINITY;
  const passengerTransferFormationOrders = getPassengerTransferFormationOrders(
    state,
    playerId,
    map,
    defaultTargetHex,
    targetBody,
    escapeWins,
    enemyShips,
    cfg,
    difficulty,
    !!checkpoints,
    enemyEscaping,
    enemyHasPassengerObjective,
  );
  const passengerEmergencyEscortOrders = getPassengerEmergencyEscortOrders(
    state,
    playerId,
    map,
    defaultTargetHex,
    targetBody,
    escapeWins,
    enemyShips,
    difficulty,
    enemyEscaping,
    enemyHasPassengerObjective,
    rng,
  );
  let shipIdx = 0;

  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    if (ship.lifecycle === 'destroyed') continue;
    if (ship.baseStatus === 'emplaced') continue;

    if (ship.control === 'captured') {
      orders.push({
        shipId: ship.id,
        burn: null,
        overload: null,
      });
      continue;
    }

    if (ship.damage.disabledTurns > 0) {
      orders.push({
        shipId: ship.id,
        burn: null,
        overload: null,
      });
      continue;
    }

    const emergencyOrder = passengerEmergencyEscortOrders.get(ship.id);

    if (emergencyOrder) {
      orders.push(emergencyOrder);
      shipIdx++;
      continue;
    }

    const formationOrder = passengerTransferFormationOrders.get(ship.id);

    if (formationOrder) {
      orders.push(formationOrder);
      shipIdx++;
      continue;
    }

    const fuelSupportPlan = choosePassengerFuelSupportPlan(
      state,
      playerId,
      ship,
      orders,
      map,
    );

    if (fuelSupportPlan) {
      const action = fuelSupportPlan.chosen.action;
      orders.push({
        shipId: action.shipId,
        burn: action.burn,
        overload: action.overload,
      });
      shipIdx++;
      continue;
    }

    let shipTargetHex = defaultTargetHex;
    let shipTargetBody = targetBody;
    let seekingFuel = false;
    const shipRole = turnShipRoles.get(ship.id);

    if (shipTargetBody) {
      shipTargetHex = resolvePreferredLandingTarget(
        shipTargetBody,
        ship.position,
        map,
      );
    }

    if (
      passengerEscortMission &&
      primaryPassengerCarrier == null &&
      canAttack(ship) &&
      (ship.passengersAboard ?? 0) === 0
    ) {
      shipTargetHex = null;
      shipTargetBody = '';
    }

    if (
      passengerEscortMission &&
      primaryPassengerCarrier != null &&
      primaryPassengerThreatDist <= 5 &&
      ship.id !== primaryPassengerCarrier.id &&
      canAttack(ship) &&
      (ship.passengersAboard ?? 0) === 0
    ) {
      shipTargetHex = null;
      shipTargetBody = '';
    }

    if (checkpoints && player.visitedBodies) {
      const nextBody =
        pickFuelAwareCheckpointTarget(
          player,
          checkpoints,
          ship,
          map,
          caps.sharedBases,
          state.destroyedBases,
        ) ?? '';
      shipTargetBody = nextBody;
      shipTargetHex = nextBody
        ? resolvePreferredLandingTarget(nextBody, ship.position, map)
        : null;

      if (shipTargetHex && ship.lifecycle !== 'landed') {
        const distToTarget = hexDistance(ship.position, shipTargetHex);
        const speed = hexVecLength(ship.velocity);
        const fuelForTrip = estimateFuelForTravelDistance(distToTarget, speed);
        const targetHasRefuelBase =
          nextBody === player.homeBody || caps.sharedBases.includes(nextBody);
        if (targetHasRefuelBase && ship.fuel <= fuelForTrip + 2) {
          seekingFuel = true;
        }
        const continuationFuel =
          targetHasRefuelBase || shipTargetHex == null
            ? 0
            : (() => {
                const continuationBase = findNearestRefuelBase(
                  shipTargetHex,
                  player.bases,
                  caps.sharedBases,
                  map,
                );

                if (!continuationBase) {
                  return Number.POSITIVE_INFINITY;
                }

                return estimateFuelForTravelDistance(
                  hexDistance(shipTargetHex, continuationBase),
                );
              })();
        const standingBaseBody = map.hexes.get(hexKey(ship.position))?.base
          ?.bodyName;
        const standingOnRefuelBase =
          standingBaseBody != null &&
          (standingBaseBody === player.homeBody ||
            caps.sharedBases.includes(standingBaseBody));

        if (
          standingOnRefuelBase &&
          ship.fuel <= fuelForTrip + continuationFuel + 4
        ) {
          shipTargetBody = standingBaseBody;
          shipTargetHex = ship.position;
          seekingFuel = true;
        }

        if (ship.fuel < fuelForTrip + continuationFuel) {
          // Prefer a base the planner can actually thread to within the
          // current fuel envelope. The legacy `nearest base + naive
          // reachability` path stays as a fallback so a momentum-spike
          // beyond what the 3-turn planner explores doesn't silently
          // strand the ship — better to commit to a plausible target than
          // freeze.
          const reachableBase = findReachableRefuelBase(
            ship,
            player.bases,
            caps.sharedBases,
            map,
            state.destroyedBases,
          );
          const basePos =
            reachableBase ??
            findNearestRefuelBase(
              ship.position,
              player.bases,
              caps.sharedBases,
              map,
            );

          if (basePos) {
            const baseDist = hexDistance(ship.position, basePos);
            const baseBody =
              map.hexes.get(hexKey(basePos))?.base?.bodyName ?? '';

            const planSaysReachable = reachableBase != null;
            const heuristicSaysReachable =
              baseDist < distToTarget && baseDist <= ship.fuel + speed + 2;

            if (planSaysReachable || heuristicSaysReachable) {
              shipTargetHex = basePos;
              shipTargetBody = baseBody;
              seekingFuel = true;
            }
          }
        }

        const orbitBody = detectOrbit(ship, map);
        const orbitCenter = orbitBody
          ? resolvePreferredLandingTarget(orbitBody, ship.position, map)
          : null;
        const orbitHasRefuelBase =
          orbitBody != null &&
          (orbitBody === player.homeBody ||
            caps.sharedBases.includes(orbitBody));

        if (
          orbitBody &&
          orbitCenter &&
          orbitHasRefuelBase &&
          ship.fuel <= fuelForTrip + continuationFuel + 1
        ) {
          shipTargetBody = orbitBody;
          shipTargetHex = orbitCenter;
          seekingFuel = true;
        }
      }
    }

    let bestBurn: number | null = null;
    let bestOverload: number | null = null;
    let bestLand = false;
    let bestScore = -Infinity;
    let bestInterceptTiebreak = -Infinity;
    let bestFuelSpent = Number.POSITIVE_INFINITY;
    const stats = SHIP_STATS[ship.type];
    const canBurnFuel = ship.fuel > 0;
    const currentOrbitBody = detectOrbit(ship, map);
    const currentBaseBody = map.hexes.get(hexKey(ship.position))?.base
      ?.bodyName;
    const interceptingEnemy =
      (enemyEscaping ||
        enemyHasPassengerObjective ||
        enemyHasTargetObjective) &&
      !escapeWins &&
      shipTargetHex == null;
    const nearbyEnemy = enemyShips.some(
      (enemy) => hexDistance(ship.position, enemy.position) <= 4,
    );
    const objectiveDriveDiscipline =
      shipTargetHex != null && !passengerEscortMission && !checkpoints;
    const allowsCorrectiveBurnLookahead =
      !!checkpoints ||
      shipTargetHex != null ||
      passengerEscortMission ||
      interceptingEnemy;
    const canOverload =
      difficulty !== 'easy' &&
      stats?.canOverload &&
      ship.fuel >= 2 &&
      !ship.overloadUsed &&
      deriveCapabilities(state.scenarioRules).combatEnabled &&
      (!objectiveDriveDiscipline || nearbyEnemy) &&
      !(
        passengerEscortMission &&
        primaryPassengerCarrier != null &&
        ship.id !== primaryPassengerCarrier.id &&
        canAttack(ship) &&
        (ship.passengersAboard ?? 0) === 0 &&
        primaryPassengerThreatDist > 5
      );
    type BurnOption = {
      burn: number | null;
      overload: number | null;
      land?: boolean;
      weakGravityChoices?: Record<HexKey, boolean>;
    };
    const directions = [0, 1, 2, 3, 4, 5] as const;
    const currentHex = map.hexes.get(hexKey(ship.position));
    const canBrakeToLandOnBase =
      ship.lifecycle !== 'landed' &&
      hexVecLength(ship.velocity) === 1 &&
      currentHex?.base != null &&
      currentHex.gravity?.bodyName === currentHex.base.bodyName;
    const inOrbit = detectOrbit(ship, map) !== null || canBrakeToLandOnBase;
    const options: BurnOption[] = [
      { burn: null, overload: null },
      ...(canBurnFuel
        ? directions.flatMap((direction) => [
            { burn: direction, overload: null },
            ...(canOverload
              ? directions.map((overload) => ({
                  burn: direction,
                  overload: overload as number | null,
                }))
              : []),
          ])
        : []),
      ...(canBurnFuel && shipTargetBody
        ? directions.map((direction) => ({
            burn: direction,
            overload: null,
            land: true,
          }))
        : []),
      // Add a single landing option when in orbit.
      // Burn direction is irrelevant for landing, so
      // one candidate suffices.
      ...(inOrbit ? [{ burn: 0, overload: null, land: true }] : []),
    ];
    let bestWeakGrav: Record<string, boolean> | undefined;

    for (const opt of options) {
      const courseOpts = {
        ...(opt.overload !== null ? { overload: opt.overload } : {}),
        ...(opt.land ? { land: true } : {}),
        destroyedBases: state.destroyedBases,
      };
      const course = computeCourse(ship, opt.burn, map, courseOpts);

      if (course.outcome === 'crash') continue;
      if (opt.land && course.outcome !== 'landing') continue;

      let gravityRiskPenalty = 0;
      const fuelAfterCourse = ship.fuel - course.fuelSpent;

      if (course.outcome !== 'landing') {
        const simShip = projectShipAfterCourse(ship, course);
        const driftCourse = computeCourse(simShip, null, map, {
          destroyedBases: state.destroyedBases,
        });

        if (driftCourse.outcome === 'crash') {
          if (!allowsCorrectiveBurnLookahead) {
            continue;
          }
          if (fuelAfterCourse <= 0) continue;

          let canSurvive = false;
          for (let d2 = 0; d2 < 6; d2++) {
            const escapeResult = computeCourse(simShip, d2, map, {
              destroyedBases: state.destroyedBases,
            });

            if (escapeResult.outcome === 'crash') continue;

            if (escapeResult.outcome !== 'landing' && fuelAfterCourse > 1) {
              const sim2 = projectShipAfterCourse(simShip, escapeResult);
              const drift2 = computeCourse(sim2, null, map, {
                destroyedBases: state.destroyedBases,
              });

              if (drift2.outcome === 'crash') {
                let canSurvive2 = false;
                for (let d3 = 0; d3 < 6; d3++) {
                  const esc2 = computeCourse(sim2, d3, map, {
                    destroyedBases: state.destroyedBases,
                  });

                  if (esc2.outcome !== 'crash') {
                    canSurvive2 = true;
                    break;
                  }
                }

                if (!canSurvive2) continue;
              }
            }
            canSurvive = true;
            break;
          }

          if (!canSurvive) continue;
          gravityRiskPenalty = interceptingEnemy ? 0 : cfg.gravityRiskPenalty;
        }
      }

      let score =
        scoreCourse({
          ship,
          course,
          targetHex: shipTargetHex,
          targetBody: shipTargetBody,
          escapeWins,
          escapeEdge: caps.escapeEdge,
          enemyShips,
          cfg,
          map,
          isRace: !!checkpoints,
          enemyEscaping,
          enemyHasPassengerObjective,
          enemyHasTargetObjective,
          shipIndex: shipIdx,
        }) + gravityRiskPenalty;

      if (
        homeDefenseThreat != null &&
        homeDefenseHex != null &&
        canAttack(ship)
      ) {
        score += scoreObjectiveHomeDefenseCourse(
          ship,
          course,
          homeDefenseThreat,
          homeDefenseHex,
        );
      }

      if (
        currentOrbitBody &&
        shipTargetBody &&
        currentOrbitBody === shipTargetBody &&
        course.outcome !== 'landing'
      ) {
        score -= cfg.navImminentLandingBonus * 2;
      }

      if (
        seekingFuel &&
        currentOrbitBody &&
        (currentOrbitBody === player.homeBody ||
          caps.sharedBases.includes(currentOrbitBody)) &&
        course.outcome !== 'landing'
      ) {
        score -= cfg.fuelSeekLandingBonus;
      }

      if (
        seekingFuel &&
        currentBaseBody &&
        (currentBaseBody === player.homeBody ||
          caps.sharedBases.includes(currentBaseBody))
      ) {
        const distFromCurrentBase = hexDistance(
          course.destination,
          ship.position,
        );

        score -= distFromCurrentBase * 180;
        score -= hexVecLength(course.newVelocity) * 60;

        if (
          course.outcome === 'landing' &&
          course.landedAt === currentBaseBody
        ) {
          score += cfg.fuelSeekLandingBonus;
        }
      }

      let comparisonCourse = course;

      if (passengerEscortMission) {
        score += scorePassengerCarrierEvasion(ship, course, enemyShips);
        if (shipRole === 'escort' || shipRole === 'screen') {
          score += scorePassengerEscortCourse(
            ship,
            course,
            primaryPassengerCarrier,
            enemyShips,
          );
        }
      } else if (shipRole === 'race' && !checkpoints) {
        score += scoreRaceRoleCourse(
          ship,
          course,
          shipTargetHex,
          shipTargetBody,
          enemyShips,
          cfg,
        );
      } else {
        score += scoreRaceEscortRoleCourse(
          ship,
          course,
          raceRoleShip,
          enemyShips,
          shipRole,
        );
      }

      if (seekingFuel && course.outcome === 'landing') {
        score += cfg.fuelSeekLandingBonus;
      }

      if (seekingFuel && shipTargetHex != null) {
        const currentDist = hexDistance(ship.position, shipTargetHex);
        const newDist = hexDistance(course.destination, shipTargetHex);
        const currentSpeed = hexVecLength(ship.velocity);
        const newSpeed = hexVecLength(course.newVelocity);
        const currentFuelMargin =
          ship.fuel - estimateFuelForTravelDistance(currentDist, currentSpeed);
        const newFuelMargin =
          fuelAfterCourse - estimateFuelForTravelDistance(newDist, newSpeed);

        score += (newFuelMargin - currentFuelMargin) * 70;
        score += (currentDist - newDist) * 45;

        if (fuelAfterCourse <= 1 && course.outcome !== 'landing') {
          score -= 420;
        }

        if (newDist <= 2 && course.outcome !== 'landing') {
          score -= newSpeed * 110;
        }
      }

      if (
        checkpoints &&
        !seekingFuel &&
        shipTargetHex != null &&
        ship.lifecycle !== 'landed' &&
        course.outcome !== 'landing'
      ) {
        const currentDist = hexDistance(ship.position, shipTargetHex);
        const newDist = hexDistance(course.destination, shipTargetHex);
        const currentSpeed = hexVecLength(ship.velocity);
        const newSpeed = hexVecLength(course.newVelocity);

        if (currentSpeed === 0 && currentDist <= 3) {
          score += (currentDist - newDist) * cfg.navTargetLandingBonus * 0.25;

          if (opt.burn === null) {
            score -= cfg.navStayLandedPenalty * cfg.multiplier * 10;
          }
        }

        if (currentDist <= 2 && newDist < currentDist && newSpeed <= 1) {
          score += cfg.navImminentLandingBonus * cfg.multiplier;
        }
      }

      if (checkpoints && !escapeWins && !seekingFuel) {
        score += scoreCheckpointBoundaryContinuation(
          ship,
          course,
          map,
          state.destroyedBases,
          cfg,
        );
        score += scoreCheckpointRammingAvoidance(course, enemyShips, cfg);
      }

      if (
        shipTargetBody &&
        !checkpoints &&
        !passengerEscortMission &&
        !seekingFuel &&
        shipTargetHex != null &&
        hexDistance(ship.position, shipTargetHex) <= 6
      ) {
        score += scoreTargetLandingLookahead(
          ship,
          course,
          shipTargetBody,
          map,
          state.destroyedBases,
          cfg,
        );
      }

      if (
        objectiveRaceOpponent != null &&
        ship.id === myCombatShips[0]?.id &&
        shipTargetBody &&
        !seekingFuel
      ) {
        score += scoreObjectiveRaceLine(
          ship,
          course,
          shipTargetBody,
          objectiveRaceOpponent,
          objectiveRaceOpponentTargetBody,
          map,
          state.destroyedBases,
          cfg,
        );
      }

      if (
        checkpoints &&
        course.outcome === 'landing' &&
        course.landedAt !== shipTargetBody &&
        !seekingFuel
      ) {
        score -= cfg.navTargetLandingBonus;
      }

      if (checkpoints && player.visitedBodies) {
        const destinationHex = map.hexes.get(hexKey(course.destination));
        const destinationBodyName =
          destinationHex?.base?.bodyName ?? destinationHex?.gravity?.bodyName;

        if (
          destinationBodyName &&
          destinationBodyName !== shipTargetBody &&
          player.visitedBodies.includes(destinationBodyName)
        ) {
          score -= cfg.navTargetLandingBonus;

          if (course.outcome === 'landing') {
            score -= cfg.navTargetLandingBonus;
          }
        }
      }

      if (opt.burn === null) {
        if (!interceptingEnemy) {
          // Coast bonus / penalty. The legacy unconditional bonus
          // (combined with the fuel-spent tie-break at line ~1465)
          // produces fleet-scale fuel stalls: a stationary fueled ship
          // ties any productive burn on raw score, then wins the
          // tie-break by spending zero fuel. To break that, reward
          // coast only when it's actually correct (fuel tight, drift
          // closes the gap, or there's nothing to chase) and *penalise*
          // it when there's a real target or live enemies and the
          // coast doesn't progress. Penalty magnitude exceeds the
          // legacy +0.5 drift bonus and the navigation tie threshold so
          // a productive burn wins the choice deterministically.
          const fuelTight = ship.fuel <= 4 || seekingFuel;
          const driftClosesDistance =
            shipTargetHex != null &&
            hexDistance(course.destination, shipTargetHex) <
              hexDistance(ship.position, shipTargetHex);
          const hasPursuitTargets =
            passengerEscortMission && primaryPassengerCarrier == null
              ? enemyShips.length > 0
              : enemyCombatShips.length > 0 ||
                (shipTargetHex == null && enemyShips.length > 0);
          const nothingToDo = shipTargetHex == null && !hasPursuitTargets;
          const stationary =
            hexVecLength(ship.velocity) === 0 &&
            hexVecLength(course.newVelocity) === 0;

          if (fuelTight || driftClosesDistance || nothingToDo) {
            score += cfg.fuelDriftBonus;
          } else if (stationary && canBurnFuel) {
            // Penalty has to clear the fuel-spent tie-break (~0) plus
            // any spurious closing/positioning ties; the legacy
            // scoreNavigation stay-landed penalty doesn't apply here
            // because fleetAction-style ships have no targetHex.
            score -= 10 * cfg.multiplier;
          }
        }
      } else if (opt.overload !== null) {
        const overloadPenalty =
          cfg.fuelOverloadPenalty +
          (shipTargetHex != null ? (checkpoints ? 8 : 4) : 0) +
          (passengerEscortMission ? 2 : 0);
        score -= overloadPenalty * cfg.multiplier;
      }

      let bestLocalWG: Record<string, boolean> | undefined;

      if (
        difficulty !== 'easy' &&
        course.enteredGravityEffects.some(
          (effect) => effect.strength === 'weak',
        )
      ) {
        const weakHexes = course.enteredGravityEffects.filter(
          (effect) => effect.strength === 'weak',
        );

        for (const weakGravity of weakHexes) {
          const weakGravityChoices: Record<string, boolean> = {
            [hexKey(weakGravity.hex)]: true,
          };
          const altCourse = computeCourse(ship, opt.burn, map, {
            ...courseOpts,
            weakGravityChoices,
          });

          if (altCourse.outcome === 'crash') continue;

          if (altCourse.outcome !== 'landing') {
            const simShip2 = projectShipAfterCourse(ship, altCourse);
            const nextAlt = computeCourse(simShip2, null, map, {
              destroyedBases: state.destroyedBases,
            });

            if (nextAlt.outcome === 'crash') continue;
          }

          const altScore = scoreCourse({
            ship,
            course: altCourse,
            targetHex: shipTargetHex,
            targetBody: shipTargetBody,
            escapeWins,
            escapeEdge: caps.escapeEdge,
            enemyShips,
            cfg,
            map,
            isRace: !!checkpoints,
            enemyEscaping,
            enemyHasPassengerObjective,
            enemyHasTargetObjective,
            shipIndex: shipIdx,
          });
          const altDefenseScore =
            homeDefenseThreat != null &&
            homeDefenseHex != null &&
            canAttack(ship)
              ? scoreObjectiveHomeDefenseCourse(
                  ship,
                  altCourse,
                  homeDefenseThreat,
                  homeDefenseHex,
                )
              : 0;
          const altLandingLookaheadScore =
            shipTargetBody &&
            !checkpoints &&
            !passengerEscortMission &&
            !seekingFuel &&
            shipTargetHex != null &&
            hexDistance(ship.position, shipTargetHex) <= 6
              ? scoreTargetLandingLookahead(
                  ship,
                  altCourse,
                  shipTargetBody,
                  map,
                  state.destroyedBases,
                  cfg,
                )
              : 0;

          if (altScore + altDefenseScore + altLandingLookaheadScore > score) {
            score = altScore + altDefenseScore + altLandingLookaheadScore;
            bestLocalWG = weakGravityChoices;
            comparisonCourse = altCourse;
          }
        }
      }

      const interceptPreference = interceptingEnemy
        ? getInterceptContinuationPreference(
            ship,
            comparisonCourse,
            enemyShips,
            shipIdx,
            cfg,
            map,
            state.destroyedBases,
          )
        : { bonus: 0, tiebreak: -Infinity };

      score += interceptPreference.bonus;
      const interceptTiebreak = interceptPreference.tiebreak;

      if (
        score > bestScore + 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 &&
          (interceptTiebreak > bestInterceptTiebreak + 1e-9 ||
            (Math.abs(interceptTiebreak - bestInterceptTiebreak) <= 1e-9 &&
              comparisonCourse.fuelSpent < bestFuelSpent)))
      ) {
        bestScore = score;
        bestBurn = opt.burn;
        bestOverload = opt.overload;
        bestLand = opt.land ?? false;
        bestWeakGrav = bestLocalWG;
        bestInterceptTiebreak = interceptTiebreak;
        bestFuelSpent = comparisonCourse.fuelSpent;
      }
    }

    const allowEasyRandomBurn =
      cfg.easyRandomBurnProbability > 0 && state.turnNumber > 1;

    if (
      allowEasyRandomBurn &&
      rng() < cfg.easyRandomBurnProbability &&
      canBurnFuel
    ) {
      const randomDir = Math.floor(rng() * 6);
      const course = computeCourse(ship, randomDir, map, {
        destroyedBases: state.destroyedBases,
      });

      if (course.outcome !== 'crash') {
        bestBurn = randomDir;
        bestOverload = null;
      }
    }

    if (
      passengerEscortMission &&
      primaryPassengerCarrier != null &&
      ship.id === primaryPassengerCarrier.id &&
      ship.lifecycle === 'active' &&
      hexVecLength(ship.velocity) === 0 &&
      canBurnFuel &&
      bestBurn === null &&
      !bestLand &&
      shipTargetHex != null
    ) {
      const plan = planShortHorizonMovementToHex(
        ship,
        shipTargetHex,
        map,
        state.destroyedBases,
      );

      if (plan?.firstBurn !== null && plan?.firstBurn !== undefined) {
        bestBurn = plan.firstBurn;
        bestOverload = null;
        bestWeakGrav = undefined;
      }
    }

    if (
      checkpoints &&
      ship.lifecycle === 'active' &&
      hexVecLength(ship.velocity) === 0 &&
      canBurnFuel &&
      bestBurn === null &&
      !bestLand &&
      shipTargetHex != null
    ) {
      const plan = planShortHorizonMovementToHex(
        ship,
        shipTargetHex,
        map,
        state.destroyedBases,
      );

      if (plan?.firstBurn !== null && plan?.firstBurn !== undefined) {
        bestBurn = plan.firstBurn;
        bestOverload = null;
        bestWeakGrav = undefined;
      }
    }

    if (
      !checkpoints &&
      (!passengerEscortMission || primaryPassengerCarrier == null) &&
      !escapeWins &&
      shipTargetHex == null &&
      ship.lifecycle === 'active' &&
      hexVecLength(ship.velocity) === 0 &&
      canBurnFuel &&
      bestBurn === null &&
      !bestLand
    ) {
      const postCarrierLossPursuit = choosePostCarrierLossPursuitPlan(
        state,
        ship,
        map,
        enemyShips,
      );
      const pursuitTargets = postCarrierLossPursuit
        ? []
        : passengerEscortMission && primaryPassengerCarrier == null
          ? enemyShips
          : enemyCombatShips.length > 0
            ? enemyCombatShips
            : enemyShips;
      const nearestCombatEnemy = minBy(pursuitTargets, (enemy) =>
        hexDistance(ship.position, enemy.position),
      );

      if (postCarrierLossPursuit) {
        bestBurn = postCarrierLossPursuit.chosen.action.burn;
        bestOverload = postCarrierLossPursuit.chosen.action.overload;
        bestWeakGrav = undefined;
      } else if (
        nearestCombatEnemy != null &&
        hexDistance(ship.position, nearestCombatEnemy.position) > 2
      ) {
        const interceptHex = hexAdd(
          nearestCombatEnemy.position,
          nearestCombatEnemy.velocity,
        );
        const plan = planShortHorizonMovementToHex(
          ship,
          interceptHex,
          map,
          state.destroyedBases,
        );
        const fallbackBurn = findDirectionToward(ship.position, interceptHex);
        const correctiveBurn = plan?.firstBurn ?? fallbackBurn;
        const correctiveCourse = computeCourse(ship, correctiveBurn, map, {
          destroyedBases: state.destroyedBases,
        });

        if (correctiveCourse.outcome !== 'crash') {
          bestBurn = correctiveBurn;
          bestOverload = null;
          bestWeakGrav = undefined;
        } else {
          const currentDistance = hexDistance(ship.position, interceptHex);
          const fallbackCourse = minBy(
            directions
              .map((direction) => ({
                direction,
                course: computeCourse(ship, direction, map, {
                  destroyedBases: state.destroyedBases,
                }),
              }))
              .filter(
                ({ course }) =>
                  course.outcome !== 'crash' &&
                  hexDistance(course.destination, interceptHex) <
                    currentDistance,
              ),
            ({ course }) => hexDistance(course.destination, interceptHex),
          );

          if (fallbackCourse) {
            bestBurn = fallbackCourse.direction;
            bestOverload = null;
            bestWeakGrav = undefined;
          }
        }
      }
    }

    orders.push({
      shipId: ship.id,
      burn: bestBurn,
      overload: bestOverload,
      weakGravityChoices: bestWeakGrav ?? undefined,
      land: bestLand || undefined,
    });
    shipIdx++;
  }

  return orders;
};
