import { canAttack, getCombatStrength, hasLineOfSight } from '../combat';
import { SHIP_STATS } from '../constants';
import { getTransferEligiblePairs } from '../engine/logistics';
import { hexDistance, hexEqual, hexVecLength } from '../hex';
import { computeCourse } from '../movement';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
  TransferOrder,
} from '../types';
import { maxBy, minBy } from '../util';
import { estimateFuelForTravelDistance, findNearestBase } from './common';
import { AI_CONFIG, type AIDifficultyConfig } from './config';
import { scoreCourse } from './scoring';
import type { AIDifficulty } from './types';

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
      ? estimateFuelForTravelDistance(
          hexDistance(ship.position, targetHex),
          hexVecLength(ship.velocity),
        )
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

export const isPassengerEscortMission = (
  state: GameState,
  playerId: PlayerId,
): boolean =>
  deriveCapabilities(state.scenarioRules).targetWinRequiresPassengers &&
  !!state.players[playerId]?.targetBody;

export const getPrimaryPassengerCarrier = (
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

export const getThreateningEnemies = (enemyShips: Ship[]): Ship[] =>
  enemyShips.filter((enemy) => canAttack(enemy));

export const scorePassengerCarrierEvasion = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
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
    {
      q: course.destination.q + course.newVelocity.dq,
      r: course.destination.r + course.newVelocity.dr,
    },
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

export const scorePassengerEscortCourse = (
  ship: Ship,
  course: ReturnType<typeof computeCourse>,
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
  const formationScore =
    (currentCarrierDist - newCarrierDist) * 18 -
    Math.max(0, newCarrierDist - 2) * 24 +
    (newCarrierDist <= 1 ? 30 : newCarrierDist === 2 ? 14 : 0);
  const carrierThreatDist = hexDistance(
    primaryCarrier.position,
    primaryThreat.position,
  );

  if (carrierThreatDist > 6) {
    return formationScore;
  }

  if (shipStrength >= threatStrength) {
    let score =
      (currentThreatDist - newThreatDist) * 32 -
      Math.max(0, newCarrierDist - 3) * 18 +
      formationScore;

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
    (currentCarrierDist - newCarrierDist) * 20 +
    formationScore;

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
          deriveCapabilities(state.scenarioRules).targetWinRequiresPassengers &&
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

  const nextFrom = (source.passengersAboard ?? 0) - transfer.amount;
  source.passengersAboard = nextFrom > 0 ? nextFrom : undefined;
  target.passengersAboard = (target.passengersAboard ?? 0) + transfer.amount;
};

export const getPassengerTransferFormationOrders = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  targetHex: { q: number; r: number } | null,
  targetBody: string,
  escapeWins: boolean,
  enemyShips: Ship[],
  cfg: AIDifficultyConfig,
  _difficulty: AIDifficulty,
  isRace: boolean,
  enemyEscaping: boolean,
  enemyHasPassengerObjective: boolean,
): Map<string, AstrogationOrder> => {
  if (!deriveCapabilities(state.scenarioRules).targetWinRequiresPassengers) {
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
          escapeEdge: state.scenarioRules.escapeEdge ?? 'any',
          enemyShips,
          cfg,
          map,
          isRace,
          enemyEscaping,
          enemyHasPassengerObjective,
          shipIndex: 0,
        }) +
        scoreCourse({
          ship: pair.target,
          course: targetCourse,
          targetHex,
          targetBody,
          escapeWins,
          escapeEdge: state.scenarioRules.escapeEdge ?? 'any',
          enemyShips,
          cfg,
          map,
          isRace,
          enemyEscaping,
          enemyHasPassengerObjective,
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

export const maybeCreatePassengerFuelSupportOrder = (
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
  if (!deriveCapabilities(state.scenarioRules).logisticsEnabled) {
    return [];
  }

  const workingState = structuredClone(state);
  const maxTransfers = AI_CONFIG[difficulty].maxLogisticsTransfersPerTurn;
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
