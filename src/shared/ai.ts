// Client-side AI opponent using rule-based heuristics.
// Runs entirely in the browser — no server cost.
//
// Difficulty levels:
// - easy:   No overloads, sometimes picks suboptimal
//           burns, skips ordnance, less aggressive
// - normal: Uses overloads, good heuristic scoring,
//           launches ordnance, reasonable combat
// - hard:   Better scoring weights, aggressive ordnance
//           use, always attacks when possible

import { AI_CONFIG } from './ai-config';
import { scoreCourse } from './ai-scoring';
import {
  canAttack,
  computeGroupRangeMod,
  computeGroupRangeModToTarget,
  computeGroupVelocityMod,
  computeGroupVelocityModToTarget,
  getCombatStrength,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from './combat';
import {
  isBaseCarrierType,
  isWarshipType,
  ORDNANCE_MASS,
  SHIP_STATS,
  type ShipType,
} from './constants';
import {
  beginCombatPhase,
  processAstrogation,
  processCombat,
  processLogistics,
  processOrdnance,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from './engine/game-engine';
import { getTransferEligiblePairs } from './engine/logistics';
import {
  HEX_DIRECTIONS,
  type HexKey,
  hexAdd,
  hexDistance,
  hexEqual,
  hexKey,
  hexVecLength,
  parseHexKey,
} from './hex';
import { computeCourse } from './movement';
import type {
  AstrogationOrder,
  CombatAttack,
  CourseResult,
  FleetPurchase,
  FleetPurchaseOption,
  GameState,
  OrdnanceLaunch,
  PlayerId,
  PurchasableShipType,
  Ship,
  SolarSystemMap,
  TransferOrder,
} from './types';
import { maxBy, minBy, sumBy } from './util';
export type AIDifficulty = 'easy' | 'normal' | 'hard';

const DEFAULT_FLEET_PURCHASES = (Object.keys(SHIP_STATS) as ShipType[]).filter(
  (type): type is PurchasableShipType => type !== 'orbitalBase',
);

const COMBAT_FLEET_PRIORITIES: Record<
  AIDifficulty,
  readonly PurchasableShipType[]
> = {
  easy: ['corvette', 'corsair', 'packet', 'transport'],
  normal: ['frigate', 'corsair', 'corvette', 'packet', 'transport'],
  hard: [
    'dreadnaught',
    'frigate',
    'torch',
    'corsair',
    'corvette',
    'packet',
    'transport',
  ],
};

const OBJECTIVE_FLEET_PRIORITIES: Record<
  AIDifficulty,
  readonly PurchasableShipType[]
> = {
  easy: ['packet', 'corvette', 'transport', 'tanker'],
  normal: ['packet', 'corsair', 'corvette', 'transport', 'tanker', 'frigate'],
  hard: ['corsair', 'packet', 'frigate', 'transport', 'tanker', 'corvette'],
};
// --- Helpers ---
const findDirectionToward = (
  from: {
    q: number;
    r: number;
  },
  to: {
    q: number;
    r: number;
  },
): number => {
  const { dir } = HEX_DIRECTIONS.reduce(
    (best, dirVec, d) => {
      const dist = hexDistance(hexAdd(from, dirVec), to);
      return dist < best.dist ? { dir: d, dist } : best;
    },
    { dir: 0, dist: Infinity },
  );
  return dir;
};

// Find the nearest base hex the player controls.
const findNearestBase = (
  shipPos: {
    q: number;
    r: number;
  },
  playerBases: HexKey[],
  _map: SolarSystemMap,
): {
  q: number;
  r: number;
} | null => {
  const nearest = minBy(playerBases, (baseKey) =>
    hexDistance(shipPos, parseHexKey(baseKey)),
  );
  return nearest ? parseHexKey(nearest) : null;
};
// Pick the next checkpoint body to visit, or homeBody
// if all visited. Uses nearest-neighbor heuristic from
// the player's ship position.
const pickNextCheckpoint = (
  player: {
    visitedBodies?: string[];
    homeBody: string;
  },
  checkpoints: string[],
  map: SolarSystemMap,
  shipPos?: {
    q: number;
    r: number;
  },
): string | null => {
  const visited = new Set(player.visitedBodies ?? []);
  const unvisited = checkpoints.filter((b) => !visited.has(b));

  if (unvisited.length === 0) return player.homeBody;

  if (!shipPos) return unvisited[0];
  // Find nearest unvisited body
  const bestBody = unvisited.reduce((best, name) => {
    const body = map.bodies.find((b) => b.name === name);

    if (!body) return best;
    const dist = hexDistance(shipPos, body.center);
    const bestBodyObj = map.bodies.find((b) => b.name === best);
    const bestDist = bestBodyObj
      ? hexDistance(shipPos, bestBodyObj.center)
      : Infinity;
    return dist < bestDist ? name : best;
  }, unvisited[0]);
  return bestBody;
};

const projectShipAfterCourse = (ship: Ship, course: CourseResult): Ship => ({
  ...ship,
  position: course.destination,
  velocity: course.newVelocity,
  fuel: Math.max(0, ship.fuel - course.fuelSpent),
  pendingGravityEffects: course.enteredGravityEffects,
  lifecycle: course.outcome === 'landing' ? 'landed' : 'active',
});

const getInterceptFocusTargets = (enemyShips: Ship[]): Ship[] => {
  const revealedFugitives = enemyShips.filter(
    (enemy) => enemy.identity?.revealed && enemy.identity.hasFugitives,
  );

  return revealedFugitives.length > 0 ? revealedFugitives : enemyShips;
};

const getInterceptContinuationPreference = (
  ship: Ship,
  course: CourseResult,
  enemyShips: Ship[],
  shipIndex: number,
  difficulty: AIDifficulty,
  map: SolarSystemMap,
  destroyedBases: GameState['destroyedBases'],
): { bonus: number; tiebreak: number } => {
  if (enemyShips.length === 0) {
    return { bonus: 0, tiebreak: -Infinity };
  }

  const focusTargets = getInterceptFocusTargets(enemyShips);
  const assignedTarget =
    difficulty === 'hard' && focusTargets.length > 1
      ? focusTargets[shipIndex % focusTargets.length]
      : (minBy(focusTargets, (enemy) =>
          hexDistance(course.destination, enemy.position),
        ) ?? focusTargets[0]);

  if (!assignedTarget) {
    return { bonus: 0, tiebreak: -Infinity };
  }

  const predictedTargetPosition = hexAdd(
    assignedTarget.position,
    assignedTarget.velocity,
  );
  const targetVelocity = {
    q: assignedTarget.velocity.dq,
    r: assignedTarget.velocity.dr,
  };
  const simulatedShip = projectShipAfterCourse(ship, course);
  const currentDistance = hexDistance(
    course.destination,
    predictedTargetPosition,
  );
  const currentVelocityDelta = hexDistance(
    {
      q: course.newVelocity.dq,
      r: course.newVelocity.dr,
    },
    targetVelocity,
  );
  let bestFutureDistance = currentDistance;
  let bestVelocityDelta = currentVelocityDelta;

  for (const burn of [null, 0, 1, 2, 3, 4, 5] as const) {
    const followUp = computeCourse(simulatedShip, burn, map, {
      destroyedBases,
    });

    if (followUp.outcome === 'crash') {
      continue;
    }

    const futureDistance = hexDistance(
      followUp.destination,
      predictedTargetPosition,
    );
    const velocityDelta = hexDistance(
      {
        q: followUp.newVelocity.dq,
        r: followUp.newVelocity.dr,
      },
      targetVelocity,
    );

    if (
      futureDistance < bestFutureDistance ||
      (futureDistance === bestFutureDistance &&
        velocityDelta < bestVelocityDelta)
    ) {
      bestFutureDistance = futureDistance;
      bestVelocityDelta = velocityDelta;
    }
  }

  return {
    bonus:
      (currentDistance - bestFutureDistance) * 4 +
      (currentVelocityDelta - bestVelocityDelta),
    tiebreak: -bestFutureDistance * 20 - bestVelocityDelta,
  };
};

const usesObjectiveFleet = (state: GameState, playerId: PlayerId): boolean => {
  const player = state.players[playerId];

  return (
    !!player.targetBody ||
    !!state.scenarioRules.targetWinRequiresPassengers ||
    !!state.scenarioRules.checkpointBodies
  );
};

const availablePurchaseShipTypes = (
  remainingPurchases: readonly FleetPurchaseOption[],
): PurchasableShipType[] =>
  remainingPurchases.filter(
    (purchase): purchase is PurchasableShipType =>
      purchase !== 'orbitalBaseCargo',
  );

const scoreCombatFleetPlan = (purchases: FleetPurchase[]): number => {
  const shipTypes = purchases
    .filter(
      (purchase): purchase is Extract<FleetPurchase, { kind: 'ship' }> =>
        purchase.kind === 'ship',
    )
    .map((purchase) => purchase.shipType);

  const ships = shipTypes.map((shipType) => SHIP_STATS[shipType]);
  const totalCombat = sumBy(ships, (stats) => stats.combat);
  const totalCargo = sumBy(ships, (stats) => stats.cargo);
  const totalFuel = sumBy(ships, (stats) =>
    Number.isFinite(stats.fuel) ? stats.fuel : 30,
  );
  const hullCount = ships.length;
  const overloadCount = sumBy(ships, (stats) => (stats.canOverload ? 1 : 0));
  const frigateCount = shipTypes.filter((type) => type === 'frigate').length;
  const corsairCount = shipTypes.filter((type) => type === 'corsair').length;
  const corvetteCount = shipTypes.filter((type) => type === 'corvette').length;
  const torchCount = shipTypes.filter((type) => type === 'torch').length;

  let score =
    totalCombat * 28 +
    hullCount * 18 +
    totalCargo * 0.7 +
    totalFuel * 0.4 +
    overloadCount * 10;

  if (hullCount < 3) {
    score -= (3 - hullCount) * 60;
  }

  if (frigateCount > 0 && corsairCount + corvetteCount > 0) {
    score += 35;
  }

  if (corsairCount >= 3) {
    score += 15;
  }

  if (torchCount > 0 && hullCount === 1) {
    score -= 120;
  }

  return score;
};

const buildOptimizedCombatFleetPurchases = (
  availableShipTypes: readonly PurchasableShipType[],
  difficulty: AIDifficulty,
  credits: number,
): FleetPurchase[] => {
  const purchasableTypes = [...availableShipTypes].sort(
    (left, right) => SHIP_STATS[right].cost - SHIP_STATS[left].cost,
  );
  let bestPurchases: FleetPurchase[] = [];
  let bestScore = -Infinity;

  const getMaxCount = (shipType: PurchasableShipType): number => {
    switch (shipType) {
      case 'dreadnaught':
        return difficulty === 'hard' ? 1 : 0;
      case 'torch':
        return difficulty === 'hard' ? 1 : 0;
      default:
        return Math.floor(credits / SHIP_STATS[shipType].cost);
    }
  };

  const search = (
    index: number,
    remainingCredits: number,
    current: FleetPurchase[],
  ): void => {
    const currentScore = scoreCombatFleetPlan(current);

    if (
      currentScore > bestScore ||
      (currentScore === bestScore && current.length > bestPurchases.length)
    ) {
      bestScore = currentScore;
      bestPurchases = [...current];
    }

    if (index >= purchasableTypes.length) {
      return;
    }

    const shipType = purchasableTypes[index];
    const shipCost = SHIP_STATS[shipType].cost;
    const maxCount = Math.min(
      getMaxCount(shipType),
      Math.floor(remainingCredits / shipCost),
    );

    for (let count = maxCount; count >= 0; count--) {
      for (let i = 0; i < count; i++) {
        current.push({ kind: 'ship', shipType });
      }

      search(index + 1, remainingCredits - count * shipCost, current);

      current.length -= count;
    }
  };

  search(0, credits, []);
  return bestPurchases;
};

const getShipPurchaseCount = (
  purchases: FleetPurchase[],
  shipType: PurchasableShipType,
): number =>
  purchases.filter(
    (purchase) => purchase.kind === 'ship' && purchase.shipType === shipType,
  ).length;

const getFreeBaseCarrierSlots = (
  state: GameState,
  playerId: PlayerId,
  purchases: FleetPurchase[],
): number => {
  const existingSlots = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      isBaseCarrierType(ship.type) &&
      ship.baseStatus !== 'carryingBase',
  ).length;
  const plannedCarriers = purchases.filter(
    (purchase) =>
      purchase.kind === 'ship' && isBaseCarrierType(purchase.shipType),
  ).length;
  const plannedBases = purchases.filter(
    (purchase) => purchase.kind === 'orbitalBaseCargo',
  ).length;

  return existingSlots + plannedCarriers - plannedBases;
};

const estimateDesiredFuel = (
  ship: Ship,
  playerId: PlayerId,
  state: GameState,
  map: SolarSystemMap,
): number => {
  const stats = SHIP_STATS[ship.type];

  if (!stats || stats.fuel === Number.POSITIVE_INFINITY) {
    return 0;
  }

  const player = state.players[playerId];
  const targetHex = player.targetBody
    ? (map.bodies.find((body) => body.name === player.targetBody)?.center ??
      null)
    : findNearestBase(ship.position, player.bases, map);
  const reserve =
    targetHex != null
      ? Math.ceil((hexDistance(ship.position, targetHex) * 2) / 3) +
        hexVecLength(ship.velocity) +
        1
      : Math.max(5, Math.ceil(stats.fuel * 0.6));

  return Math.min(stats.fuel, reserve);
};

const freePassengerCapacity = (ship: Ship): number => {
  const stats = SHIP_STATS[ship.type];

  if (!stats) return 0;
  if (stats.cargo === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    stats.cargo - ship.cargoUsed - (ship.passengersAboard ?? 0),
  );
};

const scorePassengerCarrier = (
  ship: Ship,
  playerId: PlayerId,
  state: GameState,
  map: SolarSystemMap,
): number => {
  const stats = SHIP_STATS[ship.type];

  if (!stats) return -Infinity;

  const player = state.players[playerId];
  const targetHex = player.targetBody
    ? (map.bodies.find((body) => body.name === player.targetBody)?.center ??
      null)
    : null;
  const distancePenalty =
    targetHex == null ? 0 : hexDistance(ship.position, targetHex) * 6;

  return (
    stats.combat * 18 +
    (stats.canOverload ? 24 : 0) +
    freePassengerCapacity(ship) * 2 +
    hexVecLength(ship.velocity) * 4 +
    ship.fuel -
    distancePenalty -
    (ship.damage.disabledTurns > 0 ? 180 : 0) -
    (ship.control !== 'own' ? 220 : 0) -
    (ship.lifecycle !== 'active' ? 40 : 0)
  );
};

const isPassengerEscortMission = (
  state: GameState,
  playerId: PlayerId,
): boolean =>
  !!state.scenarioRules.targetWinRequiresPassengers &&
  !!state.players[playerId]?.targetBody;

const getPrimaryPassengerCarrier = (
  state: GameState,
  playerId: PlayerId,
): Ship | null =>
  maxBy(
    state.ships.filter(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        (ship.passengersAboard ?? 0) > 0,
    ),
    (ship) => ship.passengersAboard ?? 0,
  ) ?? null;

const getThreateningEnemies = (enemyShips: Ship[]): Ship[] =>
  enemyShips.filter((enemy) => canAttack(enemy));

const scorePassengerCarrierEvasion = (
  ship: Ship,
  course: CourseResult,
  enemyShips: Ship[],
): number => {
  if ((ship.passengersAboard ?? 0) <= 0) {
    return 0;
  }

  const threats = getThreateningEnemies(enemyShips);
  const nearestThreat = minBy(threats, (enemy) =>
    hexDistance(ship.position, enemy.position),
  );

  if (!nearestThreat) {
    return 0;
  }

  const currentDist = hexDistance(ship.position, nearestThreat.position);

  if (currentDist > 2) {
    return 0;
  }

  const newDist = hexDistance(course.destination, nearestThreat.position);
  const nextDriftDist = hexDistance(
    hexAdd(course.destination, course.newVelocity),
    nearestThreat.position,
  );
  let score = (newDist - currentDist) * 55;

  if (newDist <= 1) {
    score -= 220;
  } else if (newDist === 2) {
    score -= 90;
  } else if (newDist === 3) {
    score -= 30;
  }

  score += (nextDriftDist - newDist) * 20;
  return score;
};

const scorePassengerEscortCourse = (
  ship: Ship,
  course: CourseResult,
  primaryCarrier: Ship | null,
  enemyShips: Ship[],
): number => {
  if (
    primaryCarrier == null ||
    ship.id === primaryCarrier.id ||
    !canAttack(ship) ||
    (ship.passengersAboard ?? 0) > 0
  ) {
    return 0;
  }

  const threats = getThreateningEnemies(enemyShips);
  const primaryThreat = minBy(threats, (enemy) =>
    hexDistance(primaryCarrier.position, enemy.position),
  );

  if (!primaryThreat) {
    return 0;
  }

  const shipStrength = getCombatStrength([ship]);
  const threatStrength = getCombatStrength([primaryThreat]);
  const currentThreatDist = hexDistance(ship.position, primaryThreat.position);
  const newThreatDist = hexDistance(course.destination, primaryThreat.position);
  const currentCarrierDist = hexDistance(
    ship.position,
    primaryCarrier.position,
  );
  const newCarrierDist = hexDistance(
    course.destination,
    primaryCarrier.position,
  );
  const carrierThreatDist = hexDistance(
    primaryCarrier.position,
    primaryThreat.position,
  );

  if (carrierThreatDist > 6) {
    return 0;
  }

  if (shipStrength >= threatStrength) {
    let score =
      (currentThreatDist - newThreatDist) * 32 -
      Math.max(0, newCarrierDist - 3) * 18;

    if (newThreatDist <= 2) {
      score += 40;
    }

    if (newCarrierDist <= 2) {
      score += 28;
    }

    return score;
  }

  let score =
    (newThreatDist - currentThreatDist) * 12 +
    (currentCarrierDist - newCarrierDist) * 20;

  if (newThreatDist <= 1) {
    score -= 110;
  }

  if (newCarrierDist <= 2) {
    score += 42;
  }

  return score;
};

type LogisticsCandidate = {
  transfer: TransferOrder;
  score: number;
};

const selectLogisticsTransfer = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): LogisticsCandidate | null => {
  const player = state.players[playerId];
  const candidates = getTransferEligiblePairs(state, playerId)
    .map<LogisticsCandidate | null>((pair) => {
      let bestScore = -Infinity;
      let bestTransfer: TransferOrder | null = null;

      if (pair.canTransferPassengers) {
        const sourcePassengers = pair.source.passengersAboard ?? 0;
        const partialTransfer = pair.maxPassengers < sourcePassengers;
        const threatenedDuringCombat =
          state.scenarioRules.targetWinRequiresPassengers &&
          partialTransfer &&
          pair.source.damage.disabledTurns === 0 &&
          state.ships.some(
            (enemy) =>
              enemy.owner !== playerId &&
              enemy.lifecycle !== 'destroyed' &&
              canAttack(enemy) &&
              (hasLineOfSight(enemy, pair.source, map) ||
                hasLineOfSight(enemy, pair.target, map)),
          );

        if (!threatenedDuringCombat) {
          const sourceValue = scorePassengerCarrier(
            pair.source,
            playerId,
            state,
            map,
          );
          const targetValue = scorePassengerCarrier(
            pair.target,
            playerId,
            state,
            map,
          );
          const sourceCanFight = canAttack(pair.source);
          const targetCanFight = canAttack(pair.target);

          if (
            (!sourceCanFight && targetCanFight) ||
            (sourceCanFight === targetCanFight &&
              targetValue > sourceValue + 10)
          ) {
            const passengerScore =
              220 +
              (targetValue - sourceValue) +
              (pair.source.damage.disabledTurns > 0 ? 160 : 0) +
              (pair.source.type === 'liner' || pair.source.type === 'transport'
                ? 40
                : 0) +
              (!sourceCanFight && targetCanFight ? 60 : 0);

            if (passengerScore > bestScore) {
              bestScore = passengerScore;
              bestTransfer = {
                sourceShipId: pair.source.id,
                targetShipId: pair.target.id,
                transferType: 'passengers',
                amount: pair.maxPassengers,
              };
            }
          }
        }
      }

      if (pair.canTransferFuel) {
        const desiredFuel = estimateDesiredFuel(
          pair.target,
          playerId,
          state,
          map,
        );
        const sourceReserve =
          pair.source.owner === playerId
            ? estimateDesiredFuel(pair.source, playerId, state, map)
            : 0;
        const usefulFuel = Math.min(
          pair.maxFuel,
          Math.max(0, desiredFuel - pair.target.fuel),
          Math.max(0, pair.source.fuel - sourceReserve),
        );

        if (usefulFuel > 0) {
          const fuelScore =
            40 +
            usefulFuel * 8 +
            (pair.source.type === 'tanker' ? 35 : 0) +
            (pair.source.owner !== playerId ? 60 : 0) +
            (pair.target.passengersAboard != null ? 30 : 0) +
            (player.targetBody ? 15 : 0);

          if (fuelScore > bestScore) {
            bestScore = fuelScore;
            bestTransfer = {
              sourceShipId: pair.source.id,
              targetShipId: pair.target.id,
              transferType: 'fuel',
              amount: usefulFuel,
            };
          }
        }
      }

      return bestTransfer == null
        ? null
        : { transfer: bestTransfer, score: bestScore };
    })
    .filter((candidate): candidate is LogisticsCandidate => candidate != null);

  return maxBy(candidates, (candidate) => candidate.score) ?? null;
};

