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

// Mid-game coaching directive — a human whispers strategic intent to
// their agent via `/coach <text>` in chat; the server stores the most
// recent directive per seat and injects it into subsequent observations.
// The agent decides whether to follow. `acknowledged` is reserved for a
// future ack mechanism; in v1 it is always `false` (agents can respond
// via normal chat, e.g. "Copy", to indicate they saw it).
export interface CoachDirective {
  text: string;
  turnReceived: number;
  acknowledged: boolean;
}

// Wire shape sent to every external agent (stdin / HTTP / MCP).
// Kept backward compatible with the v1 bridge contract: existing agents that
// only read state/candidates/summary/legalActionInfo keep working. The v2
// fields (tactical, spatialGrid, labeledCandidates) are opt-in via the
// buildObservation options; absence means the caller didn't ask for them.
/** Populated once on the next observation after the server advanced the seat on a decision timeout. */
export type LastTurnAutoPlayedReason = 'timeout';

export interface LastTurnAutoPlayed {
  index: number;
  reason: LastTurnAutoPlayedReason;
}

export interface AgentTurnInput {
  version: 1;
  gameCode: string;
  playerId: PlayerId;
  state: GameState;
  candidates: C2S[];
  recommendedIndex: number;
  /** One-shot: server played this candidate index for you after a turn timer fired; then cleared. */
  lastTurnAutoPlayed?: LastTurnAutoPlayed;
  summary?: string;
  legalActionInfo?: LegalActionInfo;
  // v2 optional enrichments — see src/shared/agent/tactical.ts,
  // spatial-grid.ts, candidate-labels.ts.
  tactical?: import('./tactical').TacticalFeatures;
  spatialGrid?: string;
  labeledCandidates?: import('./candidate-labels').LabeledCandidate[];
  // Mid-game directive from a human coach (see §9 of AGENT_SPEC).
  // Absent when no directive is active for this seat.
  coachDirective?: CoachDirective;
}

// Either the agent picks an existing candidate by index, or supplies a custom C2S action.
// Both paths may include an optional chat line (trimmed to 200 chars server-side).
export interface AgentTurnResponse {
  candidateIndex?: number;
  action?: C2S;
  chat?: string;
}
