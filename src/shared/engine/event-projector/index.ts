import type { GameId } from '../../ids';
import type { SolarSystemMap } from '../../types';
import type { GameState, Result } from '../../types/domain';
import type { EngineEvent, EventEnvelope } from '../engine-events';
import { applyDetection } from '../post-movement';
import { projectConflictEvent } from './conflict';
import { projectLifecycleEvent } from './lifecycle';
import { projectShipEvent } from './ships';
import { migrateGameState } from './support';

type ProjectEventHandler<T extends EngineEvent = EngineEvent> = (
  state: GameState | null,
  event: T,
  gameId: GameId,
  map: SolarSystemMap,
) => Result<GameState>;

type ProjectEventRegistry = {
  [K in EngineEvent['type']]: ProjectEventHandler<
    Extract<EngineEvent, { type: K }>
  >;
};

type LifecycleEvent = Extract<
  EngineEvent,
  {
    type:
      | 'gameCreated'
      | 'fleetPurchased'
      | 'astrogationOrdersCommitted'
      | 'ordnanceLaunchesCommitted'
      | 'logisticsTransfersCommitted'
      | 'surrenderDeclared'
      | 'fugitiveDesignated'
      | 'phaseChanged'
      | 'turnAdvanced'
      | 'identityRevealed'
      | 'checkpointVisited'
      | 'gameOver';
  }
>;

type ShipEvent = Extract<
  EngineEvent,
  {
    type:
      | 'shipMoved'
      | 'shipLanded'
      | 'shipCrashed'
      | 'shipDestroyed'
      | 'shipCaptured'
      | 'asteroidDestroyed'
      | 'baseDestroyed'
      | 'shipResupplied'
      | 'fuelTransferred'
      | 'cargoTransferred'
      | 'passengersTransferred'
      | 'shipSurrendered'
      | 'baseEmplaced';
  }
>;

type ConflictEvent = Extract<
  EngineEvent,
  {
    type:
      | 'ordnanceLaunched'
      | 'ordnanceMoved'
      | 'ordnanceExpired'
      | 'ordnanceDetonated'
      | 'ramming'
      | 'ordnanceDestroyed'
      | 'combatAttack';
  }
>;

// `detected` is not stored on events; the live engine runs `applyDetection`
// only after movement resolution. Recompute on the same boundaries so
// multiplayer DO state matches broadcasts (avoid combat rejecting valid targets).
const DETECTION_RECOMPUTE_AFTER: ReadonlySet<EngineEvent['type']> = new Set([
  'shipMoved',
  'shipLanded',
  'shipCrashed',
]);

const projectLifecycle: ProjectEventHandler<LifecycleEvent> = (
  state,
  event,
  gameId,
  map,
) => {
  return projectLifecycleEvent(state, event, gameId, map);
};

const projectShip: ProjectEventHandler<ShipEvent> = (state, event) => {
  return projectShipEvent(state, event);
};

const projectConflict: ProjectEventHandler<ConflictEvent> = (state, event) => {
  return projectConflictEvent(state, event);
};

const PROJECT_EVENT_HANDLERS = {
  gameCreated: projectLifecycle,
  fleetPurchased: projectLifecycle,
  astrogationOrdersCommitted: projectLifecycle,
  ordnanceLaunchesCommitted: projectLifecycle,
  logisticsTransfersCommitted: projectLifecycle,
  surrenderDeclared: projectLifecycle,
  fugitiveDesignated: projectLifecycle,
  phaseChanged: projectLifecycle,
  turnAdvanced: projectLifecycle,
  identityRevealed: projectLifecycle,
  checkpointVisited: projectLifecycle,
  gameOver: projectLifecycle,
  shipMoved: projectShip,
  shipLanded: projectShip,
  shipCrashed: projectShip,
  shipDestroyed: projectShip,
  shipCaptured: projectShip,
  asteroidDestroyed: projectShip,
  baseDestroyed: projectShip,
  shipResupplied: projectShip,
  fuelTransferred: projectShip,
  cargoTransferred: projectShip,
  passengersTransferred: projectShip,
  shipSurrendered: projectShip,
  baseEmplaced: projectShip,
  ordnanceLaunched: projectConflict,
  ordnanceMoved: projectConflict,
  ordnanceExpired: projectConflict,
  ordnanceDetonated: projectConflict,
  ramming: projectConflict,
  ordnanceDestroyed: projectConflict,
  combatAttack: projectConflict,
} satisfies ProjectEventRegistry;

const projectEvent = <T extends EngineEvent>(
  state: GameState | null,
  event: T,
  gameId: GameId,
  map: SolarSystemMap,
): Result<GameState> => {
  const handler = PROJECT_EVENT_HANDLERS[event.type] as ProjectEventHandler<T>;

  return handler(state, event, gameId, map);
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
    const projected = projectEvent(state, envelope.event, envelope.gameId, map);

    if (!projected.ok) {
      return projected;
    }

    state = projected.value;
  }

  if (
    state !== null &&
    events.some((env) => DETECTION_RECOMPUTE_AFTER.has(env.event.type))
  ) {
    applyDetection(state, map);
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