const applyTransferToState = (
  state: GameState,
  transfer: TransferOrder,
): void => {
  const source = state.ships.find((ship) => ship.id === transfer.sourceShipId);
  const target = state.ships.find((ship) => ship.id === transfer.targetShipId);

  if (!source || !target) return;

  if (transfer.transferType === 'fuel') {
    source.fuel -= transfer.amount;
    target.fuel += transfer.amount;
    return;
  }

  if (transfer.transferType === 'passengers') {
    const nextFrom = (source.passengersAboard ?? 0) - transfer.amount;
    source.passengersAboard = nextFrom > 0 ? nextFrom : undefined;
    target.passengersAboard = (target.passengersAboard ?? 0) + transfer.amount;
  }
};

const getPassengerTransferFormationOrders = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  targetHex: { q: number; r: number } | null,
  targetBody: string,
  escapeWins: boolean,
  enemyShips: Ship[],
  cfg: (typeof AI_CONFIG)[AIDifficulty],
  difficulty: AIDifficulty,
  isRace: boolean,
  enemyEscaping: boolean,
): Map<string, AstrogationOrder> => {
  if (!state.scenarioRules.targetWinRequiresPassengers) {
    return new Map();
  }

  const sharedOrders = new Map<string, AstrogationOrder>();

  for (const pair of getTransferEligiblePairs(state, playerId)) {
    if (
      !pair.canTransferPassengers ||
      (pair.source.passengersAboard ?? 0) <= 0
    ) {
      continue;
    }

    if (sharedOrders.has(pair.source.id) || sharedOrders.has(pair.target.id)) {
      continue;
    }

    const sourceScore = scorePassengerCarrier(
      pair.source,
      playerId,
      state,
      map,
    );
    const targetScore = scorePassengerCarrier(
      pair.target,
      playerId,
      state,
      map,
    );

    if (targetScore <= sourceScore + 10) {
      continue;
    }

    const nearestThreatDist = minBy(
      getThreateningEnemies(enemyShips),
      (enemy) =>
        Math.min(
          hexDistance(pair.source.position, enemy.position),
          hexDistance(pair.target.position, enemy.position),
        ),
    );

    if (
      nearestThreatDist != null &&
      Math.min(
        hexDistance(pair.source.position, nearestThreatDist.position),
        hexDistance(pair.target.position, nearestThreatDist.position),
      ) <= 5
    ) {
      continue;
    }

    let bestBurn: number | null = null;
    let bestScore = -Infinity;

    for (const burn of [null, 0, 1, 2, 3, 4, 5] as const) {
      const sourceCourse = computeCourse(pair.source, burn, map, {
        destroyedBases: state.destroyedBases,
      });
      const targetCourse = computeCourse(pair.target, burn, map, {
        destroyedBases: state.destroyedBases,
      });

      if (
        sourceCourse.outcome === 'crash' ||
        targetCourse.outcome === 'crash'
      ) {
        continue;
      }

      const score =
        scoreCourse({
          ship: pair.source,
          course: sourceCourse,
          targetHex,
          targetBody,
          escapeWins,
          enemyShips,
          cfg,
          difficulty,
          map,
          isRace,
          enemyEscaping,
          shipIndex: 0,
        }) +
        scoreCourse({
          ship: pair.target,
          course: targetCourse,
          targetHex,
          targetBody,
          escapeWins,
          enemyShips,
          cfg,
          difficulty,
          map,
          isRace,
          enemyEscaping,
          shipIndex: 1,
        }) +
        120;

      if (score > bestScore) {
        bestScore = score;
        bestBurn = burn;
      }
    }

    if (bestScore === -Infinity) {
      continue;
    }

    sharedOrders.set(pair.source.id, {
      shipId: pair.source.id,
      burn: bestBurn,
      overload: null,
    });
    sharedOrders.set(pair.target.id, {
      shipId: pair.target.id,
      burn: bestBurn,
      overload: null,
    });
  }

  return sharedOrders;
};

