import {
  canAttack,
  computeGroupRangeMod,
  computeGroupRangeModToTarget,
  computeGroupVelocityMod,
  computeGroupVelocityModToTarget,
  computeOdds,
  getCombatStrength,
  getCounterattackers,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from '../../shared/combat';
import type { HexCoord } from '../../shared/hex';
import type {
  CombatAttack,
  CombatResult,
  GameState,
  Ordnance,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { clamp, filterMap } from '../../shared/util';

export interface CombatOverlayPlanningState {
  selectedShipId: string | null;
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
  modLabel: string;
  modColor: string;
  totalMod: number;
  canCounter: boolean;
}

const getCommittedAttackers = (queuedAttacks: CombatAttack[]): Set<string> => {
  return new Set(queuedAttacks.flatMap((attack) => attack.attackerIds));
};

const getQueuedTargetKeys = (queuedAttacks: CombatAttack[]): Set<string> => {
  return new Set(
    queuedAttacks.map((attack) => `${attack.targetType}:${attack.targetId}`),
  );
};

const getAvailableAttackers = (
  state: GameState,
  playerId: PlayerId,
  queuedAttacks: CombatAttack[],
): Ship[] => {
  const committedAttackers = getCommittedAttackers(queuedAttacks);

  return state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      canAttack(ship) &&
      !committedAttackers.has(ship.id),
  );
};

const getCurrentCombatTarget = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatOverlayPlanningState,
) => {
  const { combatTargetId: targetId, combatTargetType } = planning;

  if (!targetId) return null;

  if (combatTargetType === 'ordnance') {
    const ordnance = state.ordnance.find(
      (item) =>
        item.id === targetId &&
        item.lifecycle !== 'destroyed' &&
        item.owner !== playerId &&
        item.type === 'nuke',
    );

    return ordnance
      ? { targetType: 'ordnance' as const, target: ordnance }
      : null;
  }

  const ship = state.ships.find((item) => item.id === targetId);

  return ship ? { targetType: 'ship' as const, target: ship } : null;
};

export const getQueuedCombatOverlayAttacks = (
  state: GameState,
  queuedAttacks: CombatAttack[],
): QueuedCombatOverlayAttack[] => {
  return filterMap(queuedAttacks, (queued) => {
    const target =
      queued.targetType === 'ordnance'
        ? state.ordnance.find((item) => item.id === queued.targetId)
        : state.ships.find((item) => item.id === queued.targetId);

    if (!target) return null;

    return {
      targetPosition: target.position,
      attackerPositions: filterMap(
        queued.attackerIds,
        (attackerId) =>
          state.ships.find((ship) => ship.id === attackerId)?.position ?? null,
      ),
    };
  });
};

export const getCombatOverlayHighlights = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatOverlayPlanningState,
  map: SolarSystemMap | null,
): CombatOverlayHighlights => {
  if (map === null) {
    return {
      shipTargets: [],
      ordnanceTargets: [],
    };
  }

  const {
    combatTargetId: targetId,
    combatTargetType: targetType,
    queuedAttacks,
  } = planning;

  const queuedTargetKeys = getQueuedTargetKeys(queuedAttacks);
  const myAttackers = getAvailableAttackers(state, playerId, queuedAttacks);

  const shipTargets = state.ships
    .filter(
      (ship) =>
        ship.owner !== playerId &&
        ship.lifecycle === 'active' &&
        ship.detected &&
        !queuedTargetKeys.has(`ship:${ship.id}`) &&
        myAttackers.some((attacker) => hasLineOfSight(attacker, ship, map)),
    )
    .map((ship) => ({
      position: ship.position,
      isSelected: ship.id === targetId && targetType === 'ship',
    }));

  const ordnanceTargets = state.ordnance
    .filter(
      (ordnance) =>
        ordnance.lifecycle !== 'destroyed' &&
        ordnance.owner !== playerId &&
        ordnance.type === 'nuke' &&
        myAttackers.some((attacker) =>
          hasLineOfSightToTarget(attacker, ordnance, map),
        ),
    )
    .map((ordnance) => ({
      position: ordnance.position,
      isSelected: ordnance.id === targetId && targetType === 'ordnance',
    }));

  return { shipTargets, ordnanceTargets };
};

const getLegalPreviewAttackers = (
  target: Ship | Ordnance,
  targetType: 'ship' | 'ordnance',
  attackers: Ship[],
  map: SolarSystemMap,
): Ship[] => {
  if (targetType === 'ordnance') {
    return attackers.filter((attacker) =>
      hasLineOfSightToTarget(attacker, target, map),
    );
  }

  const shipTarget = target as Ship;

  return attackers.filter((attacker) =>
    hasLineOfSight(attacker, shipTarget, map),
  );
};

