import {
  canAttack,
  getCombatStrength,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from '../../shared/combat';
import { type HexCoord, hexDistance, hexEqual } from '../../shared/hex';
import type {
  CombatAttack,
  GameState,
  Ordnance,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { clamp, filterMap } from '../../shared/util';
import type { PlanningState } from './planning';

type CombatPlanningSnapshot = Pick<
  PlanningState,
  | 'combatTargetId'
  | 'combatTargetType'
  | 'combatAttackerIds'
  | 'combatAttackStrength'
  | 'queuedAttacks'
>;

export interface ReusableCombatGroup {
  attackerIds: string[];
  remainingStrength: number;
}

export interface CombatTargetSelection {
  targetId: string;
  targetType: 'ship' | 'ordnance';
}

type CombatTargetType = CombatTargetSelection['targetType'];
type CombatTarget = Ship | Ordnance;

export interface CombatTargetPlan {
  combatTargetId: string | null;
  combatTargetType: 'ship' | 'ordnance' | null;
  combatAttackerIds: string[];
  combatAttackStrength: number | null;
}

export interface CombatAttackerToggleResult {
  consumed: boolean;
  combatAttackerIds: string[];
  combatAttackStrength: number | null;
}

const getGroupKey = (attackerIds: string[]): string => {
  return [...attackerIds].sort().join('|');
};

const getCommittedAttackers = (queuedAttacks: CombatAttack[]): Set<string> => {
  return new Set(queuedAttacks.flatMap((attack) => attack.attackerIds));
};

const getTargetedKeys = (queuedAttacks: CombatAttack[]): Set<string> => {
  return new Set(
    queuedAttacks.map((attack) => `${attack.targetType}:${attack.targetId}`),
  );
};

const getAvailableCombatAttackers = (
  state: GameState,
  playerId: PlayerId,
  committedAttackers: Set<string>,
) => {
  return state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      canAttack(ship) &&
      !committedAttackers.has(ship.id),
  );
};

const getEnemyShipTarget = (
  state: GameState,
  playerId: PlayerId,
  targetId: string,
) => {
  return state.ships.find(
    (ship) =>
      ship.id === targetId &&
      ship.lifecycle !== 'destroyed' &&
      ship.owner !== playerId,
  );
};

const getEnemyOrdnanceTarget = (
  state: GameState,
  playerId: PlayerId,
  targetId: string,
) => {
  return state.ordnance.find(
    (item) =>
      item.id === targetId &&
      item.lifecycle !== 'destroyed' &&
      item.owner !== playerId &&
      item.type === 'nuke',
  );
};

const getEnemyOrdnanceTargetAtHex = (
  state: GameState,
  playerId: PlayerId,
  clickHex: HexCoord,
) => {
  return state.ordnance.find(
    (item) =>
      item.owner !== playerId &&
      item.lifecycle !== 'destroyed' &&
      item.type === 'nuke' &&
      hexEqual(clickHex, item.position),
  );
};

const getEnemyCombatTarget = (
  state: GameState,
  playerId: PlayerId,
  targetId: string,
  targetType: CombatTargetType,
): CombatTarget | null => {
  return targetType === 'ship'
    ? (getEnemyShipTarget(state, playerId, targetId) ?? null)
    : (getEnemyOrdnanceTarget(state, playerId, targetId) ?? null);
};

const getAttackersByIds = (state: GameState, attackerIds: string[]): Ship[] => {
  return filterMap(attackerIds, (id) => {
    const ship = state.ships.find((candidate) => candidate.id === id);

    return ship && ship.lifecycle !== 'destroyed' && canAttack(ship)
      ? ship
      : null;
  });
};

const getFriendlyCombatShipsAtHex = (
  state: GameState,
  playerId: PlayerId,
  clickHex: HexCoord,
): Ship[] => {
  return state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      canAttack(ship) &&
      hexEqual(clickHex, ship.position),
  );
};

