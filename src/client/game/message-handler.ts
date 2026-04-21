import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { RoomCode } from '../../shared/ids';
import type { CombatResult, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playPhaseChange } from '../audio';
import { getServerErrorToastMessage } from '../messages/server-error-presentation';
import { TOAST } from '../messages/toasts';
import { batch } from '../reactive';
import {
  type AuthoritativeUpdate,
  type AuthoritativeUpdateDeps,
  applyAuthoritativeUpdate,
} from './authoritative-updates';
import {
  applyWelcomeSession,
  setLatencyMs,
  setOpponentDisconnectDeadlineMs,
} from './client-context-store';
import {
  type ClientMessagePlan,
  deriveClientMessagePlan,
} from './client-message-plans';
import type { ClientState } from './phase';
import type { ClientSessionMessageContext } from './session-model';
export interface MessageHandlerDeps {
  readonly ctx: ClientSessionMessageContext;
  setState: (state: ClientState) => void;
  applyGameState: (state: GameState) => void;
  transitionToPhase: () => void;
  presentMovementResult: (
    state: GameState,
    movements: MovementResult['movements'],
    ordnanceMovements: MovementResult['ordnanceMovements'],
    events: MovementResult['events'],
    onComplete: () => void,
  ) => void;
  presentCombatResults: (
    previousState: GameState,
    state: GameState,
    results: CombatResult[],
    resetCombat?: boolean,
  ) => void;
  showGameOverOutcome: (won: boolean, reason: string) => void;
  advanceToNextAttacker: () => void;
  storePlayerToken: (code: RoomCode, token: string) => void;
  resetTurnTelemetry: () => void;
  onAnimationComplete: () => void;
  logScenarioBriefing: () => void;
  trackEvent: (event: string, props?: Record<string, unknown>) => void;
  deserializeState: (raw: GameState) => GameState;
  renderer: {
    clearTrails: () => void;
  };
  ui: {
    log: {
      logText: (text: string, cssClass?: string) => void;
      setChatEnabled: (enabled: boolean) => void;
      clear: () => void;
    };
    overlay: {
      showToast: (message: string, type: 'error' | 'info' | 'success') => void;
      hideGameOver: () => void;
      showRematchPending: () => void;
    };
  };
}

type WelcomePlan = Extract<
  ClientMessagePlan,
  { kind: 'welcome' | 'spectatorWelcome' }
>;

const applyWelcomePlan = (
  deps: MessageHandlerDeps,
  plan: WelcomePlan,
): void => {
  const reconnectAttempts = deps.ctx.reconnectAttempts;
  const currentState = deps.ctx.state;

  applyWelcomeSession(
    deps.ctx,
    plan.kind === 'welcome' ? plan.playerId : -1,
    plan.code,
  );

  if (plan.kind === 'welcome') {
    deps.storePlayerToken(plan.code, plan.playerToken);
  }

  if (plan.showReconnectToast) {
    deps.trackEvent('reconnect_succeeded', {
      attempts: reconnectAttempts,
    });
    deps.ui.overlay.showToast(TOAST.reconnect.client, 'success');
  } else if (currentState === 'connecting') {
    deps.trackEvent(
      plan.kind === 'welcome'
        ? 'join_game_succeeded'
        : 'spectate_join_succeeded',
      {},
    );
  }

  if (plan.nextState) {
    deps.setState(plan.nextState);
  }
};

const applyGameStartPlan = (
  deps: MessageHandlerDeps,
  plan: Extract<ClientMessagePlan, { kind: 'gameStart' }>,
): void => {
  deps.ui.overlay.hideGameOver();
  deps.resetTurnTelemetry();
  deps.renderer.clearTrails();
  deps.ui.log.clear();
  deps.ui.log.setChatEnabled(true);
  deps.logScenarioBriefing();

  // Batch the game-state write and the FSM transition together so that
  // reactive effects (renderer update, UI visibility) fire only once,
  // after both values are set.  Without this, the renderer would briefly
  // show the game board before the fleet-building overlay appears.
  batch(() => {
    deps.applyGameState(deps.deserializeState(plan.state));
    deps.setState(plan.nextState);
  });
};

const applyErrorPlan = (
  deps: MessageHandlerDeps,
  plan: Extract<ClientMessagePlan, { kind: 'error' }>,
): void => {
  console.error('Server error:', plan.message);
  deps.trackEvent('server_error_received', {
    message: plan.message,
    code: plan.code,
  });
  const displayMessage = getServerErrorToastMessage(plan.message, plan.code);
  deps.ui.overlay.showToast(displayMessage, 'error');
  if (deps.ctx.state === 'connecting') {
    deps.setState('menu');
  }
};

const applyActionRejectedPlan = (
  deps: MessageHandlerDeps,
  plan: Extract<ClientMessagePlan, { kind: 'actionRejected' }>,
): void => {
  deps.trackEvent('action_rejected_received', {
    reason: plan.reason,
    submitterPlayerId: plan.submitterPlayerId,
    expectedTurn: plan.expected.turn,
    expectedPhase: plan.expected.phase,
    actualTurn: plan.actual.turn,
    actualPhase: plan.actual.phase,
    activePlayer: plan.actual.activePlayer,
  });
  const hint =
    plan.reason === 'stalePhase' || plan.reason === 'staleTurn'
      ? TOAST.actionRejected.staleGame
      : plan.reason === 'duplicateIdempotencyKey'
        ? TOAST.actionRejected.duplicateIdempotencyKey
        : plan.reason === 'wrongActivePlayer'
          ? TOAST.actionRejected.wrongActivePlayer
          : plan.message;
  deps.ui.log.logText(hint, 'log-system');
};

