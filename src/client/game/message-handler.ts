import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { RoomCode } from '../../shared/ids';
import type { CombatResult, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playPhaseChange } from '../audio';
import { SERVER_ERROR_USER_HINT } from '../messages/server-error-hints';
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
type ClientMessagePlanKind = ClientMessagePlan['kind'];
type ClientMessagePlanHandler<K extends ClientMessagePlanKind> = (
  deps: MessageHandlerDeps,
  plan: Extract<ClientMessagePlan, { kind: K }>,
) => void;
type ClientMessagePlanHandlers = {
  [K in ClientMessagePlanKind]: ClientMessagePlanHandler<K>;
};

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

const createAuthoritativeUpdateDeps = (
  deps: MessageHandlerDeps,
): AuthoritativeUpdateDeps => ({
  getCurrentGameState: () => deps.ctx.gameState,
  applyGameState: (state) => deps.applyGameState(state),
  presentMovementResult: (
    state,
    movements,
    ordnanceMovements,
    events,
    onComplete,
  ) =>
    deps.presentMovementResult(
      state,
      movements,
      ordnanceMovements,
      events,
      onComplete,
    ),
  presentCombatResults: (previousState, state, results, resetCombat) =>
    deps.presentCombatResults(previousState, state, results, resetCombat),
  showGameOverOutcome: (won, reason) => deps.showGameOverOutcome(won, reason),
  onMovementResultComplete: () => deps.onAnimationComplete(),
  onCombatResultComplete: () => deps.transitionToPhase(),
  onCombatSingleResultComplete: () => deps.advanceToNextAttacker(),
  onStateUpdateComplete: () => deps.transitionToPhase(),
  logText: (text) => deps.ui.log.logText(text),
  deserializeState: (raw) => deps.deserializeState(raw),
});

const applyAuthoritativePlan = (
  deps: MessageHandlerDeps,
  update: AuthoritativeUpdate,
): void => {
  applyAuthoritativeUpdate(createAuthoritativeUpdateDeps(deps), update);
};

const applyMatchFoundPlan = (): void => {
  playPhaseChange();
};

const applyMovementResultPlan: ClientMessagePlanHandler<'movementResult'> = (
  deps,
  plan,
): void => {
  applyAuthoritativePlan(deps, {
    kind: 'movementResult',
    state: plan.state,
    movements: plan.movements,
    ordnanceMovements: plan.ordnanceMovements,
    events: plan.events,
  });
};

const applyCombatResultPlan: ClientMessagePlanHandler<'combatResult'> = (
  deps,
  plan,
): void => {
  applyAuthoritativePlan(deps, {
    kind: 'combatResult',
    previousState: must(deps.ctx.gameState),
    state: plan.state,
    results: plan.results,
    shouldContinue: plan.shouldTransition,
  });
};

const applyCombatSingleResultPlan: ClientMessagePlanHandler<
  'combatSingleResult'
> = (deps, plan): void => {
  applyAuthoritativePlan(deps, {
    kind: 'combatSingleResult',
    previousState: must(deps.ctx.gameState),
    state: plan.state,
    result: plan.result,
  });
};

const applyStateUpdatePlan: ClientMessagePlanHandler<'stateUpdate'> = (
  deps,
  plan,
): void => {
  applyAuthoritativePlan(deps, {
    kind: 'stateUpdate',
    state: plan.state,
    shouldContinue: plan.shouldTransition,
    transferEvents: plan.transferEvents,
  });
};

const applyGameOverPlan: ClientMessagePlanHandler<'gameOver'> = (
  deps,
  plan,
): void => {
  setOpponentDisconnectDeadlineMs(deps.ctx, null);
  applyAuthoritativePlan(deps, {
    kind: 'gameOver',
    won: plan.won,
    reason: plan.reason,
  });
};

const applyRematchPendingPlan: ClientMessagePlanHandler<'rematchPending'> = (
  deps,
): void => {
  deps.ui.overlay.showRematchPending();
};

const applyErrorPlan: ClientMessagePlanHandler<'error'> = (
  deps,
  plan,
): void => {
  console.error('Server error:', plan.message);
  deps.trackEvent('server_error_received', {
    message: plan.message,
    code: plan.code,
  });
  const friendlyMessage = plan.code && SERVER_ERROR_USER_HINT[plan.code];
  const displayMessage = friendlyMessage
    ? `${friendlyMessage}: ${plan.message}`
    : plan.message;
  deps.ui.overlay.showToast(displayMessage, 'error');
  if (deps.ctx.state === 'connecting') {
    deps.setState('menu');
  }
};

const applyActionRejectedPlan: ClientMessagePlanHandler<'actionRejected'> = (
  deps,
  plan,
): void => {
  deps.trackEvent('action_rejected_received', {
    reason: plan.reason,
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
  deps.ui.overlay.showToast(hint, 'info');
};

const applyChatPlan: ClientMessagePlanHandler<'chat'> = (deps, plan): void => {
  const isOwn = plan.playerId === deps.ctx.playerId;
  const label = isOwn ? 'You' : 'Opponent';
  deps.ui.log.logText(
    `${label}: ${plan.text}`,
    isOwn ? 'log-chat' : 'log-chat-opponent',
  );
};

const applyPongPlan: ClientMessagePlanHandler<'pong'> = (deps, plan): void => {
  if (plan.latencyMs !== null) {
    setLatencyMs(deps.ctx, plan.latencyMs);
  }
};

const applyOpponentStatusPlan: ClientMessagePlanHandler<'opponentStatus'> = (
  deps,
  plan,
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

const clientMessagePlanHandlers = {
  welcome: applyWelcomePlan,
  spectatorWelcome: applyWelcomePlan,
  matchFound: applyMatchFoundPlan,
  gameStart: applyGameStartPlan,
  movementResult: applyMovementResultPlan,
  combatResult: applyCombatResultPlan,
  combatSingleResult: applyCombatSingleResultPlan,
  stateUpdate: applyStateUpdatePlan,
  gameOver: applyGameOverPlan,
  rematchPending: applyRematchPendingPlan,
  error: applyErrorPlan,
  actionRejected: applyActionRejectedPlan,
  chat: applyChatPlan,
  pong: applyPongPlan,
  opponentStatus: applyOpponentStatusPlan,
} satisfies ClientMessagePlanHandlers;

const dispatchClientMessagePlan = (
  deps: MessageHandlerDeps,
  plan: ClientMessagePlan,
): void => {
  const handler = clientMessagePlanHandlers[plan.kind] as (
    deps: MessageHandlerDeps,
    plan: ClientMessagePlan,
  ) => void;
  handler(deps, plan);
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
  dispatchClientMessagePlan(deps, plan);
};