const getUntargetedEnemyShipsAtHex = (
  state: GameState,
  playerId: PlayerId,
  clickHex: HexCoord,
  queuedTargets: Set<string>,
): Ship[] => {
  return state.ships.filter(
    (ship) =>
      ship.owner !== playerId &&
      ship.lifecycle === 'active' &&
      !queuedTargets.has(`ship:${ship.id}`) &&
      hexEqual(clickHex, ship.position),
  );
};

const getVisibleEnemyShipTargets = (
  state: GameState,
  playerId: PlayerId,
  attacker: Ship,
  map: SolarSystemMap,
  queuedTargets?: Set<string>,
): Ship[] => {
  return state.ships.filter(
    (ship) =>
      ship.owner !== playerId &&
      ship.lifecycle === 'active' &&
      ship.detected &&
      !queuedTargets?.has(`ship:${ship.id}`) &&
      hasLineOfSight(attacker, ship, map),
  );
};

const getVisibleEnemyOrdnanceTargets = (
  state: GameState,
  playerId: PlayerId,
  attacker: Ship,
  map: SolarSystemMap,
  queuedTargets?: Set<string>,
): Ordnance[] => {
  return state.ordnance.filter(
    (item) =>
      item.owner !== playerId &&
      item.lifecycle !== 'destroyed' &&
      item.type === 'nuke' &&
      !queuedTargets?.has(`ordnance:${item.id}`) &&
      hasLineOfSightToTarget(attacker, item, map),
  );
};

const getLegalAttackersForTarget = (
  availableAttackers: Ship[],
  target: CombatTarget,
  targetType: CombatTargetType,
  map: SolarSystemMap,
): Ship[] => {
  if (targetType === 'ship') {
    return availableAttackers.filter((attacker) =>
      hasLineOfSight(attacker, target as Ship, map),
    );
  }

  return availableAttackers.filter((attacker) =>
    hasLineOfSightToTarget(attacker, target as Ordnance, map),
  );
};

const getCycledSelection = <T extends { id: string }>(
  matches: T[],
  currentId?: string | null,
): T | null => {
  if (matches.length === 0) return null;

  if (matches.length === 1) return matches[0];

  if (!currentId) {
    return matches[0];
  }

  const currentIndex = matches.findIndex(
    (candidate) => candidate.id === currentId,
  );

  if (currentIndex < 0) {
    return matches[0];
  }

  return matches[(currentIndex + 1) % matches.length];
};

const getSelectedLegalAttackers = (
  legalAttackers: Ship[],
  selectedIds: string[],
): Ship[] => {
  return legalAttackers.filter((ship) => selectedIds.includes(ship.id));
};

const getNextSelectedAttackerIds = (
  legalAttackers: Ship[],
  selectedIds: string[],
  toggledShipId: string,
): string[] => {
  return selectedIds.includes(toggledShipId)
    ? selectedIds.filter((id) => id !== toggledShipId)
    : legalAttackers
        .filter(
          (ship) => selectedIds.includes(ship.id) || ship.id === toggledShipId,
        )
        .map((ship) => ship.id);
};

const resolveShipAttackers = (
  legalAttackers: Ship[],
  selectedIds: string[],
  selectedShipId?: string | null,
): Ship[] => {
  const selectedAttackers = getSelectedLegalAttackers(
    legalAttackers,
    selectedIds,
  );

  if (selectedAttackers.length > 0) {
    return selectedAttackers;
  }

  if (selectedShipId) {
    const selectedShipFallback = legalAttackers.filter(
      (ship) => ship.id === selectedShipId,
    );

    if (selectedShipFallback.length > 0) {
      return selectedShipFallback;
    }
  }

  return legalAttackers;
};

const resolveOrdnanceAttackers = (
  legalAttackers: Ship[],
  selectedIds: string[],
): Ship[] => {
  const selectedAttackers = getSelectedLegalAttackers(
    legalAttackers,
    selectedIds,
  );

  return selectedAttackers.length > 0 ? selectedAttackers : legalAttackers;
};

