// Lightweight event log for replay, reconnection,
// and spectator catch-up.
//
// Today this remains a transitional append-only log:
// snapshots are still the persisted source of truth.
// The project is moving toward event-sourced match
// history, so these event shapes should be treated as a
// stepping stone rather than the final authoritative
// event model.

import type {
  CombatResult,
  MovementEvent,
  OrdnanceMovement,
  Phase,
  ShipMovement,
} from './types';

export type GameEvent =
  | {
      type: 'movementResolved';
      turn: number;
      phase: Phase;
      activePlayer: number;
      movements: ShipMovement[];
      ordnanceMovements: OrdnanceMovement[];
      events: MovementEvent[];
    }
  | {
      type: 'combatResolved';
      turn: number;
      phase: Phase;
      activePlayer: number;
      results: CombatResult[];
    }
  | {
      type: 'phaseChanged';
      turn: number;
      phase: Phase;
      activePlayer: number;
    }
  | {
      type: 'gameStarted';
      turn: number;
      phase: Phase;
    }
  | {
      type: 'gameOver';
      turn: number;
      winner: number;
      reason: string;
    };
