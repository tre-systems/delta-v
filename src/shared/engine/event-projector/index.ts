import type { SolarSystemMap } from '../../types';
import type { GameState, Result } from '../../types/domain';
import type { EventEnvelope } from '../engine-events';
import { projectConflictEvent } from './conflict';
import { projectLifecycleEvent } from './lifecycle';
import { projectShipEvent } from './ships';
import { migrateGameState } from './support';

const projectEvent = (
  state: GameState | null,
  envelope: EventEnvelope,
  map: SolarSystemMap,
): Result<GameState> => {
  const event = envelope.event;

  switch (event.type) {
    case 'gameCreated':
    case 'fleetPurchased':
    case 'astrogationOrdersCommitted':
    case 'ordnanceLaunchesCommitted':
    case 'logisticsTransfersCommitted':
    case 'surrenderDeclared':
    case 'fugitiveDesignated':
    case 'phaseChanged':
    case 'turnAdvanced':
    case 'identityRevealed':
    case 'checkpointVisited':
    case 'gameOver':
      return projectLifecycleEvent(state, event, envelope.gameId, map);

    case 'shipMoved':
    case 'shipLanded':
    case 'shipCrashed':
    case 'shipDestroyed':
    case 'shipCaptured':
    case 'asteroidDestroyed':
    case 'baseDestroyed':
    case 'shipResupplied':
    case 'fuelTransferred':
    case 'cargoTransferred':
    case 'passengersTransferred':
    case 'shipSurrendered':
    case 'baseEmplaced':
      return projectShipEvent(state, event);

    case 'ordnanceLaunched':
    case 'ordnanceMoved':
    case 'ordnanceExpired':
    case 'ordnanceDetonated':
    case 'ramming':
    case 'ordnanceDestroyed':
    case 'combatAttack':
      return projectConflictEvent(state, event);

    default: {
      const unreachable: never = event;
      return {
        ok: false,
        error: `unsupported setup event: ${String(unreachable)}`,
      };
    }
  }
};

export const projectGameStateFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
  initialState: GameState | null = null,
): Result<GameState> => {
  let state = initialState
    ? migrateGameState(structuredClone(initialState))
    : null;

  for (const envelope of events) {
    const projected = projectEvent(state, envelope, map);

    if (!projected.ok) {
      return projected;
    }

    state = projected.value;
  }

  return state === null
    ? {
        ok: false,
        error: 'empty event stream',
      }
    : {
        ok: true,
        value: state,
      };
};

export const projectMatchSetupFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
): Result<GameState> => projectGameStateFromStream(events, map);
