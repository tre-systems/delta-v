import type { OrdnanceId, ShipId } from '../../ids';
import { isValidScenario, SCENARIOS } from '../../map-data';
import type { ScenarioDefinition } from '../../types';
import { CURRENT_GAME_STATE_SCHEMA_VERSION } from '../../types';
import type { GameState, GravityEffect, Result } from '../../types/domain';
import type { EngineEvent } from '../engine-events';

export type LifecycleProjectionEvent = Extract<
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

export type ShipProjectionEvent = Extract<
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

export type ConflictProjectionEvent = Extract<
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

export const migrateGameState = (state: GameState): GameState => ({
  ...state,
  schemaVersion: state.schemaVersion ?? CURRENT_GAME_STATE_SCHEMA_VERSION,
});

// Resolves a scenario from either a key (e.g. "biplanetary") or a display
// name (e.g. "Bi-Planetary") for backward-compatible replay support.
export const resolveScenarioByName = (
  scenarioName: string,
): ScenarioDefinition | null => {
  // Try key lookup first (new format).
  if (isValidScenario(scenarioName)) {
    return SCENARIOS[scenarioName];
  }
  // Fall back to name match (legacy replays).
  for (const scenario of Object.values(SCENARIOS)) {
    if (scenario.name === scenarioName) {
      return scenario;
    }
  }

  return null;
};

export const requireState = (
  state: GameState | null,
  eventType: EngineEvent['type'],
): Result<GameState> =>
  state === null
    ? { ok: false, error: `${eventType} before gameCreated` }
    : { ok: true, value: state };

export const requireShip = (
  state: GameState,
  shipId: ShipId,
): Result<GameState['ships'][number]> => {
  const ship = state.ships.find((candidate) => candidate.id === shipId);

  return ship
    ? { ok: true, value: ship }
    : { ok: false, error: `ship not found: ${shipId}` };
};

export const requireOrdnance = (
  state: GameState,
  ordnanceId: OrdnanceId,
): Result<GameState['ordnance'][number]> => {
  const ordnance = state.ordnance.find(
    (candidate) => candidate.id === ordnanceId,
  );

  return ordnance
    ? { ok: true, value: ordnance }
    : { ok: false, error: `ordnance not found: ${ordnanceId}` };
};

export const cloneGravityEffects = (
  effects: GravityEffect[],
): GravityEffect[] =>
  effects.map((effect) => ({
    ...effect,
    hex: { ...effect.hex },
  }));
