import {
  canAttack,
  getCombatStrength,
  hasLineOfSight,
  hasLineOfSightToTarget,
} from '../../shared/combat';
import { type HexCoord, hexEqual } from '../../shared/hex';
import type {
  CombatAttack,
  GameState,
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
    queuedAttacks.map(
      (attack) => `${attack.targetType ?? 'ship'}:${attack.targetId}`,
    ),
  );
};

export const getReusableCombatGroup = (
  state: GameState,
  playerId: number,
  queuedAttacks: CombatAttack[],
  targetId: string,
): ReusableCombatGroup | null => {
  const target = state.ships.find(
    (ship) =>
      ship.id === targetId &&
      ship.lifecycle !== 'destroyed' &&
      ship.owner !== playerId,
  );

  if (!target) return null;

  for (let index = queuedAttacks.length - 1; index >= 0; index--) {
    const queued = queuedAttacks[index];

    if ((queued.targetType ?? 'ship') !== 'ship') continue;

    const queuedTarget = state.ships.find(
      (ship) => ship.id === queued.targetId && ship.lifecycle !== 'destroyed',
    );

    if (!queuedTarget || !hexEqual(queuedTarget.position, target.position)) {
      continue;
    }

    const groupKey = getGroupKey(queued.attackerIds);

    const attackers = state.ships.filter((ship) =>
      queued.attackerIds.includes(ship.id),
    );

    const maxStrength = getCombatStrength(attackers);
    let allocatedStrength = 0;

    for (const attack of queuedAttacks) {
      if ((attack.targetType ?? 'ship') !== 'ship') {
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
  playerId: number,
  queuedAttacks: CombatAttack[],
): boolean => {
  const queuedTargets = getTargetedKeys(queuedAttacks);

  for (const attack of queuedAttacks) {
    if ((attack.targetType ?? 'ship') !== 'ship') continue;

    const target = state.ships.find(
      (ship) => ship.id === attack.targetId && ship.lifecycle !== 'destroyed',
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
  playerId: number,
  clickHex: HexCoord,
  selectedShipId?: string | null,
): string | null => {
  const matches = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      canAttack(ship) &&
      hexEqual(clickHex, ship.position),
  );

  if (matches.length === 0) return null;

  if (matches.length === 1) return matches[0].id;

  // Cycle: if selected ship is at this hex, pick the next one
  if (selectedShipId) {
    const currentIdx = matches.findIndex((s) => s.id === selectedShipId);

    if (currentIdx >= 0) {
      return matches[(currentIdx + 1) % matches.length].id;
    }
  }

  return matches[0].id;
};

export const getCombatTargetAtHex = (
  state: GameState,
  playerId: number,
  clickHex: HexCoord,
  queuedAttacks: CombatAttack[],
  currentTargetId?: string | null,
): CombatTargetSelection | null => {
  const ordnance = state.ordnance.find(
    (item) =>
      item.owner !== playerId &&
      item.lifecycle !== 'destroyed' &&
      item.type === 'nuke' &&
      hexEqual(clickHex, item.position),
  );

  if (ordnance) {
    return {
      targetId: ordnance.id,
      targetType: 'ordnance',
    };
  }

  const queuedTargets = getTargetedKeys(queuedAttacks);

  const matches = state.ships.filter(
    (item) =>
      item.owner !== playerId &&
      item.lifecycle === 'active' &&
      !queuedTargets.has(`ship:${item.id}`) &&
      hexEqual(clickHex, item.position),
  );

  if (matches.length === 0) return null;

  if (matches.length === 1) {
    return { targetId: matches[0].id, targetType: 'ship' };
  }

  // Cycle through stacked targets
  if (currentTargetId) {
    const idx = matches.findIndex((s) => s.id === currentTargetId);

    if (idx >= 0) {
      const next = matches[(idx + 1) % matches.length];
      return { targetId: next.id, targetType: 'ship' };
    }
  }

  return { targetId: matches[0].id, targetType: 'ship' };
};

export const getLegalCombatAttackers = (
  state: GameState,
  playerId: number,
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
    return filterMap(reusableGroup.attackerIds, (id) => {
      const ship = state.ships.find((s) => s.id === id);

      return ship && ship.lifecycle !== 'destroyed' && canAttack(ship)
        ? ship
        : null;
    });
  }

  const committedAttackers = getCommittedAttackers(queuedAttacks);

  const myAttackers = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      canAttack(ship) &&
      !committedAttackers.has(ship.id),
  );

  if (targetType === 'ordnance') {
    const target = state.ordnance.find(
      (item) =>
        item.id === targetId &&
        item.lifecycle !== 'destroyed' &&
        item.owner !== playerId &&
        item.type === 'nuke',
    );

    return target
      ? myAttackers.filter((attacker) =>
          hasLineOfSightToTarget(attacker, target, map),
        )
      : [];
  }

  const target = state.ships.find(
    (ship) =>
      ship.id === targetId &&
      ship.lifecycle !== 'destroyed' &&
      ship.owner !== playerId,
  );

  return target
    ? myAttackers.filter((attacker) => hasLineOfSight(attacker, target, map))
    : [];
};

export const createCombatTargetPlan = (
  state: GameState,
  playerId: number,
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
  playerId: number,
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

  const nextSelected = selected.includes(shipId)
    ? selected.filter((id) => id !== shipId)
    : legalAttackers
        .filter((ship) => selected.includes(ship.id) || ship.id === shipId)
        .map((ship) => ship.id);

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
              legalAttackers.filter((ship) => nextSelected.includes(ship.id)),
            ),
          )
        : null,
  };
};

