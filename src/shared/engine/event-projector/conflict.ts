import {
  DAMAGE_ELIMINATION_THRESHOLD,
  ORDNANCE_MASS,
  SHIP_STATS,
} from '../../constants';
import { hexKey } from '../../hex';
import type { ShipId } from '../../ids';
import { combatTargetKey } from '../../ids';
import type { GameState, Result } from '../../types/domain';
import { isShipTargetCombatAttackEvent } from '../engine-events';
import type { ConflictProjectionEvent } from './support';
import {
  cloneGravityEffects,
  requireOrdnance,
  requireShip,
  requireState,
} from './support';

const getAttackGroupKey = (attackerIds: readonly string[]): string =>
  [...attackerIds].sort().join('|');

const getCombatEventAttackStrength = (
  state: GameState,
  attackerIds: readonly ShipId[],
): number =>
  attackerIds.reduce((total, attackerId) => {
    const ship = state.ships.find((candidate) => candidate.id === attackerId);

    return total + (ship ? (SHIP_STATS[ship.type]?.combat ?? 0) : 0);
  }, 0);

const areCombatEventAttackersInSameHex = (
  state: GameState,
  attackerIds: readonly ShipId[],
): boolean => {
  if (attackerIds.length <= 1) return true;

  const ships = attackerIds
    .map((attackerId) =>
      state.ships.find((candidate) => candidate.id === attackerId),
    )
    .filter((ship) => ship != null);

  if (ships.length !== attackerIds.length) return false;

  const first = ships[0];
  if (!first) return false;

  const firstHex = hexKey(first.position);

  return ships.every((ship) => hexKey(ship.position) === firstHex);
};

