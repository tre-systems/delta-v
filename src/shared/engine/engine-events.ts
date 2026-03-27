import type { HexCoord, HexVec } from '../hex';
import type { Phase } from '../types';
import type {
  AstrogationOrder,
  AttackType,
  DamageType,
  FleetPurchase,
  GravityEffect,
  OrdnanceLaunch,
  OrdnanceType,
  PlayerId,
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
      activePlayer: PlayerId;
    }
  | {
      type: 'turnAdvanced';
      turn: number;
      activePlayer: PlayerId;
    }
  | {
      type: 'gameOver';
      winner: PlayerId | null;
      reason: string;
    }

  // Fleet building
  | {
      type: 'fleetPurchased';
      playerId: PlayerId;
      purchases: FleetPurchase[];
      shipTypes: string[];
    }
  | {
      type: 'astrogationOrdersCommitted';
      playerId: PlayerId;
      orders: AstrogationOrder[];
    }
  | {
      type: 'ordnanceLaunchesCommitted';
      playerId: PlayerId;
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
      capturedBy: PlayerId;
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
      damageType: DamageType;
      disabledTurns: number;
    }

  // Ordnance
  | {
      type: 'ordnanceLaunched';
      ordnanceId: string;
      ordnanceType: OrdnanceType;
      owner: PlayerId;
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
      ordnanceType: OrdnanceType;
      hex: HexCoord;
      targetShipId?: string;
      roll: number;
      damageType: DamageType;
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
      attackType: AttackType;
      roll: number;
      modifiedRoll: number;
      damageType: DamageType;
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
      type: 'passengersTransferred';
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
      playerId: PlayerId;
      transfers: TransferOrder[];
    }
  | {
      type: 'surrenderDeclared';
      playerId: PlayerId;
      shipIds: string[];
    }
  | {
      type: 'baseEmplaced';
      shipId: string;
      sourceShipId: string;
      owner: PlayerId;
      position: HexCoord;
      velocity: HexVec;
    }

  // Hidden identity / race
  | {
      type: 'fugitiveDesignated';
      shipId: string;
      playerId: PlayerId;
    }
  | {
      type: 'identityRevealed';
      shipId: string;
    }
  | {
      type: 'checkpointVisited';
      playerId: PlayerId;
      body: string;
    };

// Versioned event envelope for match-scoped persistence.
export interface EventEnvelope {
  gameId: string;
  seq: number;
  ts: number;
  actor: PlayerId | null;
  event: EngineEvent;
}