export const buildCurrentAttack = (
  state: GameState,
  playerId: number,
  planning: CombatPlanningSnapshot,
  map: SolarSystemMap,
): CombatAttack | null => {
  const targetId = planning.combatTargetId;
  const targetType = planning.combatTargetType ?? 'ship';

  if (!targetId) return null;

  const committedAttackers = getCommittedAttackers(planning.queuedAttacks);

  if (targetType === 'ordnance') {
    const target = state.ordnance.find(
      (ordnance) =>
        ordnance.id === targetId &&
        ordnance.lifecycle !== 'destroyed' &&
        ordnance.owner !== playerId &&
        ordnance.type === 'nuke',
    );

    if (!target) return null;

    const legalAttackers = state.ships
      .filter(
        (ship) =>
          ship.owner === playerId &&
          ship.lifecycle !== 'destroyed' &&
          canAttack(ship) &&
          !committedAttackers.has(ship.id),
      )
      .filter((ship) => hasLineOfSightToTarget(ship, target, map));

    const selectedAttackers = legalAttackers.filter((ship) =>
      planning.combatAttackerIds.includes(ship.id),
    );

    // Anti-nuke interception auto-drafts all legal ships
    const attackers =
      selectedAttackers.length > 0 ? selectedAttackers : legalAttackers;
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

  const target = state.ships.find(
    (ship) => ship.id === targetId && ship.lifecycle !== 'destroyed',
  );

  if (!target) return null;

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

  const legalAttackers = state.ships
    .filter(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        canAttack(ship) &&
        !committedAttackers.has(ship.id),
    )
    .filter((ship) => hasLineOfSight(ship, target, map));

  const selectedAttackers = legalAttackers.filter((ship) =>
    planning.combatAttackerIds.includes(ship.id),
  );

  const attackers =
    selectedAttackers.length > 0 ? selectedAttackers : legalAttackers;

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
  playerId: number,
  queuedAttacks: CombatAttack[],
): number => {
  const committedAttackers = getCommittedAttackers(queuedAttacks);

  return state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      ship.lifecycle !== 'destroyed' &&
      canAttack(ship) &&
      !committedAttackers.has(ship.id),
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