const resolvePreviewAttackers = (
  legalAttackers: Ship[],
  planning: CombatOverlayPlanningState,
  targetType: 'ship' | 'ordnance',
): Ship[] => {
  const selectedAttackers = legalAttackers.filter((ship) =>
    planning.combatAttackerIds.includes(ship.id),
  );

  if (selectedAttackers.length > 0) {
    return selectedAttackers;
  }

  if (targetType === 'ship' && planning.selectedShipId) {
    const selectedShip = legalAttackers.find(
      (ship) => ship.id === planning.selectedShipId,
    );

    if (selectedShip) {
      return [selectedShip];
    }
  }

  return legalAttackers;
};

const formatPreviewLabel = (
  target: Ship | Ordnance,
  targetType: 'ship' | 'ordnance',
  attackers: Ship[],
  allShips: Ship[],
  requestedStrength: number | null,
): {
  label: string;
  modLabel: string;
  modColor: string;
  totalMod: number;
  canCounter: boolean;
} => {
  let label = '';
  let rangeMod = 0;
  let velMod = 0;

  if (targetType === 'ordnance') {
    rangeMod = computeGroupRangeModToTarget(attackers, target);
    velMod = computeGroupVelocityModToTarget(attackers, target);
    label = '2:1';
  } else {
    const shipTarget = target as Ship;
    const maxAttackStrength = getCombatStrength(attackers);

    const attackStrength =
      maxAttackStrength > 0
        ? clamp(requestedStrength ?? maxAttackStrength, 1, maxAttackStrength)
        : 0;

    const defendStrength = getCombatStrength([shipTarget]);

    const odds = computeOdds(attackStrength, defendStrength);

    rangeMod = computeGroupRangeMod(attackers, shipTarget);
    velMod = computeGroupVelocityMod(attackers, shipTarget);

    label = `${odds} · STR ${attackStrength}/${maxAttackStrength}`;
  }

  const totalMod = -(rangeMod + velMod);

  const modSign = totalMod > 0 ? '+' : '';
  const modLabel = totalMod === 0 ? '' : `MOD ${modSign}${totalMod}`;

  const modColor =
    totalMod <= -3 ? '#ff6b6b' : totalMod <= -1 ? '#ffcc00' : '#8bc34a';

  const canCounter =
    targetType === 'ship'
      ? getCounterattackers(target as Ship, allShips).length > 0
      : false;

  return {
    label,
    modLabel,
    modColor,
    totalMod,
    canCounter,
  };
};

export const getCombatPreview = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatOverlayPlanningState,
  map: SolarSystemMap | null,
): CombatPreview | null => {
  if (map === null) return null;

  const targetInfo = getCurrentCombatTarget(state, playerId, planning);

  if (!targetInfo) return null;

  const myAttackers = getAvailableAttackers(
    state,
    playerId,
    planning.queuedAttacks,
  );

  const legalAttackers = getLegalPreviewAttackers(
    targetInfo.target,
    targetInfo.targetType,
    myAttackers,
    map,
  );

  if (legalAttackers.length === 0) {
    return {
      targetPosition: targetInfo.target.position,
      attackerPositions: [],
      label: 'NO LINE OF SIGHT',
      modLabel: 'Target is blocked by a celestial body',
      modColor: '#ff6b6b',
      totalMod: 0,
      canCounter: false,
    };
  }

  const activeAttackers = resolvePreviewAttackers(
    legalAttackers,
    planning,
    targetInfo.targetType,
  );

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
    modLabel: preview.modLabel,
    modColor: preview.modColor,
    totalMod: preview.totalMod,
    canCounter: preview.canCounter,
  };
};

export const formatCombatResult = (
  result: CombatResult,
  state: GameState,
): string => {
  const targetName =
    result.targetType === 'ordnance'
      ? 'nuke'
      : (state.ships.find((ship) => ship.id === result.targetId)?.type ??
        result.targetId);

  const damage =
    result.damageType === 'eliminated'
      ? 'ELIMINATED'
      : result.damageType === 'disabled'
        ? `DISABLED ${result.disabledTurns}T`
        : 'MISS';

  if (result.attackType === 'asteroidHazard') {
    return `${targetName}: asteroid [${result.dieRoll}] ${damage}`;
  }

  return `${result.odds} [${result.dieRoll}\u2192${result.modifiedRoll}] ${targetName}: ${damage}`;
};

export const getCombatTargetEntity = (
  result: CombatResult,
  state: GameState | null,
  previousState: GameState | null,
): Ship | Ordnance | null => {
  const sources = [state, previousState].filter(
    (source): source is GameState => source !== null,
  );

  for (const source of sources) {
    if (result.targetType === 'ordnance') {
      const ordnance = source.ordnance.find(
        (item) => item.id === result.targetId,
      );

      if (ordnance) return ordnance;
      continue;
    }

    const ship = source.ships.find((item) => item.id === result.targetId);

    if (ship) return ship;
  }

  return null;
};