export const projectConflictEvent = (
  state: GameState | null,
  event: ConflictProjectionEvent,
): Result<GameState> => {
  switch (event.type) {
    case 'ordnanceLaunched': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const sourceShip = requireShip(state, event.sourceShipId);

      if (!sourceShip.ok) {
        return sourceShip;
      }

      sourceShip.value.cargoUsed += ORDNANCE_MASS[event.ordnanceType];

      if (event.ordnanceType === 'nuke') {
        sourceShip.value.nukesLaunchedSinceResupply += 1;
      }

      state.ordnance.push({
        id: event.ordnanceId,
        type: event.ordnanceType,
        owner: event.owner,
        sourceShipId: event.sourceShipId,
        position: { ...event.position },
        velocity: { ...event.velocity },
        turnsRemaining: event.turnsRemaining,
        lifecycle: 'active',
        pendingGravityEffects: cloneGravityEffects(event.pendingGravityEffects),
      });

      return {
        ok: true,
        value: state,
      };
    }

    case 'ordnanceMoved': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      state.pendingAstrogationOrders = null;
      const projectedOrdnance = requireOrdnance(state, event.ordnanceId);

      if (!projectedOrdnance.ok) {
        return projectedOrdnance;
      }

      projectedOrdnance.value.position = { ...event.position };
      projectedOrdnance.value.velocity = { ...event.velocity };
      projectedOrdnance.value.turnsRemaining = event.turnsRemaining;
      projectedOrdnance.value.pendingGravityEffects = cloneGravityEffects(
        event.pendingGravityEffects,
      );

      return {
        ok: true,
        value: state,
      };
    }

    case 'ordnanceExpired':
    case 'ordnanceDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const ordnance = requireOrdnance(state, event.ordnanceId);

      if (!ordnance.ok) {
        return ordnance;
      }

      ordnance.value.lifecycle = 'destroyed';
      state.ordnance = state.ordnance.filter(
        (item) => item.lifecycle !== 'destroyed',
      );

      return {
        ok: true,
        value: state,
      };
    }

    case 'ordnanceDetonated': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

      if (!event.targetShipId || event.damageType === 'none') {
        return {
          ok: true,
          value: state,
        };
      }

      const projectedShip = requireShip(state, event.targetShipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (event.damageType === 'disabled') {
        projectedShip.value.damage.disabledTurns += event.disabledTurns;
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'ramming': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

      if (event.damageType === 'none' || event.damageType === 'eliminated') {
        return {
          ok: true,
          value: state,
        };
      }

      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.damage.disabledTurns += event.disabledTurns;

      return {
        ok: true,
        value: state,
      };
    }

    case 'combatAttack': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const targetKey = combatTargetKey(event.targetType, event.targetId);

      if (event.attackType !== 'baseDefense') {
        const activeAttackerIds: ShipId[] = [];

        for (const attackerId of event.attackerIds) {
          const projectedAttacker = requireShip(state, attackerId);

          if (!projectedAttacker.ok) {
            return projectedAttacker;
          }

          if (projectedAttacker.value.owner === state.activePlayer) {
            activeAttackerIds.push(attackerId);
          }
        }

        if (activeAttackerIds.length > 0) {
          const groupKey = getAttackGroupKey(activeAttackerIds);
          const existingGroup = (state.combatAttackGroupsThisPhase ?? []).find(
            (group) => getAttackGroupKey(group.attackerIds) === groupKey,
          );
          const maxStrength =
            existingGroup?.maxStrength ??
            getCombatEventAttackStrength(state, activeAttackerIds);
          const allocatedStrength = event.attackStrength ?? maxStrength;
          const nextAllocated =
            (existingGroup?.allocatedStrength ?? 0) + allocatedStrength;
          let groupStillActive = false;

          if (
            event.targetType === 'ship' &&
            areCombatEventAttackersInSameHex(state, activeAttackerIds)
          ) {
            const target = state.ships.find(
              (ship) => ship.id === event.targetId,
            );

            if (target && nextAllocated < maxStrength) {
              state.combatAttackGroupsThisPhase = [
                ...(state.combatAttackGroupsThisPhase ?? []).filter(
                  (group) => getAttackGroupKey(group.attackerIds) !== groupKey,
                ),
                {
                  attackerIds: activeAttackerIds,
                  targetHexKey: hexKey(target.position),
                  targetType: 'ship',
                  maxStrength,
                  allocatedStrength: nextAllocated,
                },
              ];
              groupStillActive = true;
            }
          }

          if (!groupStillActive) {
            state.combatAttackGroupsThisPhase = (
              state.combatAttackGroupsThisPhase ?? []
            ).filter(
              (group) => getAttackGroupKey(group.attackerIds) !== groupKey,
            );

            for (const attackerId of activeAttackerIds) {
              const projectedAttacker = requireShip(state, attackerId);

              if (!projectedAttacker.ok) {
                return projectedAttacker;
              }

              projectedAttacker.value.firedThisPhase = true;
            }
          }
        }
      }

      state.combatTargetedThisPhase = [
        ...(state.combatTargetedThisPhase ?? []),
        targetKey,
      ];

      if (
        !isShipTargetCombatAttackEvent(event) ||
        event.damageType === 'none'
      ) {
        return {
          ok: true,
          value: state,
        };
      }

      const projectedShip = requireShip(state, event.targetId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (event.damageType === 'eliminated') {
        projectedShip.value.lifecycle = 'destroyed';
        projectedShip.value.deathCause = event.attackType;
        projectedShip.value.killedBy = event.attackerIds[0] ?? null;
        projectedShip.value.velocity = { dq: 0, dr: 0 };

        return {
          ok: true,
          value: state,
        };
      }

      projectedShip.value.damage.disabledTurns += event.disabledTurns;
      if (
        projectedShip.value.damage.disabledTurns >= DAMAGE_ELIMINATION_THRESHOLD
      ) {
        projectedShip.value.lifecycle = 'destroyed';
        projectedShip.value.deathCause = event.attackType;
        projectedShip.value.killedBy = event.attackerIds[0] ?? null;
        projectedShip.value.velocity = { dq: 0, dr: 0 };
      }

      return {
        ok: true,
        value: state,
      };
    }

    default: {
      const unreachable: never = event;
      return {
        ok: false,
        error: `unsupported conflict event: ${String(unreachable)}`,
      };
    }
  }
};
