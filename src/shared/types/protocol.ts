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
  PlayerId,
  ShipMovement,
  TransferOrder,
} from './domain';

/** Common fields shared by all logistics transfer events. */
export interface TransferLogFields {
  fromShipId: string;
  toShipId: string;
  amount: number;
}

/** Subset of engine events included on `stateUpdate` after logistics (client game log). */
export type LogisticsTransferLogEvent = TransferLogFields & {
  type: 'fuelTransferred' | 'cargoTransferred' | 'passengersTransferred';
};

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
      playerId: PlayerId;
      code: string;
      playerToken: string;
    }
  | {
      /** Live spectator socket handshake (no player token). */
      type: 'spectatorWelcome';
      code: string;
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
  | { type: 'pong'; t: number };
