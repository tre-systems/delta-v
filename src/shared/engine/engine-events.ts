import type { ShipType } from '../constants';
import type { HexCoord, HexVec } from '../hex';
import type { GameId, OrdnanceId, ShipId } from '../ids';
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
      shipTypes: ShipType[];
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
      shipId: ShipId;
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
      shipId: ShipId;
    }
  | {
      type: 'shipCrashed';
      shipId: ShipId;
      hex: HexCoord;
    }
  | {
      type: 'shipResupplied';
      shipId: ShipId;
      source: 'base' | 'orbitalBase';
      sourceId?: ShipId;
    }
  | {
      type: 'shipCaptured';
      shipId: ShipId;
      capturedBy: PlayerId;
      capturedByShipId: ShipId;
    }
  | {
      type: 'shipDestroyed';
      shipId: ShipId;
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
      shipId: ShipId;
      otherShipId: ShipId;
      hex: HexCoord;
      roll: number;
      damageType: DamageType;
      disabledTurns: number;
    }

  // Ordnance
  | {
      type: 'ordnanceLaunched';
      ordnanceId: OrdnanceId;
      ordnanceType: OrdnanceType;
      owner: PlayerId;
      sourceShipId: ShipId;
      position: HexCoord;
      velocity: HexVec;
      turnsRemaining: number;
      pendingGravityEffects: GravityEffect[];
    }
  | {
      type: 'ordnanceMoved';
      ordnanceId: OrdnanceId;
      position: HexCoord;
      velocity: HexVec;
      turnsRemaining: number;
      pendingGravityEffects: GravityEffect[];
    }
  | {
      type: 'ordnanceDetonated';
      ordnanceId: OrdnanceId;
      ordnanceType: OrdnanceType;
      hex: HexCoord;
      targetShipId?: ShipId;
      roll: number;
      damageType: DamageType;
      disabledTurns: number;
    }
  | {
      type: 'ordnanceDestroyed';
      ordnanceId: OrdnanceId;
      cause: string;
    }
  | {
      type: 'ordnanceExpired';
      ordnanceId: OrdnanceId;
    }

  // Combat
  | {
      type: 'combatAttack';
      attackerIds: ShipId[];
      targetId: ShipId | OrdnanceId;
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
      fromShipId: ShipId;
      toShipId: ShipId;
      amount: number;
    }
  | {
      type: 'cargoTransferred';
      fromShipId: ShipId;
      toShipId: ShipId;
      amount: number;
    }
  | {
      type: 'passengersTransferred';
      fromShipId: ShipId;
      toShipId: ShipId;
      amount: number;
    }
  | {
      type: 'shipSurrendered';
      shipId: ShipId;
    }
  | {
      type: 'logisticsTransfersCommitted';
      playerId: PlayerId;
      transfers: TransferOrder[];
    }
  | {
      type: 'surrenderDeclared';
      playerId: PlayerId;
      shipIds: ShipId[];
    }
  | {
      type: 'baseEmplaced';
      shipId: ShipId;
      sourceShipId: ShipId;
      owner: PlayerId;
      position: HexCoord;
      velocity: HexVec;
    }

  // Hidden identity / race
  | {
      type: 'fugitiveDesignated';
      shipId: ShipId;
      playerId: PlayerId;
    }
  | {
      type: 'identityRevealed';
      shipId: ShipId;
    }
  | {
      type: 'checkpointVisited';
      playerId: PlayerId;
      body: string;
    };

// Versioned event envelope for match-scoped persistence.
export interface EventEnvelope {
  gameId: GameId;
  seq: number;
  ts: number;
  actor: PlayerId | null;
  event: EngineEvent;
}
