import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { CombatResult, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playPhaseChange } from '../audio';
import { formatLogisticsTransferLogLines } from '../ui/formatters';
import {
  applyWelcomeSession,
  setLatencyMs,
  setOpponentDisconnectDeadlineMs,
} from './client-context-store';
import { deriveClientMessagePlan } from './messages';
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
  ) => void;
  showGameOverOutcome: (won: boolean, reason: string) => void;
  advanceToNextAttacker: () => void;
  storePlayerToken: (code: string, token: string) => void;
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
    case 'spectatorWelcome': {
      const reconnectAttempts = deps.ctx.reconnectAttempts;
      applyWelcomeSession(deps.ctx, -1, plan.code);

      if (plan.showReconnectToast) {
        deps.trackEvent('reconnect_succeeded', {
          attempts: reconnectAttempts,
        });
        deps.ui.overlay.showToast('Reconnected!', 'success');
      } else if (deps.ctx.state === 'connecting') {
        deps.trackEvent('spectate_join_succeeded', {});
      }

      if (plan.nextState) {
        deps.setState(plan.nextState);
      }
      break;
    }
    case 'welcome': {
      const reconnectAttempts = deps.ctx.reconnectAttempts;
      applyWelcomeSession(deps.ctx, plan.playerId, plan.code);
      deps.storePlayerToken(plan.code, plan.playerToken);

      if (plan.showReconnectToast) {
        deps.trackEvent('reconnect_succeeded', {
          attempts: reconnectAttempts,
        });
        deps.ui.overlay.showToast('Reconnected!', 'success');
      } else if (deps.ctx.state === 'connecting') {
        deps.trackEvent('join_game_succeeded', {});
      }

      if (plan.nextState) {
        deps.setState(plan.nextState);
      }
      break;
    }
    case 'matchFound':
      playPhaseChange();
      break;
    case 'gameStart':
      deps.ui.overlay.hideGameOver();
      deps.resetTurnTelemetry();
      deps.applyGameState(deps.deserializeState(plan.state));
      deps.renderer.clearTrails();
      deps.ui.log.clear();
      deps.ui.log.setChatEnabled(true);
      deps.logScenarioBriefing();
      deps.setState(plan.nextState);
      break;
    case 'movementResult':
      deps.presentMovementResult(
        deps.deserializeState(plan.state),
        plan.movements,
        plan.ordnanceMovements,
        plan.events,
        () => {
          deps.onAnimationComplete();
        },
      );
      break;
    case 'combatResult': {
      const previousState = deps.ctx.gameState;
      deps.presentCombatResults(
        must(previousState),
        deps.deserializeState(plan.state),
        plan.results,
      );

      if (plan.shouldTransition) {
        deps.transitionToPhase();
      }
      break;
    }
    case 'combatSingleResult': {
      const previousCombatState = deps.ctx.gameState;
      deps.presentCombatResults(
        must(previousCombatState),
        deps.deserializeState(plan.state),
        [plan.result],
      );
      deps.advanceToNextAttacker();
      break;
    }
    case 'stateUpdate': {
      const nextState = deps.deserializeState(plan.state);
      if (plan.transferEvents?.length) {
        for (const line of formatLogisticsTransferLogLines(
          plan.transferEvents,
          nextState.ships,
        )) {
          deps.ui.log.logText(line);
        }
      }
      deps.applyGameState(nextState);

      if (plan.shouldTransition) {
        deps.transitionToPhase();
      }
      break;
    }
    case 'gameOver':
      setOpponentDisconnectDeadlineMs(deps.ctx, null);
      deps.showGameOverOutcome(plan.won, plan.reason);
      break;
    case 'rematchPending':
      deps.ui.overlay.showRematchPending();
      break;
    case 'error':
      console.error('Server error:', plan.message);
      deps.ui.overlay.showToast(plan.message, 'error');
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