const applyOpponentStatusPlan = (
  deps: MessageHandlerDeps,
  plan: Extract<ClientMessagePlan, { kind: 'opponentStatus' }>,
): void => {
  if (plan.status === 'disconnected' && plan.graceDeadlineMs) {
    setOpponentDisconnectDeadlineMs(deps.ctx, plan.graceDeadlineMs);
    return;
  }

  setOpponentDisconnectDeadlineMs(deps.ctx, null);
  if (plan.status === 'reconnected') {
    deps.ui.overlay.showToast(TOAST.reconnect.opponent, 'info');
  }
};

// Map a message-tree plan into the AuthoritativeUpdate shape the shared
// apply pipeline consumes. Kept narrow: no side effects, no deps access.
const toAuthoritativeUpdate = (
  ctxGameState: GameState | null,
  plan: Extract<
    ClientMessagePlan,
    {
      kind:
        | 'movementResult'
        | 'combatResult'
        | 'combatSingleResult'
        | 'stateUpdate'
        | 'gameOver';
    }
  >,
): AuthoritativeUpdate => {
  switch (plan.kind) {
    case 'movementResult':
      return {
        kind: 'movementResult',
        state: plan.state,
        movements: plan.movements,
        ordnanceMovements: plan.ordnanceMovements,
        events: plan.events,
      };
    case 'combatResult':
      return {
        kind: 'combatResult',
        previousState: must(ctxGameState),
        state: plan.state,
        results: plan.results,
        shouldContinue: plan.shouldTransition,
      };
    case 'combatSingleResult':
      return {
        kind: 'combatSingleResult',
        previousState: must(ctxGameState),
        state: plan.state,
        result: plan.result,
      };
    case 'stateUpdate':
      return {
        kind: 'stateUpdate',
        state: plan.state,
        shouldContinue: plan.shouldTransition,
        transferEvents: plan.transferEvents,
      };
    case 'gameOver':
      return {
        kind: 'gameOver',
        won: plan.won,
        reason: plan.reason,
      };
  }
};

export const handleServerMessage = (
  deps: MessageHandlerDeps,
  msg: S2C,
): void => {
  const plan = deriveClientMessagePlan(
    deps.ctx.state,
    deps.ctx.reconnectAttempts,
    deps.ctx.playerId,
    Date.now(),
    msg,
  );

  switch (plan.kind) {
    case 'welcome':
    case 'spectatorWelcome':
      applyWelcomePlan(deps, plan);
      return;
    case 'matchFound':
      playPhaseChange();
      return;
    case 'gameStart':
      applyGameStartPlan(deps, plan);
      return;
    case 'movementResult':
    case 'combatResult':
    case 'combatSingleResult':
    case 'stateUpdate':
    case 'gameOver': {
      if (plan.kind === 'gameOver') {
        setOpponentDisconnectDeadlineMs(deps.ctx, null);
      }
      const authDeps: AuthoritativeUpdateDeps = {
        getCurrentGameState: () => deps.ctx.gameState,
        applyGameState: deps.applyGameState,
        presentMovementResult: deps.presentMovementResult,
        presentCombatResults: deps.presentCombatResults,
        showGameOverOutcome: deps.showGameOverOutcome,
        onMovementResultComplete: deps.onAnimationComplete,
        onCombatResultComplete: deps.transitionToPhase,
        onCombatSingleResultComplete: deps.advanceToNextAttacker,
        onStateUpdateComplete: deps.transitionToPhase,
        logText: (text) => deps.ui.log.logText(text),
        deserializeState: deps.deserializeState,
      };
      applyAuthoritativeUpdate(
        authDeps,
        toAuthoritativeUpdate(deps.ctx.gameState, plan),
      );
      return;
    }
    case 'rematchPending':
      deps.ui.overlay.showRematchPending();
      return;
    case 'error':
      applyErrorPlan(deps, plan);
      return;
    case 'actionAccepted':
      deps.trackEvent('action_accepted_received', {
        guardStatus: plan.guardStatus,
        submitterPlayerId: plan.submitterPlayerId,
        expectedTurn: plan.expected.turn,
        expectedPhase: plan.expected.phase,
        actualTurn: plan.actual.turn,
        actualPhase: plan.actual.phase,
        activePlayer: plan.actual.activePlayer,
      });
      return;
    case 'actionRejected':
      applyActionRejectedPlan(deps, plan);
      return;
    case 'chat': {
      const isOwn = plan.playerId === deps.ctx.playerId;
      const label = isOwn ? 'You' : 'Opponent';
      deps.ui.log.logText(
        `${label}: ${plan.text}`,
        isOwn ? 'log-chat' : 'log-chat-opponent',
      );
      return;
    }
    case 'pong':
      if (plan.latencyMs !== null) {
        setLatencyMs(deps.ctx, plan.latencyMs);
      }
      return;
    case 'opponentStatus':
      applyOpponentStatusPlan(deps, plan);
      return;
  }
};
