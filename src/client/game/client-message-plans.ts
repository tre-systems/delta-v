import type { PlayerToken, RoomCode } from '../../shared/ids';
import type {
  CombatResult,
  ErrorCode,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  Phase,
  PlayerId,
  ShipMovement,
} from '../../shared/types/domain';
import type {
  ActionRejectedReason,
  LogisticsTransferLogEvent,
  S2C,
} from '../../shared/types/protocol';
import {
  deriveGameStartClientState,
  deriveWelcomeHandling,
  shouldTransitionAfterStateUpdate,
} from './network';
import type { ClientState } from './phase';

export type ClientMessagePlan =
  | {
      kind: 'welcome';
      playerId: PlayerId;
      code: RoomCode;
      playerToken: PlayerToken;
      showReconnectToast: boolean;
      nextState: ClientState | null;
    }
  | {
      kind: 'spectatorWelcome';
      code: RoomCode;
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
      kind: 'combatSingleResult';
      state: GameState;
      result: CombatResult;
    }
  | {
      kind: 'stateUpdate';
      state: GameState;
      shouldTransition: boolean;
      transferEvents?: LogisticsTransferLogEvent[];
    }
  | {
      kind: 'gameOver';
      won: boolean;
      reason: string;
    }
  | { kind: 'rematchPending' }
  | {
      kind: 'error';
      message: string;
      code?: ErrorCode;
    }
  | {
      kind: 'actionAccepted';
      guardStatus: 'inSync' | 'stalePhaseForgiven';
      submitterPlayerId?: PlayerId;
      expected: {
        turn?: number;
        phase?: Phase;
      };
      actual: {
        turn: number;
        phase: Phase;
        activePlayer: PlayerId;
      };
    }
  | {
      kind: 'actionRejected';
      reason: ActionRejectedReason;
      message: string;
      submitterPlayerId?: PlayerId;
      expected: {
        turn?: number;
        phase?: Phase;
      };
      actual: {
        turn: number;
        phase: Phase;
        activePlayer: PlayerId;
      };
    }
  | {
      kind: 'chat';
      playerId: PlayerId;
      text: string;
    }
  | {
      kind: 'pong';
      latencyMs: number | null;
    }
  | {
      kind: 'opponentStatus';
      status: 'disconnected' | 'reconnected';
      graceDeadlineMs?: number;
    };

export const deriveClientMessagePlan = (
  currentState: ClientState,
  reconnectAttempts: number,
  playerId: PlayerId | -1,
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
    case 'spectatorWelcome': {
      const welcome = deriveWelcomeHandling(currentState, reconnectAttempts);
      return {
        kind: 'spectatorWelcome',
        code: msg.code,
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
    case 'combatSingleResult':
      return {
        kind: 'combatSingleResult',
        state: msg.state,
        result: msg.result,
      };
    case 'stateUpdate': {
      const shouldTransition = shouldTransitionAfterStateUpdate(currentState);
      const transfers = msg.transferEvents;

      if (transfers !== undefined && transfers.length > 0) {
        return {
          kind: 'stateUpdate',
          state: msg.state,
          shouldTransition,
          transferEvents: transfers,
        };
      }

      return {
        kind: 'stateUpdate',
        state: msg.state,
        shouldTransition,
      };
    }
    case 'gameOver':
      return {
        kind: 'gameOver',
        won: msg.winner === playerId,
        reason: msg.reason,
      };
    case 'rematchPending':
      return { kind: 'rematchPending' };
    case 'error':
      return {
        kind: 'error',
        message: msg.message,
        code: msg.code,
      };
    case 'actionAccepted':
      return {
        kind: 'actionAccepted',
        guardStatus: msg.guardStatus,
        ...(msg.submitterPlayerId !== undefined
          ? { submitterPlayerId: msg.submitterPlayerId }
          : {}),
        expected: msg.expected,
        actual: msg.actual,
      };
    case 'actionRejected':
      return {
        kind: 'actionRejected',
        reason: msg.reason,
        message: msg.message,
        ...(msg.submitterPlayerId !== undefined
          ? { submitterPlayerId: msg.submitterPlayerId }
          : {}),
        expected: msg.expected,
        actual: msg.actual,
      };
    case 'chat':
      return { kind: 'chat', playerId: msg.playerId, text: msg.text };
    case 'pong':
      return {
        kind: 'pong',
        latencyMs: msg.t > 0 ? nowMs - msg.t : null,
      };
    case 'opponentStatus':
      return {
        kind: 'opponentStatus',
        status: msg.status,
        graceDeadlineMs: msg.graceDeadlineMs,
      };
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
};
