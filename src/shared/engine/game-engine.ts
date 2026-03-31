import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  ShipMovement,
} from '../types';
import type { EngineEvent } from './engine-events';

// --- Result types ---

export interface MovementResult {
  movements: ShipMovement[];
  ordnanceMovements: OrdnanceMovement[];
  events: MovementEvent[];
  engineEvents: EngineEvent[];
  state: GameState;
}

export interface StateUpdateResult {
  state: GameState;
  engineEvents: EngineEvent[];
}

// --- Result classification helpers ---

export const isMovementResult = (
  result: MovementResult | StateUpdateResult,
): result is MovementResult => 'movements' in result;

export const hasCombatResults = (result: {
  state: GameState;
  results?: unknown[];
}): result is { state: GameState; results: CombatResult[] } =>
  Array.isArray(result.results) && result.results.length > 0;

// --- Re-exports: public engine API ---

export {
  processAstrogation,
  processOrdnance,
  skipOrdnance,
} from './astrogation';
export type { CombatPhaseResult } from './combat';
export {
  beginCombatPhase,
  endCombat,
  processCombat,
  processSingleCombat,
  skipCombat,
} from './combat';
export { processFleetReady } from './fleet-building';
export { createGame } from './game-creation';
export {
  processLogistics,
  processSurrender,
  skipLogistics,
} from './logistics';
export { processEmplacement } from './ordnance';
export { filterStateForPlayer, type ViewerId } from './resolve-movement';
