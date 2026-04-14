// Types shared across all agent entry points (bridge, local MCP, remote MCP).
// Keep these in one place so agents can import a single source of truth.

import type { GameState, PlayerId } from '../types/domain';
import type { C2S } from '../types/protocol';

export interface LegalActionShipInfo {
  id: string;
  type: string;
  position: { q: number; r: number };
  velocity: { dq: number; dr: number };
  fuel: number;
  lifecycle: string;
  canBurn: boolean;
  canOverload: boolean;
  canAttack: boolean;
  canLaunchOrdnance: boolean;
  cargoUsed: number;
  cargoCapacity: number;
  disabledTurns: number;
}

export interface LegalActionEnemyInfo {
  id: string;
  type: string;
  position: { q: number; r: number };
  velocity: { dq: number; dr: number };
  lifecycle: string;
  detected: boolean;
}

export interface LegalActionInfo {
  phase: string;
  allowedTypes: string[];
  burnDirections: string[];
  ownShips: LegalActionShipInfo[];
  enemies: LegalActionEnemyInfo[];
}

// Wire shape sent to every external agent (stdin / HTTP / MCP).
// Kept backward compatible with the v1 bridge contract.
export interface AgentTurnInput {
  version: 1;
  gameCode: string;
  playerId: PlayerId;
  state: GameState;
  candidates: C2S[];
  recommendedIndex: number;
  summary?: string;
  legalActionInfo?: LegalActionInfo;
}

// Either the agent picks an existing candidate by index, or supplies a custom C2S action.
// Both paths may include an optional chat line (trimmed to 200 chars server-side).
export interface AgentTurnResponse {
  candidateIndex?: number;
  action?: C2S;
  chat?: string;
}
