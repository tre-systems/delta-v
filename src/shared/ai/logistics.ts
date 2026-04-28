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
import {
  estimateFuelForTravelDistance,
  findNearestBase,
  planShortHorizonMovementToHex,
} from './common';
import { AI_CONFIG, type AIDifficultyConfig } from './config';
import { type AIDoctrineContext, buildAIDoctrineContext } from './doctrine';
import {
  chooseBestPlan,
  type PlanCandidate,
  type PlanDecision,
  planEvaluation,
} from './plans';
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

const getPlayerTargetHex = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): { q: number; r: number } | null => {
  const player = state.players[playerId];

  return player.targetBody
    ? (map.bodies.find((body) => body.name === player.targetBody)?.center ??
        null)
    : null;
};

export const scorePassengerArrivalOdds = (
  ship: Ship,
  playerId: PlayerId,
  state: GameState,
  map: SolarSystemMap,
): number => {
  const targetHex = getPlayerTargetHex(state, playerId, map);

  if (targetHex == null) {
    return 0;
  }

  const distance = hexDistance(ship.position, targetHex);
  const speed = hexVecLength(ship.velocity);
  // The bounded planner threads through `computeCourse` so it knows when
  // momentum closes the gap for free vs when a brake-and-burn pattern
  // is required. Trust its `fuelSpent` over the linear-distance heuristic
  // when it succeeds. When the 4-turn horizon can't find a plan, fall
  // back to the heuristic so this score still reflects coarse-but-real
  // distance and fuel pressure for far-out approaches.
  const plan = planShortHorizonMovementToHex(
    ship,
    targetHex,
    map,
    state.destroyedBases,
    4,
  );
  const requiredFuel =
    plan != null
      ? plan.fuelSpent
      : estimateFuelForTravelDistance(distance, speed);
  const fuelMargin = ship.fuel - requiredFuel;
  // Reward a planner-confirmed approach, but only when the plan
  // actually consumes some fuel — a free-coast plan already gets
  // captured by the heuristic distance term, and adding a bonus on
  // top biases the carrier toward stalling on a fueled coast (the
  // fuel-stall metric flags that). Burning carriers should win
  // ties, not coasting ones.
  const planSuccessBonus =
    plan != null && plan.fuelSpent > 0
      ? Math.max(0, 30 - plan.finalDistance * 8 - plan.turns * 3)
      : 0;

  return (
    -distance * 22 +
    Math.min(8, Math.max(0, fuelMargin)) * 10 -
    Math.max(0, -fuelMargin) * 55 -
    speed * 2 +
    planSuccessBonus
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

  return (
    scorePassengerArrivalOdds(ship, playerId, state, map) +
    stats.combat * 8 +
    (stats.canOverload ? 16 : 0) +
    freePassengerCapacity(ship) * 2 +
    ship.fuel -
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

const selectPrimaryPassengerCarrier = (
  state: GameState,
  playerId: PlayerId,
  map?: SolarSystemMap,
): Ship | null =>
  maxBy(
    state.ships.filter(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        (ship.passengersAboard ?? 0) > 0,
    ),
    (ship) =>
      (ship.passengersAboard ?? 0) * 1000 +
      (map ? scorePassengerArrivalOdds(ship, playerId, state, map) : 0),
  ) ?? null;

export const getPrimaryPassengerCarrier = (
  state: GameState,
  playerId: PlayerId,
  map?: SolarSystemMap,
): Ship | null => selectPrimaryPassengerCarrier(state, playerId, map);

export type PassengerShipRole = 'carrier' | 'escort' | 'screen' | 'refuel';
export type ShipRole = PassengerShipRole | 'interceptor' | 'race';

const isActiveOwnShip = (ship: Ship, playerId: PlayerId): boolean =>
  ship.owner === playerId &&
  ship.lifecycle === 'active' &&
  ship.baseStatus !== 'emplaced' &&
  ship.damage.disabledTurns === 0 &&
  ship.control === 'own';

const sameFlightPath = (a: Ship, b: Ship): boolean =>
  hexEqual(a.position, b.position) &&
  a.velocity.dq === b.velocity.dq &&
  a.velocity.dr === b.velocity.dr;

export const assignPassengerShipRoles = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): Map<string, PassengerShipRole> => {
  const roles = new Map<string, PassengerShipRole>();

  if (!isPassengerEscortMission(state, playerId)) {
    return roles;
  }

  const primaryCarrier = selectPrimaryPassengerCarrier(state, playerId, map);

  if (primaryCarrier == null) {
    return roles;
  }

  roles.set(primaryCarrier.id, 'carrier');

  const nearestCarrierThreat = minBy(
    getThreateningEnemies(
      state.ships.filter(
        (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
      ),
    ),
    (enemy) => hexDistance(primaryCarrier.position, enemy.position),
  );
  const threatStrength =
    nearestCarrierThreat != null
      ? getCombatStrength([nearestCarrierThreat])
      : 0;

  for (const ship of state.ships) {
    if (
      ship.owner !== playerId ||
      ship.id === primaryCarrier.id ||
      ship.lifecycle !== 'active' ||
      ship.baseStatus === 'emplaced' ||
      (ship.passengersAboard ?? 0) > 0
    ) {
      continue;
    }

    if (ship.type === 'tanker' && sameFlightPath(ship, primaryCarrier)) {
      roles.set(ship.id, 'refuel');
      continue;
    }

    if (!canAttack(ship)) {
      continue;
    }

    const shipStrength = getCombatStrength([ship]);

    roles.set(ship.id, shipStrength >= threatStrength ? 'escort' : 'screen');
  }

  return roles;
};

const scoreObjectiveRaceCandidate = (
  ship: Ship,
  targetHex: { q: number; r: number } | null,
): number => {
  const stats = SHIP_STATS[ship.type];
  const targetScore =
    targetHex == null ? 0 : -hexDistance(ship.position, targetHex) * 24;

  return (
    targetScore +
    ship.fuel * 3 -
    hexVecLength(ship.velocity) * 6 +
    (stats?.canOverload ? 20 : 0) +
    (canAttack(ship) ? 8 : 0) -
    (ship.type === 'tanker' ? 180 : 0)
  );
};

export const assignTurnShipRoles = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): Map<string, ShipRole> => {
  const passengerRoles = assignPassengerShipRoles(state, playerId, map);

  if (passengerRoles.size > 0) {
    return new Map(passengerRoles);
  }

  const roles = new Map<string, ShipRole>();
  const caps = deriveCapabilities(state.scenarioRules);
  const player = state.players[playerId];
  const targetHex = getPlayerTargetHex(state, playerId, map);
  const hasMovementObjective =
    caps.isCheckpointRace || !!player.targetBody || player.escapeWins;
  const activeShips = state.ships.filter((ship) =>
    isActiveOwnShip(ship, playerId),
  );
  const raceShip = hasMovementObjective
    ? (maxBy(activeShips, (ship) =>
        scoreObjectiveRaceCandidate(ship, targetHex),
      ) ?? null)
    : null;

  if (raceShip) {
    roles.set(raceShip.id, 'race');
  }

  for (const ship of activeShips) {
    if (roles.has(ship.id)) {
      continue;
    }

    if (
      raceShip &&
      ship.type === 'tanker' &&
      sameFlightPath(ship, raceShip) &&
      raceShip.fuel <=
        Math.max(4, estimateDesiredFuel(raceShip, playerId, state, map))
    ) {
      roles.set(ship.id, 'refuel');
      continue;
    }

    if (canAttack(ship)) {
      roles.set(ship.id, hasMovementObjective ? 'escort' : 'interceptor');
      continue;
    }

    roles.set(ship.id, hasMovementObjective ? 'screen' : 'refuel');
  }

  return roles;
};

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

  if (currentDist > 6) {
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
  let score = (newDist - currentDist) * 70;

  if (newDist <= 1) {
    score -= 220;
  } else if (newDist === 2) {
    score -= 90;
  } else if (newDist === 3) {
    score -= 30;
  }

  score += (nextDriftDist - newDist) * 45;

  if (nextDriftDist <= 1) {
    score -= 180;
  } else if (nextDriftDist === 2) {
    score -= 120;
  } else if (nextDriftDist === 3) {
    score -= 45;
  }

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

export interface LogisticsTransferPlanAction {
  type: 'logisticsTransfer';
  transfer: TransferOrder;
}

export const chooseLogisticsTransferPlan = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  doctrine: AIDoctrineContext = buildAIDoctrineContext(state, playerId, map),
): PlanDecision<LogisticsTransferPlanAction> | null => {
  const player = state.players[playerId];
  const candidates = getTransferEligiblePairs(state, playerId).flatMap<
    PlanCandidate<LogisticsTransferPlanAction>
  >((pair) => {
    let bestScore = -Infinity;
    let bestTransfer: TransferOrder | null = null;
    let reason = '';

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
        const sourceArrival = scorePassengerArrivalOdds(
          pair.source,
          playerId,
          state,
          map,
        );
        const targetArrival = scorePassengerArrivalOdds(
          pair.target,
          playerId,
          state,
          map,
        );
        const sourceCanFight = canAttack(pair.source);
        const targetCanFight = canAttack(pair.target);
        const sourceCompromised =
          pair.source.damage.disabledTurns > 0 ||
          pair.source.control !== 'own' ||
          pair.source.lifecycle !== 'active';
        const preservesArrival = targetArrival >= sourceArrival - 15;
        const improvesArrival = targetArrival >= sourceArrival + 20;

        if (
          (sourceCompromised &&
            targetValue > sourceValue + 10 &&
            targetArrival >= sourceArrival - 40) ||
          (!sourceCanFight && targetCanFight && preservesArrival) ||
          (sourceCanFight === targetCanFight &&
            targetValue > sourceValue + 10 &&
            improvesArrival)
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
            reason = targetCanFight
              ? 'move passengers to stronger combat-capable carrier'
              : 'move passengers to better arrival carrier';
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
          reason =
            pair.target.id === doctrine.passenger.primaryCarrier?.id
              ? 'refuel primary passenger carrier'
              : 'refuel ship for objective route';
          bestTransfer = {
            sourceShipId: pair.source.id,
            targetShipId: pair.target.id,
            transferType: 'fuel',
            amount: usefulFuel,
          };
        }
      }
    }

    if (bestTransfer == null) return [];

    const intent =
      bestTransfer.transferType === 'passengers'
        ? 'transferPassengers'
        : 'supportPassengerCarrier';

    return [
      {
        id: `logistics-transfer:${bestTransfer.transferType}:${bestTransfer.sourceShipId}:${bestTransfer.targetShipId}`,
        intent,
        action: {
          type: 'logisticsTransfer',
          transfer: bestTransfer,
        },
        priority: bestScore,
        evaluation: planEvaluation({
          feasible: true,
          effort: 1,
        }),
        diagnostics: [
          {
            reason,
            detail: `${bestTransfer.sourceShipId} -> ${bestTransfer.targetShipId}`,
          },
        ],
      },
    ];
  });

  return chooseBestPlan(candidates);
};

const selectLogisticsTransfer = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  doctrine: AIDoctrineContext,
): LogisticsCandidate | null => {
  const plan = chooseLogisticsTransferPlan(state, playerId, map, doctrine);

  return plan == null
    ? null
    : {
        transfer: plan.chosen.action.transfer,
        score: plan.chosen.priority ?? 0,
      };
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
      ) <= 6
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
    const doctrine = buildAIDoctrineContext(workingState, playerId, map);
    const best = selectLogisticsTransfer(workingState, playerId, map, doctrine);

    if (!best || best.score <= 0) {
      break;
    }
    transfers.push(best.transfer);
    applyTransferToState(workingState, best.transfer);
  }

  return transfers;
};
