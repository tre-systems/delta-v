import {
  canAttack,
  computeGroupRangeMod,
  computeGroupRangeModToTarget,
  computeGroupVelocityMod,
  computeGroupVelocityModToTarget,
  getCombatStrength,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from '../combat';
import { hexDistance } from '../hex';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  CombatAttack,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { minBy, sumBy } from '../util';
import { AI_CONFIG } from './config';
import type { AIDifficulty } from './types';

interface ScoredTarget {
  targetId: string;
  targetType: 'ship' | 'ordnance';
  attackers: Ship[];
  score: number;
}

export const aiCombat = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): CombatAttack[] => {
  if (!deriveCapabilities(state.scenarioRules).combatEnabled) return [];

  const cfg = AI_CONFIG[difficulty];
  const myShips = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      canAttack(ship),
  );

  if (myShips.length === 0) return [];

  const enemyShips = state.ships.filter(
    (ship) =>
      ship.owner !== playerId &&
      ship.lifecycle !== 'destroyed' &&
      ship.detected,
  );
  const enemyNukes = state.ordnance.filter(
    (ordnance) =>
      ordnance.owner !== playerId &&
      ordnance.lifecycle !== 'destroyed' &&
      ordnance.type === 'nuke',
  );

  if (enemyShips.length === 0 && enemyNukes.length === 0) {
    return [];
  }

  const scored: ScoredTarget[] = [];

  for (const enemy of enemyShips) {
    if (enemy.lifecycle === 'landed') continue;

    const attackersForTarget = myShips.filter((attacker) =>
      hasLineOfSight(attacker, enemy, map),
    );

    if (attackersForTarget.length === 0) continue;

    const avgDist =
      sumBy(attackersForTarget, (attacker) =>
        hexDistance(attacker.position, enemy.position),
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
      sumBy(attackersForTarget, (attacker) =>
        hexDistance(attacker.position, nuke.position),
      ) / attackersForTarget.length;
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

  scored.sort((left, right) => right.score - left.score);

  const attacks: CombatAttack[] = [];
  const committedAttackers = new Set<string>();
  const committedTargets = new Set<string>();
  const minRollThreshold = cfg.minRollThreshold;

  for (const target of scored) {
    const targetKey = `${target.targetType}:${target.targetId}`;

    if (committedTargets.has(targetKey)) continue;

    const availableAttackers = target.attackers.filter(
      (attacker) => !committedAttackers.has(attacker.id),
    );

    if (availableAttackers.length === 0) continue;

    if (target.targetType === 'ship') {
      const enemy = enemyShips.find((ship) => ship.id === target.targetId);

      if (!enemy) continue;

      const nonPassengerAttackers = availableAttackers.filter(
        (attacker) => (attacker.passengersAboard ?? 0) === 0,
      );
      const available =
        nonPassengerAttackers.length > 0
          ? nonPassengerAttackers
          : availableAttackers;
      const attackStrength = getCombatStrength(available);
      const defendStrength = getCombatStrength([enemy]);
      const rangeMod = computeGroupRangeMod(available, enemy);
      const velMod = computeGroupVelocityMod(available, enemy);

      if (
        6 - rangeMod - velMod < minRollThreshold &&
        attackStrength <= defendStrength
      ) {
        continue;
      }

      if (
        nonPassengerAttackers.length === 0 &&
        available.some((attacker) => (attacker.passengersAboard ?? 0) > 0) &&
        enemy.damage.disabledTurns === 0 &&
        attackStrength <= defendStrength
      ) {
        continue;
      }

      attacks.push({
        attackerIds: available.map((ship) => ship.id),
        targetId: target.targetId,
        targetType: target.targetType,
        attackStrength: null,
      });
      for (const attacker of available) {
        committedAttackers.add(attacker.id);
      }
    } else {
      attacks.push({
        attackerIds: availableAttackers.map((ship) => ship.id),
        targetId: target.targetId,
        targetType: target.targetType,
        attackStrength: null,
      });
      for (const attacker of availableAttackers) {
        committedAttackers.add(attacker.id);
      }
    }

    committedTargets.add(targetKey);

    if (cfg.singleAttackOnly) break;
  }

  return attacks;
};
