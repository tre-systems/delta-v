import { canAttack, getCombatStrength, hasLineOfSight, hasLineOfSightToTarget } from '../shared/combat';
import { hexEqual } from '../shared/hex';
import type { CombatAttack, GameState, SolarSystemMap } from '../shared/types';
import type { PlanningState } from './renderer';

type CombatPlanningSnapshot = Pick<
  PlanningState,
  'combatTargetId' | 'combatTargetType' | 'combatAttackerIds' | 'combatAttackStrength' | 'queuedAttacks'
>;

export interface ReusableCombatGroup {
  attackerIds: string[];
  remainingStrength: number;
}

function getGroupKey(attackerIds: string[]): string {
  return [...attackerIds].sort().join('|');
}

function getCommittedAttackers(queuedAttacks: CombatAttack[]): Set<string> {
  return new Set(queuedAttacks.flatMap((attack) => attack.attackerIds));
}

function getTargetedKeys(queuedAttacks: CombatAttack[]): Set<string> {
  return new Set(queuedAttacks.map((attack) => `${attack.targetType ?? 'ship'}:${attack.targetId}`));
}

export function getReusableCombatGroup(
  state: GameState,
  playerId: number,
  queuedAttacks: CombatAttack[],
  targetId: string,
): ReusableCombatGroup | null {
  const target = state.ships.find((ship) => ship.id === targetId && !ship.destroyed && ship.owner !== playerId);
  if (!target) return null;

  for (let index = queuedAttacks.length - 1; index >= 0; index--) {
    const queued = queuedAttacks[index];
    if ((queued.targetType ?? 'ship') !== 'ship') continue;
    const queuedTarget = state.ships.find((ship) => ship.id === queued.targetId && !ship.destroyed);
    if (!queuedTarget || !hexEqual(queuedTarget.position, target.position)) continue;

    const groupKey = getGroupKey(queued.attackerIds);
    const attackers = state.ships.filter((ship) => queued.attackerIds.includes(ship.id));
    const maxStrength = getCombatStrength(attackers);
    let allocatedStrength = 0;
    for (const attack of queuedAttacks) {
      if ((attack.targetType ?? 'ship') !== 'ship') continue;
      if (getGroupKey(attack.attackerIds) !== groupKey) continue;
      const attackTarget = state.ships.find((ship) => ship.id === attack.targetId && !ship.destroyed);
      if (!attackTarget || !hexEqual(attackTarget.position, target.position)) continue;
      allocatedStrength += attack.attackStrength ?? maxStrength;
    }

    const remainingStrength = Math.max(0, maxStrength - allocatedStrength);
    if (remainingStrength > 0) {
      return { attackerIds: [...queued.attackerIds], remainingStrength };
    }
  }
  return null;
}

export function hasSplitFireOptions(
  state: GameState,
  playerId: number,
  queuedAttacks: CombatAttack[],
): boolean {
  const queuedTargets = getTargetedKeys(queuedAttacks);
  for (const attack of queuedAttacks) {
    if ((attack.targetType ?? 'ship') !== 'ship') continue;
    const target = state.ships.find((ship) => ship.id === attack.targetId && !ship.destroyed);
    if (!target) continue;
    const reusable = getReusableCombatGroup(state, playerId, queuedAttacks, target.id);
    if (!reusable || reusable.remainingStrength <= 0) continue;
    const untargetedSameHex = state.ships.some((ship) =>
      ship.owner !== playerId &&
      !ship.destroyed &&
      !ship.landed &&
      hexEqual(ship.position, target.position) &&
      !queuedTargets.has(`ship:${ship.id}`),
    );
    if (untargetedSameHex) return true;
  }
  return false;
}

function clampAttackStrength(maxStrength: number, requestedStrength: number | null): number | null {
  if (maxStrength <= 0) return null;
  return Math.max(1, Math.min(maxStrength, requestedStrength ?? maxStrength));
}

export function buildCurrentAttack(
  state: GameState,
  playerId: number,
  planning: CombatPlanningSnapshot,
  map: SolarSystemMap,
): CombatAttack | null {
  const targetId = planning.combatTargetId;
  const targetType = planning.combatTargetType ?? 'ship';
  if (!targetId) return null;

  const committedAttackers = getCommittedAttackers(planning.queuedAttacks);
  if (targetType === 'ordnance') {
    const target = state.ordnance.find((ordnance) =>
      ordnance.id === targetId && !ordnance.destroyed && ordnance.owner !== playerId && ordnance.type === 'nuke',
    );
    if (!target) return null;
    const legalAttackers = state.ships
      .filter((ship) => ship.owner === playerId && !ship.destroyed && canAttack(ship) && !committedAttackers.has(ship.id))
      .filter((ship) => hasLineOfSightToTarget(ship, target, map));
    const selectedAttackers = legalAttackers.filter((ship) => planning.combatAttackerIds.includes(ship.id));
    const attackerIds = (selectedAttackers.length > 0 ? selectedAttackers : legalAttackers).map((ship) => ship.id);
    return attackerIds.length > 0 ? { attackerIds, targetId, targetType, attackStrength: null } : null;
  }

  const target = state.ships.find((ship) => ship.id === targetId && !ship.destroyed);
  if (!target) return null;
  const reusableGroup = getReusableCombatGroup(state, playerId, planning.queuedAttacks, targetId);
  if (reusableGroup) {
    const attackStrength = clampAttackStrength(reusableGroup.remainingStrength, planning.combatAttackStrength ?? null);
    return attackStrength
      ? { attackerIds: [...reusableGroup.attackerIds], targetId, targetType, attackStrength }
      : null;
  }

  const legalAttackers = state.ships
    .filter((ship) => ship.owner === playerId && !ship.destroyed && canAttack(ship) && !committedAttackers.has(ship.id))
    .filter((ship) => hasLineOfSight(ship, target, map));
  const selectedAttackers = legalAttackers.filter((ship) => planning.combatAttackerIds.includes(ship.id));
  const attackers = selectedAttackers.length > 0 ? selectedAttackers : legalAttackers;
  const attackStrength = clampAttackStrength(getCombatStrength(attackers), planning.combatAttackStrength ?? null);
  return attackers.length > 0 && attackStrength
    ? { attackerIds: attackers.map((ship) => ship.id), targetId, targetType, attackStrength }
    : null;
}

export function countRemainingCombatAttackers(
  state: GameState,
  playerId: number,
  queuedAttacks: CombatAttack[],
): number {
  const committedAttackers = getCommittedAttackers(queuedAttacks);
  return state.ships.filter((ship) =>
    ship.owner === playerId && !ship.destroyed && canAttack(ship) && !committedAttackers.has(ship.id),
  ).length;
}

export function getAttackStrengthForSelection(state: GameState, attackerIds: string[]): number {
  return getCombatStrength(state.ships.filter((ship) => attackerIds.includes(ship.id)));
}
