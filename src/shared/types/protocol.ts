import type { PlayerToken, RoomCode, ShipId } from '../ids';
import type {
  AstrogationOrder,
  CombatAttack,
  CombatResult,
  ErrorCode,
  FleetPurchase,
  GameState,
  MovementEvent,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  OrdnanceMovement,
  Phase,
  PlayerId,
  ShipMovement,
  TransferOrder,
} from './domain';

// Common fields shared by all logistics transfer events.
export interface TransferLogFields {
  fromShipId: ShipId;
  toShipId: ShipId;
  amount: number;
}

/** Subset of engine events included on `stateUpdate` after logistics (client game log). */
export type LogisticsTransferLogEvent = TransferLogFields & {
  type: 'fuelTransferred' | 'cargoTransferred' | 'passengersTransferred';
};

// --- Network messages ---

// Optional action guards, attachable to any C2S. The server validates these
// before dispatching to the engine; on mismatch it sends back `actionRejected`
// with the current state so the agent can re-decide without a round-trip.
// - expectedTurn/expectedPhase guard against stale submissions after an LLM think
// - idempotencyKey lets the agent retry safely after a transient error
export interface ActionGuards {
  expectedTurn?: number;
  expectedPhase?: Phase;
  idempotencyKey?: string;
}

type WithGuards<T> = T & { guards?: ActionGuards };

export type C2S = WithGuards<
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'surrender'; shipIds: ShipId[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | {
      type: 'emplaceBase';
      emplacements: OrbitalBaseEmplacement[];
    }
  | { type: 'skipOrdnance' }
  | { type: 'beginCombat' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'combatSingle'; attack: CombatAttack }
  | { type: 'endCombat' }
  | { type: 'skipCombat' }
  | { type: 'logistics'; transfers: TransferOrder[] }
  | { type: 'skipLogistics' }
  | { type: 'rematch' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number }
>;

export type S2C =
  | {
      type: 'welcome';
      playerId: PlayerId;
      code: RoomCode;
      playerToken: PlayerToken;
    }
  | {
      /** Live spectator socket handshake (no player token). */
      type: 'spectatorWelcome';
      code: RoomCode;
    }
  | { type: 'matchFound' }
  | {
      type: 'gameStart';
      state: GameState;
    }
  | {
      type: 'movementResult';
      movements: ShipMovement[];
      ordnanceMovements: OrdnanceMovement[];
      events: MovementEvent[];
      state: GameState;
    }
  | {
      type: 'combatResult';
      results: CombatResult[];
      state: GameState;
    }
  | {
      type: 'combatSingleResult';
      result: CombatResult;
      state: GameState;
    }
  | {
      type: 'stateUpdate';
      state: GameState;
      transferEvents?: LogisticsTransferLogEvent[];
    }
  | { type: 'gameOver'; winner: PlayerId; reason: string }
  | { type: 'rematchPending' }
  | {
      type: 'chat';
      playerId: PlayerId;
      text: string;
    }
  | { type: 'error'; message: string; code?: ErrorCode }
  | {
      /**
       * Sent to the submitter (never broadcast) when an action failed its
       * ActionGuards check (stale turn, stale phase, wrong active player, or
       * duplicate idempotency key). Carries the fresh state so the agent can
       * re-decide without another `get_observation` round-trip.
       */
      type: 'actionRejected';
      reason:
        | 'staleTurn'
        | 'stalePhase'
        | 'wrongActivePlayer'
        | 'duplicateIdempotencyKey';
      message: string;
      /** Seat that submitted the rejected action (agents need not correlate WebSocket context). */
      submitterPlayerId?: PlayerId;
      expected: {
        turn?: number;
        phase?: Phase;
      };
      actual: {
        turn: number;
        phase: Phase;
        activePlayer: PlayerId;
      };
      state: GameState;
      idempotencyKey?: string;
    }
  | { type: 'pong'; t: number }
  | {
      type: 'opponentStatus';
      status: 'disconnected' | 'reconnected';
      graceDeadlineMs?: number;
    };
