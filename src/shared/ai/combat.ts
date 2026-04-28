import {
  canAttack,
  computeGroupRangeMod,
  computeGroupRangeModToTarget,
  computeGroupVelocityMod,
  computeGroupVelocityModToTarget,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from '../combat';
import { hexDistance } from '../hex';
import { combatTargetKey, type OrdnanceId, type ShipId } from '../ids';
import { deriveCapabilities } from '../scenario-capabilities';
import type {
  CombatAttack,
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types';
import { minBy, sumBy } from '../util';
import { estimateTurnsToTargetLanding } from './common';
import { resolveAIConfig } from './config';
import { buildAIDoctrineContext } from './doctrine';
import {
  chooseCombatAttackGroupPlan,
  chooseCombatTargetPlan,
} from './plans/combat';
import { choosePassengerCombatPlan } from './plans/passenger';
import type { AIDifficulty } from './types';

interface ScoredTarget {
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
  attackers: Ship[];
  score: number;
  passengerCarrier?: boolean;
  disabledTurns?: number;
}

export const aiCombat = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
): CombatAttack[] => {
  const caps = deriveCapabilities(state.scenarioRules);

  if (!caps.combatEnabled) return [];

  const cfg = resolveAIConfig(
    difficulty,
    state.scenarioRules?.aiConfigOverrides as
      | Parameters<typeof resolveAIConfig>[1]
      | undefined,
  );
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
  const player = state.players[playerId];
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const opponent = state.players[opponentId];
  const targetHex = player.targetBody
    ? (map.bodies.find((body) => body.name === player.targetBody)?.center ??
      null)
    : null;
  const homeHex = player.homeBody
    ? (map.bodies.find((body) => body.name === player.homeBody)?.center ?? null)
    : null;
  const singleShipObjectiveDuel =
    !caps.isCheckpointRace &&
    !caps.targetWinRequiresPassengers &&
    targetHex != null &&
    homeHex != null &&
    myShips.length === 1 &&
    enemyShips.filter(canAttack).length === 1;
  const myBestObjectiveDistance =
    !singleShipObjectiveDuel || targetHex == null
      ? null
      : Math.min(
          ...myShips.map((ship) => hexDistance(ship.position, targetHex)),
        );
  const myLandingTurns =
    singleShipObjectiveDuel && player.targetBody && myShips.length === 1
      ? estimateTurnsToTargetLanding(
          myShips[0],
          player.targetBody,
          map,
          state.destroyedBases,
        )
      : null;
  const enemyLandingTurns =
    singleShipObjectiveDuel &&
    opponent?.targetBody &&
    enemyShips.filter(canAttack).length === 1
      ? estimateTurnsToTargetLanding(
          enemyShips.filter(canAttack)[0],
          opponent.targetBody,
          map,
          state.destroyedBases,
        )
      : null;
  const enemyNukes = state.ordnance.filter(
    (ordnance) =>
      ordnance.owner !== playerId &&
      ordnance.lifecycle !== 'destroyed' &&
      ordnance.type === 'nuke',
  );
  const shouldPreserveLandingLine =
    singleShipObjectiveDuel && myLandingTurns === 1 && enemyLandingTurns !== 0;
  const doctrine = buildAIDoctrineContext(state, playerId, map, enemyShips);
  const passengerCombatPlan = doctrine.passenger.isPassengerMission
    ? choosePassengerCombatPlan(
        state,
        playerId,
        map,
        enemyShips,
        enemyNukes,
        doctrine.passenger,
      )
    : null;
  const shipRoles = doctrine.shipRoles;

  if (enemyShips.length === 0 && enemyNukes.length === 0) {
    return [];
  }

  if (
    shouldPreserveLandingLine ||
    passengerCombatPlan?.chosen.action.type === 'skipCombat'
  ) {
    return [];
  }

  const scored: ScoredTarget[] = [];

  for (const enemy of enemyShips) {
    if (enemy.lifecycle === 'landed') continue;
    if (
      singleShipObjectiveDuel &&
      homeHex != null &&
      myBestObjectiveDistance != null
    ) {
      if (
        myLandingTurns === 1 &&
        (enemyLandingTurns == null || enemyLandingTurns > 1)
      ) {
        continue;
      }
      const predictedEnemy = {
        q: enemy.position.q + enemy.velocity.dq,
        r: enemy.position.r + enemy.velocity.dr,
      };
      const enemyPressureDistance = Math.min(
        hexDistance(enemy.position, homeHex),
        hexDistance(predictedEnemy, homeHex),
      );
      const enemyObjectiveDistance = targetHex
        ? Math.min(
            hexDistance(enemy.position, targetHex),
            hexDistance(predictedEnemy, targetHex),
          )
        : Number.POSITIVE_INFINITY;
      const enemyClosingOnObjective =
        enemyObjectiveDistance <= 2 ||
        (enemyObjectiveDistance <= 5 &&
          enemyObjectiveDistance + 3 < myBestObjectiveDistance);
      const isStrategicThreat =
        enemyPressureDistance <= 4 ||
        enemyPressureDistance + 5 < myBestObjectiveDistance ||
        enemyClosingOnObjective;

      if (!isStrategicThreat) {
        continue;
      }
    }

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
    const passengerObjectiveTargetBonus =
      caps.targetWinRequiresPassengers && (enemy.passengersAboard ?? 0) > 0
        ? 80
        : 0;
    const score =
      passengerObjectiveTargetBonus -
      avgDist * cfg.targetDistPenalty -
      totalMod * cfg.targetModPenalty +
      enemy.damage.disabledTurns * cfg.targetDisabledBonus;

    scored.push({
      targetId: enemy.id,
      targetType: 'ship',
      attackers: attackersForTarget,
      score,
      passengerCarrier:
        caps.targetWinRequiresPassengers && (enemy.passengersAboard ?? 0) > 0,
      disabledTurns: enemy.damage.disabledTurns,
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

  const targetPlan = chooseCombatTargetPlan(scored);

  if (!targetPlan) return [];

  const scoredByKey = new Map(
    scored.map((target) => [
      combatTargetKey(target.targetType, target.targetId),
      target,
    ]),
  );
  const orderedTargets = [targetPlan.chosen, ...targetPlan.rejected]
    .map((candidate) =>
      scoredByKey.get(
        combatTargetKey(candidate.action.targetType, candidate.action.targetId),
      ),
    )
    .filter((target): target is ScoredTarget => target != null);

  const attacks: CombatAttack[] = [];
  const committedAttackers = new Set<string>();
  const committedTargets = new Set<string>();
  const minRollThreshold = cfg.minRollThreshold;

  for (const target of orderedTargets) {
    const targetKey = combatTargetKey(target.targetType, target.targetId);

    if (committedTargets.has(targetKey)) continue;

    const availableAttackers = target.attackers.filter(
      (attacker) => !committedAttackers.has(attacker.id),
    );

    if (availableAttackers.length === 0) continue;

    if (target.targetType === 'ship') {
      const enemy = enemyShips.find((ship) => ship.id === target.targetId);

      if (!enemy) continue;

      const attackGroupPlan = chooseCombatAttackGroupPlan({
        targetId: target.targetId,
        targetType: target.targetType,
        enemyShip: enemy,
        availableAttackers,
        shipRoles,
        minRollThreshold,
      });

      if (!attackGroupPlan) continue;

      attacks.push({
        attackerIds: attackGroupPlan.chosen.action.attackerIds,
        targetId: attackGroupPlan.chosen.action.targetId,
        targetType: attackGroupPlan.chosen.action.targetType,
        attackStrength: attackGroupPlan.chosen.action.attackStrength,
      });
      for (const attackerId of attackGroupPlan.chosen.action.attackerIds) {
        committedAttackers.add(attackerId);
      }
    } else {
      const attackGroupPlan = chooseCombatAttackGroupPlan({
        targetId: target.targetId,
        targetType: target.targetType,
        enemyShip: null,
        availableAttackers,
        shipRoles,
        minRollThreshold,
      });

      if (!attackGroupPlan) continue;

      attacks.push({
        attackerIds: attackGroupPlan.chosen.action.attackerIds,
        targetId: attackGroupPlan.chosen.action.targetId,
        targetType: attackGroupPlan.chosen.action.targetType,
        attackStrength: attackGroupPlan.chosen.action.attackStrength,
      });
      for (const attackerId of attackGroupPlan.chosen.action.attackerIds) {
        committedAttackers.add(attackerId);
      }
    }

    committedTargets.add(targetKey);

    if (cfg.singleAttackOnly) break;
  }

  return attacks;
};
