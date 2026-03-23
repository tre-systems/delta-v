import type { HexCoord, HexVec } from '../hex';
import type { Phase } from '../types';
import type {
  AstrogationOrder,
  FleetPurchase,
  GravityEffect,
  OrdnanceLaunch,
  ShipLifecycle,
  TransferOrder,
} from '../types/domain';

// Granular domain events emitted by engine functions.
export type EngineEvent =
  // Game lifecycle
  | {
      type: 'gameCreated';
      scenario: string;
      turn: number;
      phase: Phase;
      matchSeed: number;
    }
  | {
      type: 'phaseChanged';
      phase: Phase;
      turn: number;
      activePlayer: number;
    }
  | {
      type: 'turnAdvanced';
      turn: number;
      activePlayer: number;
    }
  | {
      type: 'gameOver';
      winner: number | null;
      reason: string;
    }

  // Fleet building
  | {
      type: 'fleetPurchased';
      playerId: number;
      purchases: FleetPurchase[];
      shipTypes: string[];
    }
  | {
      type: 'astrogationOrdersCommitted';
      playerId: number;
      orders: AstrogationOrder[];
    }
  | {
      type: 'ordnanceLaunchesCommitted';
      playerId: number;
      launches: OrdnanceLaunch[];
    }

  // Ship movement
  | {
      type: 'shipMoved';
      shipId: string;
      from: HexCoord;
      to: HexCoord;
      path: HexCoord[];
      fuelSpent: number;
      fuelRemaining: number;
      newVelocity: HexVec;
      lifecycle: ShipLifecycle;
      overloadUsed: boolean;
      pendingGravityEffects: GravityEffect[];
    }
  | {
      type: 'shipLanded';
      shipId: string;
    }
  | {
      type: 'shipCrashed';
      shipId: string;
      hex: HexCoord;
    }
  | {
      type: 'shipResupplied';
      shipId: string;
      source: 'base' | 'orbitalBase';
      sourceId?: string;
    }
  | {
      type: 'shipCaptured';
      shipId: string;
      capturedBy: number;
      capturedByShipId: string;
    }
  | {
      type: 'shipDestroyed';
      shipId: string;
      cause: string;
    }
  | {
      type: 'asteroidDestroyed';
      hex: HexCoord;
    }
  | {
      type: 'baseDestroyed';
      hex: HexCoord;
    }

  // Ramming
  | {
      type: 'ramming';
      shipId: string;
      otherShipId: string;
      hex: HexCoord;
      roll: number;
      damageType: string;
      disabledTurns: number;
    }

  // Ordnance
  | {
      type: 'ordnanceLaunched';
      ordnanceId: string;
      ordnanceType: string;
      owner: number;
      sourceShipId: string;
      position: HexCoord;
      velocity: HexVec;
      turnsRemaining: number;
      pendingGravityEffects: GravityEffect[];
    }
  | {
      type: 'ordnanceMoved';
      ordnanceId: string;
      position: HexCoord;
      velocity: HexVec;
      turnsRemaining: number;
      pendingGravityEffects: GravityEffect[];
    }
  | {
      type: 'ordnanceDetonated';
      ordnanceId: string;
      ordnanceType: string;
      hex: HexCoord;
      targetShipId?: string;
      roll: number;
      damageType: string;
      disabledTurns: number;
    }
  | {
      type: 'ordnanceDestroyed';
      ordnanceId: string;
      cause: string;
    }
  | {
      type: 'ordnanceExpired';
      ordnanceId: string;
    }

  // Combat
  | {
      type: 'combatAttack';
      attackerIds: string[];
      targetId: string;
      targetType: 'ship' | 'ordnance';
      attackType: string;
      roll: number;
      modifiedRoll: number;
      damageType: string;
      disabledTurns: number;
    }

  // Logistics
  | {
      type: 'fuelTransferred';
      fromShipId: string;
      toShipId: string;
      amount: number;
    }
  | {
      type: 'cargoTransferred';
      fromShipId: string;
      toShipId: string;
      amount: number;
    }
  | {
      type: 'shipSurrendered';
      shipId: string;
    }
  | {
      type: 'logisticsTransfersCommitted';
      playerId: number;
      transfers: TransferOrder[];
    }
  | {
      type: 'surrenderDeclared';
      playerId: number;
      shipIds: string[];
    }
  | {
      type: 'baseEmplaced';
      shipId: string;
      sourceShipId: string;
      owner: number;
      position: HexCoord;
      velocity: HexVec;
    }

  // Hidden identity / race
  | {
      type: 'fugitiveDesignated';
      shipId: string;
      playerId: number;
    }
  | {
      type: 'identityRevealed';
      shipId: string;
    }
  | {
      type: 'checkpointVisited';
      playerId: number;
      body: string;
    };

// Versioned event envelope for match-scoped persistence.
export interface EventEnvelope {
  gameId: string;
  seq: number;
  ts: number;
  actor: number | null;
  event: EngineEvent;
}