export const getReusableCombatGroup = (
  state: GameState,
  playerId: PlayerId,
  queuedAttacks: CombatAttack[],
  targetId: string,
): ReusableCombatGroup | null => {
  const target = getEnemyShipTarget(state, playerId, targetId);

  if (!target) return null;

  for (let index = queuedAttacks.length - 1; index >= 0; index--) {
    const queued = queuedAttacks[index];

    if (queued.targetType !== 'ship') continue;

    const queuedTarget = state.ships.find(
      (ship) => ship.id === queued.targetId && ship.lifecycle !== 'destroyed',
    );

    if (!queuedTarget || !hexEqual(queuedTarget.position, target.position)) {
      continue;
    }

    const groupKey = getGroupKey(queued.attackerIds);

    const attackers = getAttackersByIds(state, queued.attackerIds);

    const maxStrength = getCombatStrength(attackers);
    let allocatedStrength = 0;

    for (const attack of queuedAttacks) {
      if (attack.targetType !== 'ship') {
        continue;
      }

      if (getGroupKey(attack.attackerIds) !== groupKey) {
        continue;
      }

      const attackTarget = state.ships.find(
        (ship) => ship.id === attack.targetId && ship.lifecycle !== 'destroyed',
      );

      if (!attackTarget || !hexEqual(attackTarget.position, target.position)) {
        continue;
      }

      allocatedStrength += attack.attackStrength ?? maxStrength;
    }

    const remainingStrength = Math.max(0, maxStrength - allocatedStrength);

    if (remainingStrength > 0) {
      return {
        attackerIds: [...queued.attackerIds],
        remainingStrength,
      };
    }
  }

  return null;
};

export const hasSplitFireOptions = (
  state: GameState,
  playerId: PlayerId,
  queuedAttacks: CombatAttack[],
): boolean => {
  const queuedTargets = getTargetedKeys(queuedAttacks);

  for (const attack of queuedAttacks) {
    if (attack.targetType !== 'ship') continue;

    const target = getEnemyShipTarget(state, playerId, attack.targetId);

    if (!target) continue;

    const reusable = getReusableCombatGroup(
      state,
      playerId,
      queuedAttacks,
      target.id,
    );

    if (!reusable || reusable.remainingStrength <= 0) {
      continue;
    }

    const untargetedSameHex = state.ships.some(
      (ship) =>
        ship.owner !== playerId &&
        ship.lifecycle === 'active' &&
        hexEqual(ship.position, target.position) &&
        !queuedTargets.has(`ship:${ship.id}`),
    );

    if (untargetedSameHex) return true;
  }

  return false;
};

const clampAttackStrength = (
  maxStrength: number,
  requestedStrength: number | null,
): number | null => {
  if (maxStrength <= 0) return null;

  return clamp(requestedStrength ?? maxStrength, 1, maxStrength);
};

export const getCombatAttackerIdAtHex = (
  state: GameState,
  playerId: PlayerId,
  clickHex: HexCoord,
  selectedShipId?: string | null,
): string | null => {
  return (
    getCycledSelection(
      getFriendlyCombatShipsAtHex(state, playerId, clickHex),
      selectedShipId,
    )?.id ?? null
  );
};

export const getCombatTargetAtHex = (
  state: GameState,
  playerId: PlayerId,
  clickHex: HexCoord,
  queuedAttacks: CombatAttack[],
  currentTargetId?: string | null,
): CombatTargetSelection | null => {
  const ordnance = getEnemyOrdnanceTargetAtHex(state, playerId, clickHex);

  if (ordnance) {
    return {
      targetId: ordnance.id,
      targetType: 'ordnance',
    };
  }

  const queuedTargets = getTargetedKeys(queuedAttacks);
  const target = getCycledSelection(
    getUntargetedEnemyShipsAtHex(state, playerId, clickHex, queuedTargets),
    currentTargetId,
  );

  return target ? { targetId: target.id, targetType: 'ship' } : null;
};

