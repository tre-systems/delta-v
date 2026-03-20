import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  S2C,
  ShipMovement,
} from '../../shared/types';
import {
  deriveGameStartClientState,
  deriveWelcomeHandling,
  shouldTransitionAfterStateUpdate,
} from './network';
import type { ClientState } from './phase';

export type ClientMessagePlan =
  | {
      kind: 'welcome';
      playerId: number;
      code: string;
      playerToken: string;
      showReconnectToast: boolean;
      nextState: ClientState | null;
    }
  | { kind: 'matchFound' }
  | {
      kind: 'gameStart';
      state: GameState;
      nextState: ClientState;
    }
  | {
      kind: 'movementResult';
      state: GameState;
      movements: ShipMovement[];
      ordnanceMovements: OrdnanceMovement[];
      events: MovementEvent[];
    }
  | {
      kind: 'combatResult';
      state: GameState;
      results: CombatResult[];
      shouldTransition: true;
    }
  | {
      kind: 'stateUpdate';
      state: GameState;
      shouldTransition: boolean;
    }
  | {
      kind: 'gameOver';
      won: boolean;
      reason: string;
    }
  | { kind: 'rematchPending' }
  | {
      kind: 'opponentDisconnected';
      nextState: 'gameOver';
      won: true;
      reason: 'Opponent disconnected';
    }
  | {
      kind: 'error';
      message: string;
    }
  | {
      kind: 'chat';
      playerId: number;
      text: string;
    }
  | {
      kind: 'pong';
      latencyMs: number | null;
    };

export const deriveClientMessagePlan = (
  currentState: ClientState,
  reconnectAttempts: number,
  playerId: number,
  nowMs: number,
  msg: S2C,
): ClientMessagePlan => {
  switch (msg.type) {
    case 'welcome': {
      const welcome = deriveWelcomeHandling(currentState, reconnectAttempts);
      return {
        kind: 'welcome',
        playerId: msg.playerId,
        code: msg.code,
        playerToken: msg.playerToken,
        showReconnectToast: welcome.showReconnectToast,
        nextState: welcome.nextState,
      };
    }
    case 'matchFound':
      return { kind: 'matchFound' };
    case 'gameStart':
      return {
        kind: 'gameStart',
        state: msg.state,
        nextState: deriveGameStartClientState(msg.state, playerId),
      };
    case 'movementResult':
      return {
        kind: 'movementResult',
        state: msg.state,
        movements: msg.movements,
        ordnanceMovements: msg.ordnanceMovements,
        events: msg.events,
      };
    case 'combatResult':
      return {
        kind: 'combatResult',
        state: msg.state,
        results: msg.results,
        shouldTransition: true,
      };
    case 'stateUpdate':
      return {
        kind: 'stateUpdate',
        state: msg.state,
        shouldTransition: shouldTransitionAfterStateUpdate(currentState),
      };
    case 'gameOver':
      return {
        kind: 'gameOver',
        won: msg.winner === playerId,
        reason: msg.reason,
      };
    case 'rematchPending':
      return { kind: 'rematchPending' };
    case 'opponentDisconnected':
      return {
        kind: 'opponentDisconnected',
        nextState: 'gameOver',
        won: true,
        reason: 'Opponent disconnected',
      };
    case 'error':
      return {
        kind: 'error',
        message: msg.message,
      };
    case 'chat':
      return { kind: 'chat', playerId: msg.playerId, text: msg.text };
    case 'pong':
      return {
        kind: 'pong',
        latencyMs: msg.t > 0 ? nowMs - msg.t : null,
      };
  }
};
