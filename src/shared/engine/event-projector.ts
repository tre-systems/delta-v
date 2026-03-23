import { findBaseHex, SCENARIOS } from '../map-data';
import type { ScenarioDefinition, SolarSystemMap } from '../types';
import type { GameState } from '../types/domain';
import type { EngineEvent, EventEnvelope } from './engine-events';
import { processFleetReady } from './fleet-building';
import { createGame } from './game-creation';

const resolveScenarioByName = (
  scenarioName: string,
): ScenarioDefinition | null => {
  for (const scenario of Object.values(SCENARIOS)) {
    if (scenario.name === scenarioName) {
      return scenario;
    }
  }

  return null;
};

const projectSetupEvent = (
  state: GameState | null,
  envelope: EventEnvelope,
  map: SolarSystemMap,
):
  | {
      ok: true;
      state: GameState;
    }
  | {
      ok: false;
      error: string;
    } => {
  const { event, gameId } = envelope;

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

      return {
        ok: true,
        state: createGame(scenario, map, gameId, findBaseHex, () => 0),
      };
    }

    case 'fleetPurchased': {
      if (state === null) {
        return {
          ok: false,
          error: 'fleetPurchased before gameCreated',
        };
      }

      const scenario = resolveScenarioByName(state.scenario);

      if (!scenario) {
        return {
          ok: false,
          error: `unknown scenario: ${state.scenario}`,
        };
      }

      const result = processFleetReady(
        state,
        event.playerId,
        event.purchases,
        map,
        scenario.availableShipTypes,
      );

      return 'error' in result
        ? { ok: false, error: result.error }
        : { ok: true, state: result.state };
    }

    case 'fugitiveDesignated': {
      if (state === null) {
        return {
          ok: false,
          error: 'fugitiveDesignated before gameCreated',
        };
      }

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
        state,
      };
    }

    default:
      return {
        ok: false,
        error: `unsupported setup event: ${event.type satisfies EngineEvent['type']}`,
      };
  }
};

export const projectMatchSetupFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
):
  | {
      ok: true;
      state: GameState;
    }
  | {
      ok: false;
      error: string;
    } => {
  let state: GameState | null = null;

  for (const envelope of events) {
    const projected = projectSetupEvent(state, envelope, map);

    if (!projected.ok) {
      return projected;
    }

    state = projected.state;
  }

  return state === null
    ? {
        ok: false,
        error: 'empty event stream',
      }
    : {
        ok: true,
        state,
      };
};
