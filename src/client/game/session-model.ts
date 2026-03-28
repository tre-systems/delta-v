import type { AIDifficulty } from '../../shared/ai';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { ClientState } from './phase';
import { createInitialPlanningState, type PlanningState } from './planning';
import type { GameTransport } from './transport';

/** Single client-side session shape: connection, lobby, and in-match fields live here. */
export interface ClientSession {
  state: ClientState;
  playerId: PlayerId | -1;
  /** True while connected as a live spectator (`?viewer=spectator`). */
  spectatorMode: boolean;
  gameCode: string | null;
  scenario: string;
  gameState: GameState | null;
  isLocalGame: boolean;
  aiDifficulty: AIDifficulty;
  transport: GameTransport | null;
  planningState: PlanningState;
  latencyMs: number;
  reconnectAttempts: number;
}

export const createInitialClientSession = (): ClientSession => ({
  state: 'menu',
  playerId: -1,
  spectatorMode: false,
  gameCode: null,
  scenario: 'biplanetary',
  gameState: null,
  isLocalGame: false,
  aiDifficulty: 'normal',
  transport: null,
  planningState: createInitialPlanningState(),
  latencyMs: -1,
  reconnectAttempts: 0,
});

/** Subset read by WebSocket message handling (full `ClientSession` is assignable). */
export type ClientSessionMessageContext = Pick<
  ClientSession,
  | 'state'
  | 'playerId'
  | 'gameCode'
  | 'reconnectAttempts'
  | 'latencyMs'
  | 'gameState'
>;

/** Subset used by `applyClientStateTransition` (full `ClientSession` is assignable). */
export type ClientSessionStateTransitionContext = Pick<
  ClientSession,
  | 'state'
  | 'playerId'
  | 'gameCode'
  | 'gameState'
  | 'planningState'
  | 'isLocalGame'
>;

/** Merge defaults for tests and focused fakes. */
export const stubClientSession = (
  overrides: Partial<ClientSession> = {},
): ClientSession => ({
  ...createInitialClientSession(),
  ...overrides,
});
