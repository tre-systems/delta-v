import type { GameState } from '../../shared/types/domain';
import type { ClientState } from './phase';

export interface ReconnectAttemptPlan {
  giveUp: boolean;
  nextAttempt: number | null;
  delayMs: number | null;
}

export const deriveGameStartClientState = (
  state: GameState,
  playerId: number,
): ClientState => {
  if (state.phase === 'fleetBuilding') {
    return 'playing_fleetBuilding';
  }

  if (playerId < 0) {
    return 'playing_opponentTurn';
  }

  return state.activePlayer === playerId
    ? 'playing_astrogation'
    : 'playing_opponentTurn';
};

export const getReconnectDelayMs = (attempt: number): number => {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
};

export const deriveReconnectAttemptPlan = (
  gameCode: string | null,
  reconnectAttempts: number,
  maxReconnectAttempts: number,
): ReconnectAttemptPlan => {
  if (!gameCode || reconnectAttempts >= maxReconnectAttempts) {
    return {
      giveUp: true,
      nextAttempt: null,
      delayMs: null,
    };
  }

  const nextAttempt = reconnectAttempts + 1;

  return {
    giveUp: false,
    nextAttempt,
    delayMs: getReconnectDelayMs(nextAttempt),
  };
};
