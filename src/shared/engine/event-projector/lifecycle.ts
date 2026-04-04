import type { GameId } from '../../ids';
import { findBaseHex } from '../../map-data';
import { mulberry32 } from '../../prng';
import type { SolarSystemMap } from '../../types';
import type { GameState, Result } from '../../types/domain';
import { processFleetReady } from '../fleet-building';
import { createGame } from '../game-creation';
import { applyTurnAdvanceMutations } from '../turn-advance';
import type { LifecycleProjectionEvent } from './support';
import {
  migrateGameState,
  requireShip,
  requireState,
  resolveScenarioByName,
} from './support';

export const projectLifecycleEvent = (
  state: GameState | null,
  event: LifecycleProjectionEvent,
  gameId: GameId,
  map: SolarSystemMap,
): Result<GameState> => {
  switch (event.type) {
    case 'gameCreated': {
      if (state !== null) {
        return {
          ok: false,
          error: 'duplicate gameCreated event',
        };
      }

      const scenario = resolveScenarioByName(event.scenario);

      if (!scenario) {
        return {
          ok: false,
          error: `unknown scenario: ${event.scenario}`,
        };
      }

      const result = createGame(
        scenario,
        map,
        gameId,
        findBaseHex,
        mulberry32(event.matchSeed),
      );

      if (!result.ok) {
        return { ok: false, error: result.error.message };
      }

      return {
        ok: true,
        value: migrateGameState(result.value),
      };
    }

    case 'fleetPurchased': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      const result = processFleetReady(
        baseState.value,
        event.playerId,
        event.purchases,
        map,
      );

      return 'error' in result
        ? { ok: false, error: result.error.message }
        : { ok: true, value: result.state };
    }

    case 'astrogationOrdersCommitted':
    case 'ordnanceLaunchesCommitted':
    case 'logisticsTransfersCommitted':
    case 'surrenderDeclared': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      if (event.type === 'astrogationOrdersCommitted') {
        baseState.value.pendingAstrogationOrders = event.orders.map(
          (order) => ({
            shipId: order.shipId,
            burn: order.burn,
            overload: order.overload ?? null,
            weakGravityChoices: order.weakGravityChoices
              ? { ...order.weakGravityChoices }
              : undefined,
          }),
        );
      }

      return baseState;
    }

    case 'fugitiveDesignated': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

      for (const ship of state.ships) {
        if (ship.owner === event.playerId && ship.identity) {
          ship.identity.hasFugitives = false;
          ship.identity.revealed = false;
        }
      }

      const fugitive = state.ships.find((ship) => ship.id === event.shipId);

      if (!fugitive?.identity) {
        return {
          ok: false,
          error: `fugitive ship not found: ${event.shipId}`,
        };
      }

      fugitive.identity.hasFugitives = true;

      return {
        ok: true,
        value: state,
      };
    }

    case 'phaseChanged': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      state.phase = event.phase;
      state.turnNumber = event.turn;
      state.activePlayer = event.activePlayer;

      return {
        ok: true,
        value: state,
      };
    }

    case 'turnAdvanced': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const previousActivePlayer = 1 - event.activePlayer;

      for (const ship of state.ships) {
        if (ship.owner !== previousActivePlayer) continue;
        if (ship.lifecycle === 'destroyed') continue;

        ship.resuppliedThisTurn = false;
        ship.firedThisPhase = undefined;

        if (ship.damage.disabledTurns > 0) {
          ship.damage.disabledTurns--;
        }
      }

      state.pendingAstrogationOrders = null;
      state.turnNumber = event.turn;
      state.activePlayer = event.activePlayer;

      // Apply scenario-rule mutations (reinforcements, fleet conversion)
      // that advanceTurn() performs in-memory but are not recorded as
      // separate events in the stream.
      applyTurnAdvanceMutations(state);

      return {
        ok: true,
        value: state,
      };
    }

    case 'identityRevealed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (projectedShip.value.identity) {
        projectedShip.value.identity.revealed = true;
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'checkpointVisited': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const visitedBodies = state.players[event.playerId]?.visitedBodies;

      if (visitedBodies && !visitedBodies.includes(event.body)) {
        visitedBodies.push(event.body);
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'gameOver': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      state.outcome =
        event.winner !== null
          ? { winner: event.winner, reason: event.reason }
          : null;
      state.phase = 'gameOver';

      return {
        ok: true,
        value: state,
      };
    }

    default: {
      const unreachable: never = event;
      return {
        ok: false,
        error: `unsupported lifecycle event: ${String(unreachable)}`,
      };
    }
  }
};
