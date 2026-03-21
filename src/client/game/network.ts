import type { GameState } from '../../shared/types/domain';
import type { ClientState } from './phase';

export interface WelcomeHandling {
  showReconnectToast: boolean;
  nextState: ClientState | null;
}

export interface DisconnectHandling {
  attemptReconnect: boolean;
  nextState: ClientState | null;
}

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

  return state.activePlayer === playerId
    ? 'playing_astrogation'
    : 'playing_opponentTurn';
};

export const deriveWelcomeHandling = (
  currentState: ClientState,
  reconnectAttempts: number,
): WelcomeHandling => {
  return {
    showReconnectToast: reconnectAttempts > 0,
    nextState: currentState === 'connecting' ? 'waitingForOpponent' : null,
  };
};

export const getReconnectDelayMs = (attempt: number): number => {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
};

export const shouldAttemptReconnect = (
  currentState: ClientState,
  gameCode: string | null,
  gameState: GameState | null,
): boolean => {
  if (currentState === 'menu' || currentState === 'gameOver') {
    return false;
  }

  return Boolean(gameCode && gameState);
};

export const deriveDisconnectHandling = (
  currentState: ClientState,
  gameCode: string | null,
  gameState: GameState | null,
): DisconnectHandling => {
  if (shouldAttemptReconnect(currentState, gameCode, gameState)) {
    return {
      attemptReconnect: true,
      nextState: null,
    };
  }

  if (currentState === 'menu' || currentState === 'gameOver') {
    return {
      attemptReconnect: false,
      nextState: null,
    };
  }

  return {
    attemptReconnect: false,
    nextState: 'menu',
  };
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

export const shouldTransitionAfterStateUpdate = (
  currentState: ClientState,
): boolean => {
  return currentState !== 'playing_movementAnim';
};