const getPassengerEmergencyEscortOrders = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  targetHex: { q: number; r: number } | null,
  targetBody: string,
  escapeWins: boolean,
  enemyShips: Ship[],
  cfg: (typeof AI_CONFIG)[AIDifficulty],
  difficulty: AIDifficulty,
  enemyEscaping: boolean,
): Map<string, AstrogationOrder> => {
  if (!isPassengerEscortMission(state, playerId)) {
    return new Map();
  }

  const primaryCarrier = getPrimaryPassengerCarrier(state, playerId);

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
    state.ships.filter(
      (ship) =>
        ship.owner === playerId &&
        ship.id !== primaryCarrier.id &&
        ship.lifecycle !== 'destroyed' &&
        canAttack(ship) &&
        (ship.passengersAboard ?? 0) === 0,
    ),
    (ship) =>
      getCombatStrength([ship]) * 10 -
      hexDistance(ship.position, primaryCarrier.position),
  );

  if (!escort) {
    return new Map();
  }

  const evaluateCandidateOutcome = (
    carrierOrder: AstrogationOrder,
    escortOrder: AstrogationOrder,
  ): number => {
    const rng = () => 0.5;
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
      rng,
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
        const orders = aiAstrogation(simulated, actor, map, difficulty, rng);
        const result = processAstrogation(simulated, actor, orders, map, rng);
        if ('error' in result) {
          return -Infinity;
        }
        simulated = result.state;
        continue;
      }

      if (simulated.phase === 'ordnance') {
        const launches = aiOrdnance(simulated, actor, map, difficulty, rng);
        const result =
          launches.length > 0
            ? processOrdnance(simulated, actor, launches, map, rng)
            : skipOrdnance(simulated, actor, map, rng);
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
        const preResult = beginCombatPhase(simulated, actor, map, rng);
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
            ? processCombat(simulated, actor, attacks, map, rng)
            : skipCombat(simulated, actor, map, rng);
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
        !state.scenarioRules.combatDisabled
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
            enemyShips,
            cfg,
            difficulty,
            map,
            isRace: false,
            enemyEscaping,
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
            enemyShips,
            cfg,
            difficulty,
            map,
            isRace: false,
            enemyEscaping,
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

const maybeCreatePassengerFuelSupportOrder = (
  ship: Ship,
  state: GameState,
  playerId: PlayerId,
  plannedOrders: readonly AstrogationOrder[],
  map: SolarSystemMap,
): AstrogationOrder | null => {
  if (
    !isPassengerEscortMission(state, playerId) ||
    ship.type !== 'tanker' ||
    ship.lifecycle === 'destroyed' ||
    ship.damage.disabledTurns > 0
  ) {
    return null;
  }

  const primaryCarrier = getPrimaryPassengerCarrier(state, playerId);

  if (
    primaryCarrier == null ||
    primaryCarrier.id === ship.id ||
    primaryCarrier.lifecycle === 'destroyed' ||
    !hexEqual(primaryCarrier.position, ship.position) ||
    primaryCarrier.velocity.dq !== ship.velocity.dq ||
    primaryCarrier.velocity.dr !== ship.velocity.dr
  ) {
    return null;
  }

  const carrierOrder = plannedOrders.find(
    (order) => order.shipId === primaryCarrier.id,
  );

  if (!carrierOrder) {
    return null;
  }

  const mirroredCourse = computeCourse(ship, carrierOrder.burn, map, {
    destroyedBases: state.destroyedBases,
  });

  if (mirroredCourse.outcome === 'crash') {
    return null;
  }

  return {
    shipId: ship.id,
    burn: carrierOrder.burn,
    overload: null,
  };
};

export const aiLogistics = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): TransferOrder[] => {
  if (!state.scenarioRules.logisticsEnabled) {
    return [];
  }

  const workingState = structuredClone(state);
  const maxTransfers =
    difficulty === 'easy' ? 1 : difficulty === 'normal' ? 2 : 3;
  const transfers: TransferOrder[] = [];

  while (transfers.length < maxTransfers) {
    const best = selectLogisticsTransfer(workingState, playerId, map);

    if (!best || best.score <= 0) {
      break;
    }
    transfers.push(best.transfer);
    applyTransferToState(workingState, best.transfer);
  }

  return transfers;
};

