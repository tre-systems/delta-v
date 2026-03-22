import type { HexCoord, HexVec } from '../hex';
import type { Phase } from '../types';

/** Granular domain events emitted by engine functions. */
export type EngineEvent =
  // Game lifecycle
  | {
      type: 'gameCreated';
      scenario: string;
      turn: number;
      phase: Phase;
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
      shipTypes: string[];
    }

  // Ship movement
  | {
      type: 'shipMoved';
      shipId: string;
      from: HexCoord;
      to: HexCoord;
      fuelSpent: number;
      newVelocity: HexVec;
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
    }
  | {
      type: 'shipCaptured';
      shipId: string;
      capturedBy: number;
    }
  | {
      type: 'shipDestroyed';
      shipId: string;
      cause: string;
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
      sourceShipId: string;
      position: HexCoord;
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
      type: 'baseEmplaced';
      shipId: string;
      position: HexCoord;
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

/** Versioned event envelope for match-scoped persistence. */
export interface EventEnvelope {
  gameId: string;
  seq: number;
  ts: number;
  actor: number | null;
  event: EngineEvent;
}
