import type { GameEvent } from '../events';
import type {
  AstrogationOrder,
  CombatAttack,
  CombatResult,
  FleetPurchase,
  GameState,
  MovementEvent,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  OrdnanceMovement,
  ShipMovement,
  TransferOrder,
} from './domain';

// --- Network messages ---

export type C2S =
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'surrender'; shipIds: string[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | {
      type: 'emplaceBase';
      emplacements: OrbitalBaseEmplacement[];
    }
  | { type: 'skipOrdnance' }
  | { type: 'beginCombat' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'skipCombat' }
  | { type: 'logistics'; transfers: TransferOrder[] }
  | { type: 'skipLogistics' }
  | { type: 'rematch' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };

export type S2C =
  | {
      type: 'welcome';
      playerId: number;
      code: string;
      playerToken: string;
    }
  | { type: 'matchFound' }
  | {
      type: 'gameStart';
      state: GameState;
      eventLog?: GameEvent[];
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
  | { type: 'stateUpdate'; state: GameState }
  | { type: 'gameOver'; winner: number; reason: string }
  | { type: 'rematchPending' }
  | { type: 'opponentDisconnected' }
  | {
      type: 'chat';
      playerId: number;
      text: string;
    }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };
