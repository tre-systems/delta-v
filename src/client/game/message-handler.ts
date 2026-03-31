import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { RoomCode } from '../../shared/ids';
import type { CombatResult, GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { playPhaseChange } from '../audio';
import { formatLogisticsTransferLogLines } from '../ui/formatters';
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

const presentCombatPlan = (
  deps: MessageHandlerDeps,
  state: GameState,
  results: CombatResult[],
): void => {
  deps.presentCombatResults(
    must(deps.ctx.gameState),
    deps.deserializeState(state),
    results,
  );
};

const logTransferEvents = (
  deps: MessageHandlerDeps,
  transferEvents: NonNullable<
    Extract<ClientMessagePlan, { kind: 'stateUpdate' }>['transferEvents']
  >,
  state: GameState,
): void => {
  for (const line of formatLogisticsTransferLogLines(
    transferEvents,
    state.ships,
  )) {
    deps.ui.log.logText(line);
  }
};

const applyStateUpdatePlan = (
  deps: MessageHandlerDeps,
  plan: Extract<ClientMessagePlan, { kind: 'stateUpdate' }>,
): void => {
  const nextState = deps.deserializeState(plan.state);

  if (plan.transferEvents?.length) {
    logTransferEvents(deps, plan.transferEvents, nextState);
  }

  deps.applyGameState(nextState);

  if (plan.shouldTransition) {
    deps.transitionToPhase();
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
    case 'combatResult':
      presentCombatPlan(deps, plan.state, plan.results);
      if (plan.shouldTransition) {
        deps.transitionToPhase();
      }
      break;
    case 'combatSingleResult':
      presentCombatPlan(deps, plan.state, [plan.result]);
      deps.advanceToNextAttacker();
      break;
    case 'stateUpdate':
      applyStateUpdatePlan(deps, plan);
      break;
    case 'gameOver':
      setOpponentDisconnectDeadlineMs(deps.ctx, null);
      deps.showGameOverOutcome(plan.won, plan.reason);
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