export const getLegalCombatAttackers = (
  state: GameState,
  playerId: PlayerId,
  queuedAttacks: CombatAttack[],
  targetId: string,
  targetType: 'ship' | 'ordnance',
  map: SolarSystemMap | null,
) => {
  if (map === null) return [];

  const reusableGroup =
    targetType === 'ship'
      ? getReusableCombatGroup(state, playerId, queuedAttacks, targetId)
      : null;

  if (reusableGroup) {
    return getAttackersByIds(state, reusableGroup.attackerIds);
  }

  const committedAttackers = getCommittedAttackers(queuedAttacks);
  const availableAttackers = getAvailableCombatAttackers(
    state,
    playerId,
    committedAttackers,
  );

  const target = getEnemyCombatTarget(state, playerId, targetId, targetType);

  return target
    ? getLegalAttackersForTarget(availableAttackers, target, targetType, map)
    : [];
};

export const createCombatTargetPlan = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatPlanningSnapshot,
  targetId: string,
  targetType: 'ship' | 'ordnance',
  _map: SolarSystemMap | null,
): CombatTargetPlan => {
  const reusableGroup =
    targetType === 'ship'
      ? getReusableCombatGroup(
          state,
          playerId,
          planning.queuedAttacks,
          targetId,
        )
      : null;

  if (reusableGroup) {
    return {
      combatTargetId: targetId,
      combatTargetType: targetType,
      combatAttackerIds: [...reusableGroup.attackerIds],
      combatAttackStrength: reusableGroup.remainingStrength,
    };
  }

  return {
    combatTargetId: targetId,
    combatTargetType: targetType,
    combatAttackerIds: [],
    combatAttackStrength: null,
  };
};

// Find the nearest visible enemy (ship or nuke) that the given
// attacker can target, excluding already-queued targets.
export const findNearestTarget = (
  state: GameState,
  playerId: PlayerId,
  attackerShipId: string,
  queuedAttacks: CombatAttack[],
  map: SolarSystemMap | null,
): CombatTargetSelection | null => {
  if (!map) return null;

  const attacker = state.ships.find(
    (s) => s.id === attackerShipId && canAttack(s),
  );
  if (!attacker) return null;

  const queuedTargets = getTargetedKeys(queuedAttacks);
  // Also exclude targets already attacked this phase (tracked by the engine
  // during sequential single-combat resolution).
  for (const key of state.combatTargetedThisPhase ?? []) {
    queuedTargets.add(key);
  }
  const enemyShips = getVisibleEnemyShipTargets(
    state,
    playerId,
    attacker,
    map,
    queuedTargets,
  );
  const enemyNukes = getVisibleEnemyOrdnanceTargets(
    state,
    playerId,
    attacker,
    map,
    queuedTargets,
  );

  let best: CombatTargetSelection | null = null;
  let bestDist = Infinity;

  for (const ship of enemyShips) {
    const dist = hexDistance(attacker.position, ship.position);
    if (dist < bestDist) {
      bestDist = dist;
      best = { targetId: ship.id, targetType: 'ship' };
    }
  }

  for (const nuke of enemyNukes) {
    const dist = hexDistance(attacker.position, nuke.position);
    if (dist < bestDist) {
      bestDist = dist;
      best = { targetId: nuke.id, targetType: 'ordnance' };
    }
  }

  return best;
};

export const hasVisibleCombatTargets = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): boolean => {
  return getAvailableCombatAttackers(state, playerId, new Set()).some(
    (attacker) =>
      getVisibleEnemyShipTargets(state, playerId, attacker, map).length > 0 ||
      getVisibleEnemyOrdnanceTargets(state, playerId, attacker, map).length > 0,
  );
};

export const createClearedCombatPlan = (): CombatTargetPlan => {
  return {
    combatTargetId: null,
    combatTargetType: null,
    combatAttackerIds: [],
    combatAttackStrength: null,
  };
};

