// Lightweight event log for replay, reconnection,
// and spectator catch-up.
//
// This is NOT event sourcing — snapshots remain the
// source of truth. The event log is an append-only
// complement that captures the animation-relevant data
// from each action so clients can replay what happened.

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
