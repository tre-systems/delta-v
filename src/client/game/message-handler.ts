import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { RoomCode } from '../../shared/ids';
import {
  type CombatResult,
  ErrorCode,
  type GameState,
} from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playPhaseChange } from '../audio';
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
    deps.ui.overlay.showToast('Reconnected!', 'success');
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
  deps.applyGameState(deps.deserializeState(plan.state));
  deps.renderer.clearTrails();
  deps.ui.log.clear();
  deps.ui.log.setChatEnabled(true);
  deps.logScenarioBriefing();
  deps.setState(plan.nextState);
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

// Maps known error codes to user-friendly display messages.
// Codes not in this map fall through to the raw server message.
const ERROR_CODE_DISPLAY: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.INVALID_PHASE]: 'Action not available in this phase',
  [ErrorCode.NOT_YOUR_TURN]: "It's not your turn",
  [ErrorCode.INVALID_INPUT]: 'Invalid action \u2014 please try again',
  [ErrorCode.STATE_CONFLICT]: 'Action conflicts with current game state',
  [ErrorCode.RESOURCE_LIMIT]: 'Insufficient resources for this action',
  [ErrorCode.NOT_ALLOWED]: 'That action is not allowed right now',
  [ErrorCode.INVALID_SELECTION]: 'Invalid selection \u2014 please try again',
  [ErrorCode.INVALID_TARGET]: 'Invalid target for this action',
  [ErrorCode.INVALID_SHIP]: 'Invalid ship for this action',
  [ErrorCode.INVALID_PLAYER]: 'Invalid player',
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
  const displayMessage =
    (plan.code && ERROR_CODE_DISPLAY[plan.code]) || plan.message;
  deps.ui.overlay.showToast(displayMessage, 'error');
  if (deps.ctx.state === 'connecting') {
    deps.setState('menu');
  }
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
    deps.ui.overlay.showToast('Opponent reconnected', 'info');
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
