import type {
  GameState,
  MovementEvent,
  OrdnanceMovement,
  ShipMovement,
} from '../types';

// --- Result types ---

export interface MovementResult {
  movements: ShipMovement[];
  ordnanceMovements: OrdnanceMovement[];
  events: MovementEvent[];
  state: GameState;
}

export interface StateUpdateResult {
  state: GameState;
}

// --- Re-exports: public engine API ---

export {
  processAstrogation,
  processOrdnance,
  skipOrdnance,
} from './astrogation';
export type { CombatPhaseResult } from './combat';
export {
  beginCombatPhase,
  processCombat,
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
export { filterStateForPlayer } from './resolve-movement';