export const buildAIFleetPurchases = (
  state: GameState,
  playerId: PlayerId,
  difficulty: AIDifficulty,
  availableFleetPurchases?: FleetPurchaseOption[],
): FleetPurchase[] => {
  const remainingPurchases =
    availableFleetPurchases ??
    state.scenarioRules.availableFleetPurchases ??
    DEFAULT_FLEET_PURCHASES;
  const available = new Set(remainingPurchases);
  const purchases: FleetPurchase[] = [];
  let remainingCredits = state.players[playerId].credits ?? 0;
  const usesObjectives = usesObjectiveFleet(state, playerId);
  const availableShipTypes = availablePurchaseShipTypes(remainingPurchases);
  const homeBodies = new Set(state.players.map((player) => player.homeBody));
  const marsVenusFleetBattle =
    homeBodies.size === 2 && homeBodies.has('Mars') && homeBodies.has('Venus');
  const warshipOnlyCombatFleet =
    !usesObjectives &&
    marsVenusFleetBattle &&
    !available.has('orbitalBaseCargo') &&
    availableShipTypes.length > 0 &&
    availableShipTypes.every((shipType) => isWarshipType(shipType));

  if (warshipOnlyCombatFleet) {
    return buildOptimizedCombatFleetPurchases(
      availableShipTypes,
      difficulty,
      remainingCredits,
    );
  }

  const priorities = usesObjectives
    ? OBJECTIVE_FLEET_PRIORITIES[difficulty]
    : COMBAT_FLEET_PRIORITIES[difficulty];
  const wantsTanker = !!state.scenarioRules.logisticsEnabled;

  const getMaxCount = (shipType: PurchasableShipType): number => {
    switch (shipType) {
      case 'dreadnaught':
        return difficulty === 'hard' ? 1 : 0;
      case 'torch':
        return difficulty === 'hard' ? 1 : 0;
      case 'tanker':
        return wantsTanker ? 1 : 0;
      case 'transport':
        return usesObjectives || available.has('orbitalBaseCargo') ? 1 : 0;
      default:
        return Number.POSITIVE_INFINITY;
    }
  };

  const tryBuyShip = (shipType: PurchasableShipType): boolean => {
    if (!available.has(shipType)) return false;
    if (getShipPurchaseCount(purchases, shipType) >= getMaxCount(shipType)) {
      return false;
    }
    const cost = SHIP_STATS[shipType].cost;

    if (remainingCredits < cost) return false;

    purchases.push({ kind: 'ship', shipType });
    remainingCredits -= cost;
    return true;
  };

  const tryBuyOrbitalBase = (): boolean => {
    if (!available.has('orbitalBaseCargo')) return false;
    if (remainingCredits < SHIP_STATS.orbitalBase.cost) return false;
    if (getFreeBaseCarrierSlots(state, playerId, purchases) <= 0) return false;

    purchases.push({ kind: 'orbitalBaseCargo' });
    remainingCredits -= SHIP_STATS.orbitalBase.cost;
    return true;
  };

  if (difficulty === 'hard' && available.has('orbitalBaseCargo')) {
    const carrierType = available.has('transport')
      ? 'transport'
      : available.has('packet')
        ? 'packet'
        : null;
    if (
      carrierType != null &&
      getFreeBaseCarrierSlots(state, playerId, purchases) === 0 &&
      remainingCredits >=
        SHIP_STATS.orbitalBase.cost + SHIP_STATS[carrierType].cost
    ) {
      tryBuyShip(carrierType);
    }
    tryBuyOrbitalBase();
  }

  if (wantsTanker && available.has('tanker')) {
    const anchorType = priorities.find(
      (shipType) =>
        shipType !== 'tanker' &&
        shipType !== 'transport' &&
        available.has(shipType) &&
        remainingCredits >= SHIP_STATS[shipType].cost + SHIP_STATS.tanker.cost,
    );

    if (anchorType) {
      tryBuyShip(anchorType);
      tryBuyShip('tanker');
    }
  }

  for (const shipType of priorities) {
    while (tryBuyShip(shipType)) {
      // Keep orbital bases paired with the carrier purchase
      // that makes them legal.
      if (
        difficulty !== 'easy' &&
        isBaseCarrierType(shipType) &&
        getFreeBaseCarrierSlots(state, playerId, purchases) > 0
      ) {
        tryBuyOrbitalBase();
      }
    }
  }

  return purchases;
};
// Generate astrogation orders for an AI player.
// Strategy: for each ship, evaluate all 7 options
// (6 burn directions + no burn) and pick the one that
// brings us closest to our goal.
export const aiAstrogation = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
  rng: () => number = Math.random,
): AstrogationOrder[] => {
  const cfg = AI_CONFIG[difficulty];
  const orders: AstrogationOrder[] = [];
  const { targetBody, escapeWins } = state.players[playerId];
  const player = state.players[playerId];
  const passengerEscortMission = isPassengerEscortMission(state, playerId);
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const enemyEscaping = state.players[opponentId]?.escapeWins === true;
  // Default navigation target (non-checkpoint scenarios)
  const defaultTargetHex: {
    q: number;
    r: number;
  } | null = targetBody
    ? (map.bodies.find((body) => body.name === targetBody)?.center ?? null)
    : null;
  const checkpoints = state.scenarioRules.checkpointBodies;
  // Find enemy ships for combat positioning
  const enemyShips = state.ships.filter(
    (s) => s.owner !== playerId && s.lifecycle !== 'destroyed',
  );
  const primaryPassengerCarrier = passengerEscortMission
    ? getPrimaryPassengerCarrier(state, playerId)
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
  );
  const passengerEmergencyEscortOrders = getPassengerEmergencyEscortOrders(
    state,
    playerId,
    map,
    defaultTargetHex,
    targetBody,
    escapeWins,
    enemyShips,
    cfg,
    difficulty,
    enemyEscaping,
  );
  let shipIdx = 0;
  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;

    if (ship.lifecycle === 'destroyed') continue;
    // Orbital bases don't need astrogation
    if (ship.baseStatus === 'emplaced') continue;
    // Captured ships can't act
    if (ship.control === 'captured') {
      orders.push({
        shipId: ship.id,
        burn: null,
        overload: null,
      });
      continue;
    }
    // Disabled ships just drift
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
    const fuelSupportOrder = maybeCreatePassengerFuelSupportOrder(
      ship,
      state,
      playerId,
      orders,
      map,
    );

    if (fuelSupportOrder) {
      orders.push(fuelSupportOrder);
      shipIdx++;
      continue;
    }
    // Per-ship checkpoint target or default target
    let shipTargetHex = defaultTargetHex;
    let shipTargetBody = targetBody;
    let seekingFuel = false;

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
        pickNextCheckpoint(player, checkpoints, map, ship.position) ?? '';
      shipTargetBody = nextBody;
      shipTargetHex = nextBody
        ? (map.bodies.find((body) => body.name === nextBody)?.center ?? null)
        : null;
      // Refuel strategy: divert to nearest base
      // when fuel won't reach the target
      if (shipTargetHex && ship.lifecycle !== 'landed') {
        const distToTarget = hexDistance(ship.position, shipTargetHex);
        const speed = hexVecLength(ship.velocity);
        // Need fuel to navigate: roughly distance/3
        // for accel + distance/3 for decel + margin
        const fuelForTrip = Math.ceil((distToTarget * 2) / 3) + speed + 1;

        if (ship.fuel < fuelForTrip) {
          const basePos = findNearestBase(ship.position, player.bases, map);

          if (basePos) {
            const baseDist = hexDistance(ship.position, basePos);
            // Only divert if base is reasonably
            // close and reachable
            if (baseDist < distToTarget && baseDist <= ship.fuel + speed + 2) {
              shipTargetHex = basePos;
              shipTargetBody = '';
              seekingFuel = true;
            }
          }
        }
      }
    }
    let bestBurn: number | null = null;
    let bestOverload: number | null = null;
    let bestScore = -Infinity;
    let bestInterceptTiebreak = -Infinity;
    let bestFuelSpent = Number.POSITIVE_INFINITY;
    const stats = SHIP_STATS[ship.type];
    const canBurnFuel = ship.fuel > 0;
    const interceptingEnemy =
      enemyEscaping && !escapeWins && shipTargetHex == null;
    const allowsCorrectiveBurnLookahead =
      !!checkpoints ||
      shipTargetHex != null ||
      passengerEscortMission ||
      interceptingEnemy;
    // Easy AI never overloads; Normal/Hard can overload
    // warships with enough fuel. No overloads in
    // non-combat races — too risky near gravity wells.
    const canOverload =
      difficulty !== 'easy' &&
      stats?.canOverload &&
      ship.fuel >= 2 &&
      !ship.overloadUsed &&
      !state.scenarioRules.combatDisabled;
    // Build list of (burn, overload) pairs to evaluate
    type BurnOption = {
      burn: number | null;
      overload: number | null;
      weakGravityChoices?: Record<string, boolean>;
    };
    const directions = [0, 1, 2, 3, 4, 5] as const;
    const options: BurnOption[] = [
      { burn: null, overload: null },
      ...(canBurnFuel
        ? directions.flatMap((d) => [
            { burn: d, overload: null },
            ...(canOverload
              ? directions.map((o) => ({
                  burn: d,
                  overload: o as number | null,
                }))
              : []),
          ])
        : []),
    ];
    let bestWeakGrav: Record<string, boolean> | undefined;
    for (const opt of options) {
      const courseOpts = {
        ...(opt.overload !== null ? { overload: opt.overload } : {}),
        destroyedBases: state.destroyedBases,
      };
      const course = computeCourse(ship, opt.burn, map, courseOpts);
      // Skip crashed courses entirely
      if (course.outcome === 'crash') continue;
      // Look ahead: skip courses that will inevitably
      // crash.
      let gravityRiskPenalty = 0;

      if (course.outcome !== 'landing') {
        const simShip = projectShipAfterCourse(ship, course);
        const fuelAfter = ship.fuel - course.fuelSpent;
        const driftCourse = computeCourse(simShip, null, map, {
          destroyedBases: state.destroyedBases,
        });

        if (driftCourse.outcome === 'crash') {
          if (!allowsCorrectiveBurnLookahead) {
            // Combat scenarios: simple hard reject
            // if drifting crashes
            continue;
          }
          // Objective modes: allow courses that need
          // a corrective burn next turn if they are
          // still actually survivable.
          if (fuelAfter <= 0) continue;
          let canSurvive = false;
          for (let d2 = 0; d2 < 6; d2++) {
            const escapeResult = computeCourse(simShip, d2, map, {
              destroyedBases: state.destroyedBases,
            });

            if (escapeResult.outcome === 'crash') continue;
            // Also check the turn after the escape
            // burn
            if (escapeResult.outcome !== 'landing' && fuelAfter > 1) {
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

                // Escape leads to another trap
                if (!canSurvive2) continue;
              }
            }
            canSurvive = true;
            break;
          }

          // No escape, hard reject
          if (!canSurvive) continue;
          // Survivable but needs corrective burns
          gravityRiskPenalty = cfg.gravityRiskPenalty;
        }
      }
      let score =
        scoreCourse({
          ship,
          course,
          targetHex: shipTargetHex,
          targetBody: shipTargetBody,
          escapeWins,
          enemyShips,
          cfg,
          difficulty,
          map,
          isRace: !!checkpoints,
          enemyEscaping,
          shipIndex: shipIdx,
        }) + gravityRiskPenalty;
      let comparisonCourse = course;

      if (passengerEscortMission) {
        score += scorePassengerCarrierEvasion(ship, course, enemyShips);
        score += scorePassengerEscortCourse(
          ship,
          course,
          primaryPassengerCarrier,
          enemyShips,
        );
      }

      // Fuel-seeking: big bonus for landing at any
      // body (base refuel)
      if (seekingFuel && course.outcome === 'landing') {
        score += cfg.fuelSeekLandingBonus;
      }
      // Fuel efficiency: slight preference for
      // conserving fuel
      if (opt.burn === null) {
        if (!interceptingEnemy) {
          score += cfg.fuelDriftBonus;
        }
      } else if (opt.overload !== null) {
        // Small penalty for extra fuel cost
        score -= cfg.fuelOverloadPenalty;
      }
      // For normal/hard AI, also try ignoring weak
      // gravity choices
      let bestLocalWG: Record<string, boolean> | undefined;

      if (
        difficulty !== 'easy' &&
        course.enteredGravityEffects.some((g) => g.strength === 'weak')
      ) {
        // Try toggling each weak gravity hex
        const weakHexes = course.enteredGravityEffects.filter(
          (g) => g.strength === 'weak',
        );
        for (const wg of weakHexes) {
          const wgChoices: Record<string, boolean> = {
            [hexKey(wg.hex)]: true,
          };
          const altCourse = computeCourse(ship, opt.burn, map, {
            ...courseOpts,
            weakGravityChoices: wgChoices,
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
            enemyShips,
            cfg,
            difficulty,
            map,
            isRace: !!checkpoints,
            enemyEscaping,
            shipIndex: shipIdx,
          });

          if (altScore > score) {
            score = altScore;
            bestLocalWG = wgChoices;
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
            difficulty,
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
        bestWeakGrav = bestLocalWG;
        bestInterceptTiebreak = interceptTiebreak;
        bestFuelSpent = comparisonCourse.fuelSpent;
      }
    }

    // Easy AI: 25% chance to pick a random suboptimal
    // direction instead
    if (difficulty === 'easy' && rng() < 0.25 && canBurnFuel) {
      const randomDir = Math.floor(rng() * 6);
      const course = computeCourse(ship, randomDir, map, {
        destroyedBases: state.destroyedBases,
      });

      if (course.outcome !== 'crash') {
        bestBurn = randomDir;
        bestOverload = null;
      }
    }
    orders.push({
      shipId: ship.id,
      burn: bestBurn,
      overload: bestOverload,
      weakGravityChoices: bestWeakGrav ?? undefined,
    });
    shipIdx++;
  }

  return orders;
};
// Generate ordnance launches for an AI player.
// Strategy: launch torpedoes at nearby enemy ships.
export const aiOrdnance = (
  state: GameState,
  playerId: PlayerId,
  _map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
  rng: () => number = Math.random,
): OrdnanceLaunch[] => {
  const cfg = AI_CONFIG[difficulty];
  const launches: OrdnanceLaunch[] = [];
  const allowedTypes = new Set(
    state.scenarioRules.allowedOrdnanceTypes ?? ['mine', 'torpedo', 'nuke'],
  );
  // Easy AI rarely uses ordnance (30% chance to skip)
  if (cfg.ordnanceSkipChance > 0 && rng() < cfg.ordnanceSkipChance) {
    return launches;
  }
  const enemyShips = state.ships.filter(
    (s) => s.owner !== playerId && s.lifecycle !== 'destroyed',
  );

  if (enemyShips.length === 0) return launches;
  // Difficulty-based range thresholds
  const torpedoRange = cfg.torpedoRange;
  const mineRange = cfg.mineRange;
  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.lifecycle !== 'active') {
      continue;
    }

    if (ship.damage.disabledTurns > 0) continue;
    if (
      state.scenarioRules.targetWinRequiresPassengers &&
      (ship.passengersAboard ?? 0) > 0
    ) {
      continue;
    }
    const stats = SHIP_STATS[ship.type];

    if (!stats) continue;
    const cargoFree = stats.cargo - ship.cargoUsed;
    const hasFriendlyLaunchStack = state.ships.some(
      (other) =>
        other.id !== ship.id &&
        other.owner === playerId &&
        other.lifecycle !== 'destroyed' &&
        hexEqual(other.position, ship.position),
    );
    // Find nearest enemy
    const nearestEnemy = minBy(enemyShips, (enemy) =>
      hexDistance(ship.position, enemy.position),
    );

    if (!nearestEnemy) continue;
    const nearestDist = hexDistance(ship.position, nearestEnemy.position);
    // Hard AI: launch nuke at enemies within range
    // if cargo allows
    const canLaunchNuke =
      (stats.canOverload || ship.nukesLaunchedSinceResupply < 1) &&
      !hasFriendlyLaunchStack &&
      (ship.passengersAboard ?? 0) === 0;

    if (
      allowedTypes.has('nuke') &&
      difficulty === 'hard' &&
      nearestDist <= torpedoRange &&
      cargoFree >= ORDNANCE_MASS.nuke &&
      canLaunchNuke
    ) {
      // Prefer nukes over torpedoes when enemy
      // is strong
      const enemyStr = getCombatStrength([nearestEnemy]);
      const myStr = getCombatStrength([ship]);

      if (enemyStr >= myStr && nearestDist <= cfg.nukeStrengthRange) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        });
        continue;
      }
    }
    // Launch torpedo if enemy is within range and
    // ship can
    if (
      allowedTypes.has('torpedo') &&
      nearestDist <= torpedoRange &&
      stats.canOverload &&
      cargoFree >= ORDNANCE_MASS.torpedo
    ) {
      // Aim guidance toward enemy
      const bestDir = findDirectionToward(ship.position, nearestEnemy.position);
      launches.push({
        shipId: ship.id,
        ordnanceType: 'torpedo',
        torpedoAccel: bestDir,
        torpedoAccelSteps: nearestDist > 4 ? 2 : 1,
      });
      continue;
    }
    // Drop a mine if enemies are close-ish and we
    // have cargo
    if (
      allowedTypes.has('mine') &&
      nearestDist <= mineRange &&
      cargoFree >= ORDNANCE_MASS.mine
    ) {
      // Rule: must change course (burn) to launch
      const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
        (o) => o.shipId === ship.id,
      );
      const hasBurn =
        pendingOrder?.burn != null || pendingOrder?.overload != null;

      if (hasBurn) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        });
        continue;
      }
    }
    // Defensive mine-laying: drop mines behind when
    // being pursued (escape scenarios)
    const player = state.players[playerId];

    if (
      allowedTypes.has('mine') &&
      player?.escapeWins &&
      nearestDist <= 8 &&
      cargoFree >= ORDNANCE_MASS.mine
    ) {
      // Only if enemy is approaching from behind
      const speed = hexVecLength(ship.velocity);

      if (speed >= 2 && difficulty !== 'easy') {
        // Also check for burn rule
        const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
          (o) => o.shipId === ship.id,
        );
        const hasBurn =
          pendingOrder?.burn != null || pendingOrder?.overload != null;

        if (hasBurn) {
          launches.push({
            shipId: ship.id,
            ordnanceType: 'mine',
            torpedoAccel: null,
            torpedoAccelSteps: null,
          });
        }
      }
    }
  }

  return launches;
};
// Generate combat attacks for an AI player.
// Strategy: concentrate fire on the weakest enemy.
export const aiCombat = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): CombatAttack[] => {
  if (state.scenarioRules.combatDisabled) return [];
  const cfg = AI_CONFIG[difficulty];
  const myShips = state.ships.filter(
    (s) => s.owner === playerId && s.lifecycle !== 'destroyed' && canAttack(s),
  );

  if (myShips.length === 0) return [];
  const enemyShips = state.ships.filter(
    (s) => s.owner !== playerId && s.lifecycle !== 'destroyed',
  );
  const enemyNukes = state.ordnance.filter(
    (o) =>
      o.owner !== playerId && o.lifecycle !== 'destroyed' && o.type === 'nuke',
  );

  if (enemyShips.length === 0 && enemyNukes.length === 0) {
    return [];
  }

  // Score all potential targets
  interface ScoredTarget {
    targetId: string;
    targetType: 'ship' | 'ordnance';
    attackers: Ship[];
    score: number;
  }
  const scored: ScoredTarget[] = [];
  for (const enemy of enemyShips) {
    if (enemy.lifecycle === 'landed') continue;
    const attackersForTarget = myShips.filter((attacker) =>
      hasLineOfSight(attacker, enemy, map),
    );

    if (attackersForTarget.length === 0) continue;
    const avgDist =
      sumBy(attackersForTarget, (a) =>
        hexDistance(a.position, enemy.position),
      ) / attackersForTarget.length;
    const rangeMod = computeGroupRangeMod(attackersForTarget, enemy);
    const velMod = computeGroupVelocityMod(attackersForTarget, enemy);
    const totalMod = rangeMod + velMod;
    const score =
      -avgDist * cfg.targetDistPenalty -
      totalMod * cfg.targetModPenalty +
      enemy.damage.disabledTurns * cfg.targetDisabledBonus;
    scored.push({
      targetId: enemy.id,
      targetType: 'ship',
      attackers: attackersForTarget,
      score,
    });
  }

  for (const nuke of enemyNukes) {
    const attackersForTarget = myShips.filter((attacker) =>
      hasLineOfSightToTarget(attacker, nuke, map),
    );

    if (attackersForTarget.length === 0) continue;
    const avgDist =
      sumBy(attackersForTarget, (a) => hexDistance(a.position, nuke.position)) /
      attackersForTarget.length;
    const rangeMod = computeGroupRangeModToTarget(attackersForTarget, nuke);
    const velMod = computeGroupVelocityModToTarget(attackersForTarget, nuke);
    const ownShips = state.ships.filter(
      (ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed',
    );
    const closestOwn = minBy(ownShips, (ship) =>
      hexDistance(ship.position, nuke.position),
    );
    const threat = closestOwn
      ? Math.max(
          0,
          cfg.nukeThreatRange - hexDistance(closestOwn.position, nuke.position),
        )
      : 0;
    const score =
      cfg.nukeThreatBase +
      threat * cfg.nukeThreatWeight -
      avgDist * cfg.targetDistPenalty -
      (rangeMod + velMod) * cfg.targetModPenalty;
    scored.push({
      targetId: nuke.id,
      targetType: 'ordnance',
      attackers: attackersForTarget,
      score,
    });
  }

  if (scored.length === 0) return [];
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  // Assign attacks greedily: each attacker can only
  // participate in one attack
  const attacks: CombatAttack[] = [];
  const committedAttackers = new Set<string>();
  const committedTargets = new Set<string>();
  const minRollThreshold = cfg.minRollThreshold;
  for (const target of scored) {
    const targetKey = `${target.targetType}:${target.targetId}`;

    if (committedTargets.has(targetKey)) continue;
    const availableAttackers = target.attackers.filter(
      (a) => !committedAttackers.has(a.id),
    );

    if (availableAttackers.length === 0) continue;
    // Check if odds are reasonable
    if (target.targetType === 'ship') {
      const enemy = enemyShips.find((s) => s.id === target.targetId);

      if (!enemy) continue;
      const nonPassengerAttackers = availableAttackers.filter(
        (attacker) => (attacker.passengersAboard ?? 0) === 0,
      );
      const available =
        nonPassengerAttackers.length > 0
          ? nonPassengerAttackers
          : availableAttackers;
      const attackStr = getCombatStrength(available);
      const defendStr = getCombatStrength([enemy]);
      const rangeMod = computeGroupRangeMod(available, enemy);
      const velMod = computeGroupVelocityMod(available, enemy);

      if (6 - rangeMod - velMod < minRollThreshold && attackStr <= defendStr) {
        continue;
      }

      if (
        nonPassengerAttackers.length === 0 &&
        available.some((attacker) => (attacker.passengersAboard ?? 0) > 0) &&
        enemy.damage.disabledTurns === 0 &&
        attackStr <= defendStr
      ) {
        continue;
      }

      attacks.push({
        attackerIds: available.map((s) => s.id),
        targetId: target.targetId,
        targetType: target.targetType,
        attackStrength: null,
      });
      for (const a of available) {
        committedAttackers.add(a.id);
      }
    } else {
      attacks.push({
        attackerIds: availableAttackers.map((s) => s.id),
        targetId: target.targetId,
        targetType: target.targetType,
        attackStrength: null,
      });
      for (const a of availableAttackers) {
        committedAttackers.add(a.id);
      }
    }

    committedTargets.add(targetKey);
    // Easy AI: only one attack per combat phase
    if (cfg.singleAttackOnly) break;
  }

  return attacks;
};
