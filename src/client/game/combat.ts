import {
  canAttack,
  computeOdds,
  computeRangeModToTarget,
  computeVelocityModToTarget,
  getCombatStrength,
  hasLineOfSight,
  hasLineOfSightToTarget,
  lookupGunCombat,
} from '../../shared/combat';
import { ANTI_NUKE_ODDS } from '../../shared/constants';
import { type HexCoord, hexDistance, hexEqual } from '../../shared/hex';
import { asShipId, type OrdnanceId, type ShipId } from '../../shared/ids';
import type {
  CombatAttack,
  GameState,
  Ordnance,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { clamp, filterMap } from '../../shared/util';
import type { CombatPlanningSnapshot, CombatPlanningView } from './planning';

export interface ReusableCombatGroup {
  attackerIds: string[];
  remainingStrength: number;
}

export interface CombatTargetSelection {
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
}

type CombatTargetType = CombatTargetSelection['targetType'];
type CombatTarget = Ship | Ordnance;
type CombatTargetFilter<T extends CombatTarget> = (target: T) => boolean;
type CombatTargetByType<T extends CombatTargetType> = T extends 'ship'
  ? Ship
  : Ordnance;

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

const isEnemyShipTarget = (ship: Ship, playerId: PlayerId) => {
  return (
    ship.lifecycle === 'active' && ship.owner !== playerId && ship.detected
  );
};

const isEnemyOrdnanceTarget = (item: Ordnance, playerId: PlayerId) => {
  return (
    item.owner !== playerId &&
    item.lifecycle !== 'destroyed' &&
    item.type === 'nuke'
  );
};

const findTargets = <T extends CombatTargetType>(
  state: GameState,
  playerId: PlayerId,
  targetType: T,
  filter?: CombatTargetFilter<CombatTargetByType<T>>,
): CombatTargetByType<T>[] => {
  if (targetType === 'ship') {
    const targets = state.ships.filter((ship) =>
      isEnemyShipTarget(ship, playerId),
    );

    return (
      filter
        ? targets.filter((ship) => (filter as CombatTargetFilter<Ship>)(ship))
        : targets
    ) as CombatTargetByType<T>[];
  }

  const targets = state.ordnance.filter((item) =>
    isEnemyOrdnanceTarget(item, playerId),
  );

  return (
    filter
      ? targets.filter((item) => (filter as CombatTargetFilter<Ordnance>)(item))
      : targets
  ) as CombatTargetByType<T>[];
};

const findTarget = <T extends CombatTargetType>(
  state: GameState,
  playerId: PlayerId,
  targetType: T,
  filter?: CombatTargetFilter<CombatTargetByType<T>>,
): CombatTargetByType<T> | null => {
  return findTargets(state, playerId, targetType, filter)[0] ?? null;
};

const getEnemyCombatTarget = (
  state: GameState,
  playerId: PlayerId,
  targetId: string,
  targetType: CombatTargetType,
): CombatTarget | null => {
  return targetType === 'ship'
    ? findTarget(state, playerId, 'ship', (ship) => ship.id === targetId)
    : findTarget(state, playerId, 'ordnance', (item) => item.id === targetId);
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

const getVisibleTargets = (
  state: GameState,
  playerId: PlayerId,
  attacker: Ship,
  map: SolarSystemMap,
  targetType: CombatTargetType,
  queuedTargets?: Set<string>,
): CombatTarget[] => {
  return findTargets(
    state,
    playerId,
    targetType,
    (target) =>
      !queuedTargets?.has(`${targetType}:${target.id}`) &&
      (targetType === 'ship'
        ? hasLineOfSight(attacker, target as Ship, map)
        : hasLineOfSightToTarget(attacker, target as Ordnance, map)),
  );
};

/**
 * Enemy ships and nukes that at least one of the player's available attackers
 * can currently acquire, excluding targets already queued or resolved this phase.
 * Sorted for stable keyboard cycling: ships first, then ordnance, by id.
 */
export const listCycleableCombatTargets = (
  state: GameState,
  playerId: PlayerId,
  queuedAttacks: CombatAttack[],
  map: SolarSystemMap,
): CombatTargetSelection[] => {
  const committedAttackers = getCommittedAttackers(queuedAttacks);
  const availableAttackers = getAvailableCombatAttackers(
    state,
    playerId,
    committedAttackers,
  ).sort((left, right) => left.id.localeCompare(right.id));

  const excludedKeys = getTargetedKeys(queuedAttacks);
  for (const key of state.combatTargetedThisPhase ?? []) {
    excludedKeys.add(key);
  }

  const byKey = new Map<string, CombatTargetSelection>();

  for (const attacker of availableAttackers) {
    for (const targetType of ['ship', 'ordnance'] as const) {
      for (const target of getVisibleTargets(
        state,
        playerId,
        attacker,
        map,
        targetType,
        excludedKeys,
      )) {
        const key = `${targetType}:${target.id}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            targetId: target.id as ShipId | OrdnanceId,
            targetType,
          });
        }
      }
    }
  }

  const ordered = [...byKey.values()];
  ordered.sort((left, right) => {
    if (left.targetType !== right.targetType) {
      return left.targetType === 'ship' ? -1 : 1;
    }
    return left.targetId.localeCompare(right.targetId);
  });

  return ordered;
};

export const cycleCombatTargetPlan = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatPlanningSnapshot,
  map: SolarSystemMap,
  direction: -1 | 1,
): CombatTargetPlan | null => {
  const targets = listCycleableCombatTargets(
    state,
    playerId,
    planning.queuedAttacks,
    map,
  );

  if (targets.length === 0) {
    return null;
  }

  const idx = targets.findIndex(
    (candidate) =>
      candidate.targetId === planning.combatTargetId &&
      candidate.targetType === planning.combatTargetType,
  );

  if (idx < 0) {
    const pick = direction > 0 ? targets[0] : targets[targets.length - 1];
    if (!pick) {
      return null;
    }
    return createCombatTargetPlan(
      state,
      playerId,
      planning,
      pick.targetId,
      pick.targetType,
      map,
    );
  }

  const nextIdx = (idx + direction + targets.length) % targets.length;
  const pick = targets[nextIdx];
  if (!pick) {
    return null;
  }
  return createCombatTargetPlan(
    state,
    playerId,
    planning,
    pick.targetId,
    pick.targetType,
    map,
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
  return getDirectedCycledSelection(matches, currentId, 1);
};

const getDirectedCycledSelection = <T extends { id: string }>(
  matches: T[],
  currentId: string | null | undefined,
  direction: -1 | 1,
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

  return matches[(currentIndex + direction + matches.length) % matches.length];
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
  const target = findTarget(
    state,
    playerId,
    'ship',
    (ship) => ship.id === targetId,
  );

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

    const target = findTarget(
      state,
      playerId,
      'ship',
      (ship) => ship.id === attack.targetId,
    );

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
        isEnemyShipTarget(ship, playerId) &&
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
): ShipId | null => {
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
  map: SolarSystemMap | null,
  queuedAttacks: CombatAttack[],
  currentTargetId?: string | null,
): CombatTargetSelection | null => {
  if (map === null) {
    return null;
  }

  const committedAttackers = getCommittedAttackers(queuedAttacks);
  const availableAttackers = getAvailableCombatAttackers(
    state,
    playerId,
    committedAttackers,
  );

  if (availableAttackers.length === 0) {
    return null;
  }

  const ordnance = findTarget(
    state,
    playerId,
    'ordnance',
    (item) =>
      hexEqual(clickHex, item.position) &&
      availableAttackers.some((attacker) =>
        hasLineOfSightToTarget(attacker, item, map),
      ),
  );

  if (ordnance) {
    return {
      targetId: ordnance.id,
      targetType: 'ordnance',
    };
  }

  const queuedTargets = getTargetedKeys(queuedAttacks);
  const target = getCycledSelection(
    findTargets(
      state,
      playerId,
      'ship',
      (ship) =>
        !queuedTargets.has(`ship:${ship.id}`) &&
        hexEqual(clickHex, ship.position) &&
        availableAttackers.some((attacker) =>
          hasLineOfSight(attacker, ship, map),
        ),
    ),
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
  map: SolarSystemMap | null,
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

  const legalAttackers = getLegalCombatAttackers(
    state,
    playerId,
    planning.queuedAttacks,
    targetId,
    targetType,
    map,
  );
  const defaultAttacker =
    (planning.selectedShipId
      ? legalAttackers.find((ship) => ship.id === planning.selectedShipId)
      : null) ??
    legalAttackers[0] ??
    null;

  return {
    combatTargetId: targetId,
    combatTargetType: targetType,
    combatAttackerIds: defaultAttacker ? [defaultAttacker.id] : [],
    combatAttackStrength:
      targetType === 'ship' && defaultAttacker
        ? getCombatStrength([defaultAttacker])
        : null,
  };
};

export const cycleCombatAttackerPlan = (
  state: GameState,
  playerId: PlayerId,
  planning: CombatPlanningSnapshot,
  map: SolarSystemMap | null,
  direction: -1 | 1,
): {
  plan: CombatTargetPlan;
  selectedShipId: ShipId;
  selectedHex: HexCoord;
} | null => {
  if (planning.combatTargetId === null || planning.combatTargetType === null) {
    return null;
  }

  const legalAttackers = getLegalCombatAttackers(
    state,
    playerId,
    planning.queuedAttacks,
    planning.combatTargetId,
    planning.combatTargetType,
    map,
  );

  const nextAttacker = getDirectedCycledSelection(
    legalAttackers,
    planning.selectedShipId,
    direction,
  );

  if (!nextAttacker) {
    return null;
  }

  return {
    plan: {
      combatTargetId: planning.combatTargetId,
      combatTargetType: planning.combatTargetType,
      combatAttackerIds: [nextAttacker.id],
      combatAttackStrength:
        planning.combatTargetType === 'ship'
          ? getCombatStrength([nextAttacker])
          : null,
    },
    selectedShipId: nextAttacker.id,
    selectedHex: nextAttacker.position,
  };
};

const getDamageChance = (
  odds: ReturnType<typeof computeOdds>,
  totalMod: number,
) => {
  let damagingRolls = 0;

  for (let dieRoll = 1; dieRoll <= 6; dieRoll++) {
    if (lookupGunCombat(odds, dieRoll - totalMod).type !== 'none') {
      damagingRolls += 1;
    }
  }

  return damagingRolls / 6;
};

type ScoredCombatTarget = CombatTargetSelection & {
  chance: number;
  totalMod: number;
  distance: number;
};

const compareTargets = (
  left: ScoredCombatTarget,
  right: ScoredCombatTarget,
): number => {
  if (left.chance !== right.chance) {
    return right.chance - left.chance;
  }

  if (left.totalMod !== right.totalMod) {
    return left.totalMod - right.totalMod;
  }

  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }

  if (left.targetType !== right.targetType) {
    return left.targetType === 'ship' ? -1 : 1;
  }

  return 0;
};

const scoreShipTarget = (attacker: Ship, target: Ship): ScoredCombatTarget => {
  const rangeMod = computeRangeModToTarget(attacker, target);
  const velocityMod = computeVelocityModToTarget(attacker, target);
  const totalMod = rangeMod + velocityMod;
  const odds = computeOdds(
    getCombatStrength([attacker]),
    getCombatStrength([target]),
  );

  return {
    targetId: target.id,
    targetType: 'ship',
    chance: getDamageChance(odds, totalMod),
    totalMod,
    distance: hexDistance(attacker.position, target.position),
  };
};

const scoreOrdnanceTarget = (
  attacker: Ship,
  target: Ordnance,
): ScoredCombatTarget => {
  const rangeMod = computeRangeModToTarget(attacker, target);
  const velocityMod = computeVelocityModToTarget(attacker, target);
  const totalMod = rangeMod + velocityMod;

  return {
    targetId: target.id,
    targetType: 'ordnance',
    chance: getDamageChance(ANTI_NUKE_ODDS, totalMod),
    totalMod,
    distance: hexDistance(attacker.position, target.position),
  };
};

// Find the best visible enemy (ship or nuke) that the given
// attacker can target, excluding already-queued targets.
export const findPreferredTarget = (
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
  const enemyShips = findTargets(state, playerId, 'ship', (ship) => {
    return (
      !queuedTargets.has(`ship:${ship.id}`) &&
      hasLineOfSight(attacker, ship, map)
    );
  });
  const enemyNukes = findTargets(state, playerId, 'ordnance', (item) => {
    return (
      !queuedTargets.has(`ordnance:${item.id}`) &&
      hasLineOfSightToTarget(attacker, item, map)
    );
  });

  let best: ScoredCombatTarget | null = null;

  for (const ship of enemyShips) {
    const scored = scoreShipTarget(attacker, ship);

    if (best === null || compareTargets(scored, best) < 0) {
      best = scored;
    }
  }

  for (const nuke of enemyNukes) {
    const scored = scoreOrdnanceTarget(attacker, nuke);

    if (best === null || compareTargets(scored, best) < 0) {
      best = scored;
    }
  }

  return best
    ? {
        targetId: best.targetId,
        targetType: best.targetType,
      }
    : null;
};

export const hasVisibleCombatTargets = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): boolean => {
  return getAvailableCombatAttackers(state, playerId, new Set()).some(
    (attacker) =>
      getVisibleTargets(state, playerId, attacker, map, 'ship').length > 0 ||
      getVisibleTargets(state, playerId, attacker, map, 'ordnance').length > 0,
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
  planning: CombatPlanningView,
  map: SolarSystemMap | null,
  shipId: ShipId,
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

  const selected = planning.combatAttackerIds.filter((id) =>
    legalIds.has(id as ShipId),
  );
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
  planning: CombatPlanningView,
  map: SolarSystemMap,
  selectedShipId?: string | null,
): CombatAttack | null => {
  const rawTargetId = planning.combatTargetId;
  const targetType = planning.combatTargetType ?? 'ship';

  if (!rawTargetId) return null;

  // Cast from planning string to branded ID for CombatAttack
  const targetId = rawTargetId as ShipId | OrdnanceId;

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
          attackerIds: reusableGroup.attackerIds.map(asShipId),
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
