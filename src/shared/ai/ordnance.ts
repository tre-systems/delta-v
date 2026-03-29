import { getCombatStrength } from '../combat';
import { ORDNANCE_MASS, SHIP_STATS } from '../constants';
import { hexDistance, hexEqual, hexVecLength } from '../hex';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  GameState,
  OrdnanceLaunch,
  PlayerId,
  SolarSystemMap,
} from '../types';
import { minBy } from '../util';
import { findDirectionToward } from './common';
import { AI_CONFIG } from './config';
import type { AIDifficulty } from './types';

export const aiOrdnance = (
  state: GameState,
  playerId: PlayerId,
  _map: SolarSystemMap,
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

    if (!nearestEnemy) continue;

    const nearestDist = hexDistance(ship.position, nearestEnemy.position);
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
      const enemyStrength = getCombatStrength([nearestEnemy]);
      const myStrength = getCombatStrength([ship]);

      if (enemyStrength >= myStrength && nearestDist <= cfg.nukeStrengthRange) {
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
      nearestDist <= torpedoRange &&
      stats.canOverload &&
      cargoFree >= ORDNANCE_MASS.torpedo
    ) {
      const bestDir = findDirectionToward(ship.position, nearestEnemy.position);
      launches.push({
        shipId: ship.id,
        ordnanceType: 'torpedo',
        torpedoAccel: bestDir,
        torpedoAccelSteps: nearestDist > 4 ? 2 : 1,
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
