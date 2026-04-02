import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { RoomCode } from '../../shared/ids';
import type { CombatResult, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playPhaseChange } from '../audio';
import {
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
    case 'spectatorWelcome':
    case 'welcome':
      applyWelcomePlan(deps, plan);
      break;
    case 'matchFound':
      playPhaseChange();
      break;
    case 'gameStart':
      applyGameStartPlan(deps, plan);
      break;
    case 'movementResult':
      applyAuthoritativeUpdate(createAuthoritativeUpdateDeps(deps), {
        kind: 'movementResult',
        state: plan.state,
        movements: plan.movements,
        ordnanceMovements: plan.ordnanceMovements,
        events: plan.events,
      });
      break;
    case 'combatResult':
      applyAuthoritativeUpdate(createAuthoritativeUpdateDeps(deps), {
        kind: 'combatResult',
        previousState: must(deps.ctx.gameState),
        state: plan.state,
        results: plan.results,
        shouldContinue: plan.shouldTransition,
      });
      break;
    case 'combatSingleResult':
      applyAuthoritativeUpdate(createAuthoritativeUpdateDeps(deps), {
        kind: 'combatSingleResult',
        previousState: must(deps.ctx.gameState),
        state: plan.state,
        result: plan.result,
      });
      break;
    case 'stateUpdate':
      applyAuthoritativeUpdate(createAuthoritativeUpdateDeps(deps), {
        kind: 'stateUpdate',
        state: plan.state,
        shouldContinue: plan.shouldTransition,
        transferEvents: plan.transferEvents,
      });
      break;
    case 'gameOver':
      setOpponentDisconnectDeadlineMs(deps.ctx, null);
      applyAuthoritativeUpdate(createAuthoritativeUpdateDeps(deps), {
        kind: 'gameOver',
        won: plan.won,
        reason: plan.reason,
      });
      break;
    case 'rematchPending':
      deps.ui.overlay.showRematchPending();
      break;
    case 'error':
      console.error('Server error:', plan.message);
      deps.trackEvent('server_error_received', {
        message: plan.message,
        code: plan.code,
      });
      deps.ui.overlay.showToast(plan.message, 'error');
      if (deps.ctx.state === 'connecting') {
        deps.setState('menu');
      }
      break;
    case 'chat': {
      const isOwn = plan.playerId === deps.ctx.playerId;
      const label = isOwn ? 'You' : 'Opponent';
      deps.ui.log.logText(
        `${label}: ${plan.text}`,
        isOwn ? 'log-chat' : 'log-chat-opponent',
      );
      break;
    }
    case 'pong':
      if (plan.latencyMs !== null) {
        setLatencyMs(deps.ctx, plan.latencyMs);
      }
      break;
    case 'opponentStatus':
      if (plan.status === 'disconnected' && plan.graceDeadlineMs) {
        setOpponentDisconnectDeadlineMs(deps.ctx, plan.graceDeadlineMs);
      } else {
        setOpponentDisconnectDeadlineMs(deps.ctx, null);
        if (plan.status === 'reconnected') {
          deps.ui.overlay.showToast('Opponent reconnected', 'info');
        }
      }
      break;
  }
};
