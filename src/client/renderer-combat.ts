import {
  computeOdds,
  computeGroupRangeMod,
  computeGroupRangeModToTarget,
  computeGroupVelocityMod,
  computeGroupVelocityModToTarget,
  getCombatStrength,
  getCounterattackers,
  canAttack,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from '../shared/combat';
import type { HexCoord } from '../shared/hex';
import type { CombatAttack, CombatResult, GameState, Ordnance, Ship, SolarSystemMap } from '../shared/types';

export interface CombatOverlayPlanningState {
  combatTargetId: string | null;
  combatTargetType: 'ship' | 'ordnance' | null;
  combatAttackerIds: string[];
  combatAttackStrength: number | null;
  queuedAttacks: CombatAttack[];
}

export interface QueuedCombatOverlayAttack {
  targetPosition: HexCoord;
  attackerPositions: HexCoord[];
}

export interface CombatOverlayHighlight {
  position: HexCoord;
  isSelected: boolean;
}

export interface CombatOverlayHighlights {
  shipTargets: CombatOverlayHighlight[];
  ordnanceTargets: CombatOverlayHighlight[];
}

export interface CombatPreview {
  targetPosition: HexCoord;
  attackerPositions: HexCoord[];
  label: string;
  totalMod: number;
  counterattackLabel: string | null;
}

function getCommittedAttackers(queuedAttacks: CombatAttack[]): Set<string> {
  return new Set(queuedAttacks.flatMap((attack) => attack.attackerIds));
}

function getQueuedTargetKeys(queuedAttacks: CombatAttack[]): Set<string> {
  return new Set(queuedAttacks.map((attack) => `${attack.targetType ?? 'ship'}:${attack.targetId}`));
}

function getAvailableAttackers(state: GameState, playerId: number, queuedAttacks: CombatAttack[]): Ship[] {
  const committedAttackers = getCommittedAttackers(queuedAttacks);
  return state.ships.filter((ship) =>
    ship.owner === playerId && !ship.destroyed && canAttack(ship) && !committedAttackers.has(ship.id),
  );
}

function getCurrentCombatTarget(state: GameState, playerId: number, planning: CombatOverlayPlanningState) {
  const targetId = planning.combatTargetId;
  if (!targetId) return null;
  if (planning.combatTargetType === 'ordnance') {
    const ordnance = state.ordnance.find((item) =>
      item.id === targetId && !item.destroyed && item.owner !== playerId && item.type === 'nuke',
    );
    return ordnance ? { targetType: 'ordnance' as const, target: ordnance } : null;
  }
  const ship = state.ships.find((item) => item.id === targetId);
  return ship ? { targetType: 'ship' as const, target: ship } : null;
}

export function getQueuedCombatOverlayAttacks(
  state: GameState,
  queuedAttacks: CombatAttack[],
): QueuedCombatOverlayAttack[] {
  const overlays: QueuedCombatOverlayAttack[] = [];
  for (const queued of queuedAttacks) {
    const target = (queued.targetType ?? 'ship') === 'ordnance'
      ? state.ordnance.find((item) => item.id === queued.targetId)
      : state.ships.find((item) => item.id === queued.targetId);
    if (!target) continue;
    overlays.push({
      targetPosition: target.position,
      attackerPositions: queued.attackerIds
        .map((attackerId) => state.ships.find((ship) => ship.id === attackerId)?.position ?? null)
        .filter((position): position is HexCoord => position !== null),
    });
  }
  return overlays;
}

export function getCombatOverlayHighlights(
  state: GameState,
  playerId: number,
  planning: CombatOverlayPlanningState,
  map: SolarSystemMap | null,
): CombatOverlayHighlights {
  if (map === null) {
    return { shipTargets: [], ordnanceTargets: [] };
  }

  const targetId = planning.combatTargetId;
  const targetType = planning.combatTargetType;
  const queuedTargetKeys = getQueuedTargetKeys(planning.queuedAttacks);
  const myAttackers = getAvailableAttackers(state, playerId, planning.queuedAttacks);
  const shipTargets = state.ships
    .filter((ship) =>
      ship.owner !== playerId &&
      !ship.destroyed &&
      !ship.landed &&
      ship.detected &&
      !queuedTargetKeys.has(`ship:${ship.id}`) &&
      myAttackers.some((attacker) => hasLineOfSight(attacker, ship, map)),
    )
    .map((ship) => ({
      position: ship.position,
      isSelected: ship.id === targetId && targetType === 'ship',
    }));
  const ordnanceTargets = state.ordnance
    .filter((ordnance) =>
      !ordnance.destroyed &&
      ordnance.owner !== playerId &&
      ordnance.type === 'nuke' &&
      myAttackers.some((attacker) => hasLineOfSightToTarget(attacker, ordnance, map)),
    )
    .map((ordnance) => ({
      position: ordnance.position,
      isSelected: ordnance.id === targetId && targetType === 'ordnance',
    }));
  return { shipTargets, ordnanceTargets };
}

function getLegalPreviewAttackers(
  target: Ship | Ordnance,
  targetType: 'ship' | 'ordnance',
  attackers: Ship[],
  map: SolarSystemMap,
): Ship[] {
  if (targetType === 'ordnance') {
    return attackers.filter((attacker) => hasLineOfSightToTarget(attacker, target, map));
  }
  const shipTarget = target as Ship;
  return attackers.filter((attacker) => hasLineOfSight(attacker, shipTarget, map));
}

function formatPreviewLabel(
  target: Ship | Ordnance,
  targetType: 'ship' | 'ordnance',
  attackers: Ship[],
  allShips: Ship[],
  requestedStrength: number | null,
): { label: string; totalMod: number; counterattackLabel: string | null } {
  let label = '';
  let rangeMod = 0;
  let velMod = 0;

  if (targetType === 'ordnance') {
    rangeMod = computeGroupRangeModToTarget(attackers, target);
    velMod = computeGroupVelocityModToTarget(attackers, target);
    label = `2:1  R-${rangeMod} V-${velMod}`;
  } else {
    const shipTarget = target as Ship;
    const maxAttackStrength = getCombatStrength(attackers);
    const attackStrength = maxAttackStrength > 0
      ? Math.max(1, Math.min(maxAttackStrength, requestedStrength ?? maxAttackStrength))
      : 0;
    const defendStrength = getCombatStrength([shipTarget]);
    const odds = computeOdds(attackStrength, defendStrength);
    rangeMod = computeGroupRangeMod(attackers, shipTarget);
    velMod = computeGroupVelocityMod(attackers, shipTarget);
    label = `${odds}  ATK ${attackStrength}/${maxAttackStrength}  R-${rangeMod} V-${velMod}`;
  }

  const totalMod = -(rangeMod + velMod);
  const modLabel = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
  const counterattackLabel = targetType === 'ship'
    ? getCounterattackers(target as Ship, allShips).length > 0
      ? `CAN COUNTER${attackers.length > 1 ? ` / ${attackers.length} SHIPS` : ''}`
      : null
    : null;
  return {
    label: `${label}  (${modLabel})`,
    totalMod,
    counterattackLabel,
  };
}

export function getCombatPreview(
  state: GameState,
  playerId: number,
  planning: CombatOverlayPlanningState,
  map: SolarSystemMap | null,
): CombatPreview | null {
  if (map === null) return null;

  const targetInfo = getCurrentCombatTarget(state, playerId, planning);
  if (!targetInfo) return null;

  const myAttackers = getAvailableAttackers(state, playerId, planning.queuedAttacks);
  const legalAttackers = getLegalPreviewAttackers(targetInfo.target, targetInfo.targetType, myAttackers, map);
  if (legalAttackers.length === 0) return null;

  const selectedAttackers = legalAttackers.filter((ship) => planning.combatAttackerIds.includes(ship.id));
  const activeAttackers = selectedAttackers.length > 0 ? selectedAttackers : legalAttackers;
  const preview = formatPreviewLabel(
    targetInfo.target,
    targetInfo.targetType,
    activeAttackers,
    state.ships,
    planning.combatAttackStrength,
  );
  return {
    targetPosition: targetInfo.target.position,
    attackerPositions: activeAttackers.map((attacker) => attacker.position),
    label: preview.label,
    totalMod: preview.totalMod,
    counterattackLabel: preview.counterattackLabel,
  };
}

export function formatCombatResult(result: CombatResult, state: GameState): string {
  const targetName = result.targetType === 'ordnance'
    ? 'nuke'
    : state.ships.find((ship) => ship.id === result.targetId)?.type ?? result.targetId;
  const damage = result.damageType === 'eliminated'
    ? 'ELIMINATED'
    : result.damageType === 'disabled'
      ? `DISABLED ${result.disabledTurns}T`
      : 'MISS';
  if (result.attackType === 'asteroidHazard') {
    return `${targetName}: asteroid [${result.dieRoll}] ${damage}`;
  }
  return `${result.odds} [${result.dieRoll}→${result.modifiedRoll}] ${targetName}: ${damage}`;
}

export function getCombatTargetEntity(
  result: CombatResult,
  state: GameState | null,
  previousState: GameState | null,
): Ship | Ordnance | null {
  const sources = [state, previousState].filter((source): source is GameState => source !== null);
  for (const source of sources) {
    if (result.targetType === 'ordnance') {
      const ordnance = source.ordnance.find((item) => item.id === result.targetId);
      if (ordnance) return ordnance;
      continue;
    }
    const ship = source.ships.find((item) => item.id === result.targetId);
    if (ship) return ship;
  }
  return null;
}