export const toggleCombatAttackerSelection = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatPlanningSnapshot,
  map: SolarSystemMap | null,
  shipId: string,
): CombatAttackerToggleResult | null => {
  const targetId = planning.combatTargetId;
  const targetType = planning.combatTargetType;

  if (!targetId || !targetType) return null;

  if (
    targetType === 'ship' &&
    getReusableCombatGroup(state, playerId, planning.queuedAttacks, targetId)
  ) {
    return null;
  }

  const legalAttackers = getLegalCombatAttackers(
    state,
    playerId,
    planning.queuedAttacks,
    targetId,
    targetType,
    map,
  );

  const legalIds = new Set(legalAttackers.map((ship) => ship.id));

  if (!legalIds.has(shipId)) return null;

  const selected = planning.combatAttackerIds.filter((id) => legalIds.has(id));
  const nextSelected = getNextSelectedAttackerIds(
    legalAttackers,
    selected,
    shipId,
  );

  if (nextSelected.length === 0) {
    return {
      consumed: true,
      combatAttackerIds: [...planning.combatAttackerIds],
      combatAttackStrength: planning.combatAttackStrength,
    };
  }

  return {
    consumed: true,
    combatAttackerIds: nextSelected,
    combatAttackStrength:
      targetType === 'ship'
        ? Math.min(
            Math.max(
              planning.combatAttackStrength ??
                getCombatStrength(legalAttackers),
              1,
            ),
            getCombatStrength(
              getSelectedLegalAttackers(legalAttackers, nextSelected),
            ),
          )
        : null,
  };
};

export const buildCurrentAttack = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatPlanningSnapshot,
  map: SolarSystemMap,
  selectedShipId?: string | null,
): CombatAttack | null => {
  const targetId = planning.combatTargetId;
  const targetType = planning.combatTargetType ?? 'ship';

  if (!targetId) return null;

  if (targetType === 'ordnance') {
    const legalAttackers = getLegalCombatAttackers(
      state,
      playerId,
      planning.queuedAttacks,
      targetId,
      targetType,
      map,
    );

    const attackers = resolveOrdnanceAttackers(
      legalAttackers,
      planning.combatAttackerIds,
    );
    const attackerIds = attackers.map((ship) => ship.id);

    return attackerIds.length > 0
      ? {
          attackerIds,
          targetId,
          targetType,
          attackStrength: null,
        }
      : null;
  }

  const reusableGroup = getReusableCombatGroup(
    state,
    playerId,
    planning.queuedAttacks,
    targetId,
  );

  if (reusableGroup) {
    const attackStrength = clampAttackStrength(
      reusableGroup.remainingStrength,
      planning.combatAttackStrength ?? null,
    );

    return attackStrength
      ? {
          attackerIds: [...reusableGroup.attackerIds],
          targetId,
          targetType,
          attackStrength,
        }
      : null;
  }

  const legalAttackers = getLegalCombatAttackers(
    state,
    playerId,
    planning.queuedAttacks,
    targetId,
    targetType,
    map,
  );

  // When no explicit attacker selection, use the currently selected ship
  // rather than drafting every legal attacker (which would auto-fire
  // immediately, preventing multi-ship attack queuing).
  const attackers = resolveShipAttackers(
    legalAttackers,
    planning.combatAttackerIds,
    selectedShipId,
  );

  const attackStrength = clampAttackStrength(
    getCombatStrength(attackers),
    planning.combatAttackStrength ?? null,
  );

  return attackers.length > 0 && attackStrength
    ? {
        attackerIds: attackers.map((ship) => ship.id),
        targetId,
        targetType,
        attackStrength,
      }
    : null;
};

export const countRemainingCombatAttackers = (
  state: GameState,
  playerId: PlayerId,
  queuedAttacks: CombatAttack[],
): number => {
  return getAvailableCombatAttackers(
    state,
    playerId,
    getCommittedAttackers(queuedAttacks),
  ).length;
};

export const getAttackStrengthForSelection = (
  state: GameState,
  attackerIds: string[],
): number => {
  return getCombatStrength(
    state.ships.filter((ship) => attackerIds.includes(ship.id)),
  );
};
