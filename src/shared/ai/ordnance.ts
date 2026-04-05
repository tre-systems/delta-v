import { canAttack, getCombatStrength } from '../combat';
import { ORDNANCE_MASS, SHIP_STATS } from '../constants';
import { hexAdd, hexDistance, hexEqual, hexVecLength } from '../hex';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  GameState,
  OrdnanceLaunch,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { maxBy, minBy } from '../util';
import { findDirectionToward } from './common';
import { AI_CONFIG } from './config';
import type { AIDifficulty } from './types';

interface ScoredEnemyTarget {
  enemy: Ship;
  currentDistance: number;
  predictedDistance: number;
  predictedPosition: { q: number; r: number };
  score: number;
}

const scoreEnemyTarget = (
  ship: Ship,
  enemy: Ship,
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): ScoredEnemyTarget => {
  const player = state.players[playerId];
  const predictedPosition = hexAdd(enemy.position, enemy.velocity);
  const currentDistance = hexDistance(ship.position, enemy.position);
  const predictedDistance = hexDistance(ship.position, predictedPosition);
  const targetHex = player.targetBody
    ? (map.bodies.find((body) => body.name === player.targetBody)?.center ??
      null)
    : null;
  const targetThreat =
    targetHex == null
      ? 0
      : Math.max(
          0,
          8 -
            Math.min(
              hexDistance(enemy.position, targetHex),
              hexDistance(predictedPosition, targetHex),
            ),
        ) * 10;
  const escapeThreat = player.escapeWins
    ? Math.max(0, 8 - currentDistance) * 8
    : 0;
  const passengerThreat = (enemy.passengersAboard ?? 0) > 0 ? 30 : 0;
  const combatThreat = canAttack(enemy) ? 24 : 6;
  const strengthThreat = getCombatStrength([enemy]) * 8;

  return {
    enemy,
    currentDistance,
    predictedDistance,
    predictedPosition,
    score:
      strengthThreat +
      combatThreat +
      targetThreat +
      escapeThreat +
      passengerThreat -
      predictedDistance * 6 -
      currentDistance * 2 +
      enemy.damage.disabledTurns * 4,
  };
};

export const aiOrdnance = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
  rng: () => number = Math.random,
): OrdnanceLaunch[] => {
  const cfg = AI_CONFIG[difficulty];
  const launches: OrdnanceLaunch[] = [];
  const caps = deriveCapabilities(state.scenarioRules);
  const allowedTypes = new Set(caps.allowedOrdnanceTypes);

  if (cfg.ordnanceSkipChance > 0 && rng() < cfg.ordnanceSkipChance) {
    return launches;
  }

  const enemyShips = state.ships.filter(
    (ship) => ship.owner !== playerId && ship.lifecycle !== 'destroyed',
  );

  if (enemyShips.length === 0) return launches;

  const torpedoRange = cfg.torpedoRange;
  const mineRange = cfg.mineRange;

  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.lifecycle !== 'active') {
      continue;
    }

    if (ship.damage.disabledTurns > 0) continue;
    if (caps.targetWinRequiresPassengers && (ship.passengersAboard ?? 0) > 0) {
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
    const nearestEnemy = minBy(enemyShips, (enemy) =>
      hexDistance(ship.position, enemy.position),
    );
    const bestEnemyTarget = maxBy(
      enemyShips.map((enemy) =>
        scoreEnemyTarget(ship, enemy, state, playerId, map),
      ),
      (target) => target.score,
    );

    if (!nearestEnemy || !bestEnemyTarget) continue;

    const nearestDist = hexDistance(ship.position, nearestEnemy.position);
    const bestEnemy = bestEnemyTarget.enemy;
    const bestEnemyCurrentDist = bestEnemyTarget.currentDistance;
    const bestEnemyPredictedDist = bestEnemyTarget.predictedDistance;
    const canLaunchNuke =
      (stats.canOverload || ship.nukesLaunchedSinceResupply < 1) &&
      !hasFriendlyLaunchStack &&
      (ship.passengersAboard ?? 0) === 0;

    if (
      allowedTypes.has('nuke') &&
      difficulty === 'hard' &&
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= torpedoRange &&
      cargoFree >= ORDNANCE_MASS.nuke &&
      canLaunchNuke
    ) {
      const enemyStrength = getCombatStrength([bestEnemy]);
      const myStrength = getCombatStrength([ship]);
      const shouldUseNuke =
        bestEnemyTarget.score >= 70 ||
        (enemyStrength >= myStrength &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange) ||
        ((bestEnemy.passengersAboard ?? 0) > 0 &&
          bestEnemyCurrentDist <= cfg.nukeStrengthRange);

      if (shouldUseNuke && bestEnemyCurrentDist <= cfg.nukeStrengthRange) {
        launches.push({
          shipId: ship.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        });
        continue;
      }
    }

    if (
      allowedTypes.has('torpedo') &&
      Math.min(bestEnemyCurrentDist, bestEnemyPredictedDist) <= torpedoRange &&
      stats.canOverload &&
      cargoFree >= ORDNANCE_MASS.torpedo
    ) {
      const bestDir = findDirectionToward(
        ship.position,
        bestEnemyTarget.predictedPosition,
      );
      launches.push({
        shipId: ship.id,
        ordnanceType: 'torpedo',
        torpedoAccel: bestDir,
        torpedoAccelSteps:
          bestEnemyPredictedDist > 4 || hexVecLength(bestEnemy.velocity) > 1
            ? 2
            : 1,
      });
      continue;
    }

    if (
      allowedTypes.has('mine') &&
      nearestDist <= mineRange &&
      cargoFree >= ORDNANCE_MASS.mine
    ) {
      const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
        (order) => order.shipId === ship.id,
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

    const player = state.players[playerId];

    if (
      allowedTypes.has('mine') &&
      player?.escapeWins &&
      nearestDist <= 8 &&
      cargoFree >= ORDNANCE_MASS.mine
    ) {
      const speed = hexVecLength(ship.velocity);

      if (speed >= 2 && difficulty !== 'easy') {
        const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
          (order) => order.shipId === ship.id,
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
