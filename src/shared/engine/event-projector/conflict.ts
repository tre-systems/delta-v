import { DAMAGE_ELIMINATION_THRESHOLD, ORDNANCE_MASS } from '../../constants';
import type { ShipId } from '../../ids';
import type { GameState, Result } from '../../types/domain';
import type { ConflictProjectionEvent } from './support';
import {
  cloneGravityEffects,
  requireOrdnance,
  requireShip,
  requireState,
} from './support';

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
      const targetKey = `${event.targetType}:${event.targetId}`;

      if (event.attackType !== 'baseDefense') {
        for (const attackerId of event.attackerIds) {
          const projectedAttacker = requireShip(state, attackerId);

          if (!projectedAttacker.ok) {
            return projectedAttacker;
          }

          if (projectedAttacker.value.owner === state.activePlayer) {
            projectedAttacker.value.firedThisPhase = true;
          }
        }
      }

      state.combatTargetedThisPhase = [
        ...(state.combatTargetedThisPhase ?? []),
        targetKey,
      ];

      if (event.targetType === 'ordnance' || event.damageType === 'none') {
        return {
          ok: true,
          value: state,
        };
      }

      // After the ordnance guard above, targetId is a ShipId
      const projectedShip = requireShip(state, event.targetId as ShipId);

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
