import type { MovementResult } from '../../shared/engine/game-engine';
import type { CombatResult, GameState, S2C } from '../../shared/types';
import { playPhaseChange } from '../audio';
import { deriveClientMessagePlan } from './messages';
import type { ClientState } from './phase';

export interface MessageHandlerDeps {
  readonly ctx: {
    state: ClientState;
    playerId: number;
    gameCode: string | null;
    inviteLink: string | null;
    reconnectAttempts: number;
    latencyMs: number;
    gameState: GameState | null;
  };
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
  presentCombatResults: (previousState: GameState, state: GameState, results: CombatResult[]) => void;
  showGameOverOutcome: (won: boolean, reason: string) => void;
  storePlayerToken: (code: string, token: string) => void;
  onAnimationComplete: () => void;
  logScenarioBriefing: () => void;
  deserializeState: (raw: GameState) => GameState;
  renderer: {
    setPlayerId: (id: number) => void;
    clearTrails: () => void;
  };
  ui: {
    showToast: (message: string, type: 'error' | 'info' | 'success') => void;
    hideReconnecting: () => void;
    setPlayerId: (id: number) => void;
    clearLog: () => void;
    showRematchPending: () => void;
    showGameOver: (won: boolean, reason: string) => void;
    updateLatency: (ms: number) => void;
  };
}

export const handleServerMessage = (deps: MessageHandlerDeps, msg: S2C): void => {
  const plan = deriveClientMessagePlan(deps.ctx.state, deps.ctx.reconnectAttempts, deps.ctx.playerId, Date.now(), msg);
  switch (plan.kind) {
    case 'welcome': {
      deps.ctx.playerId = plan.playerId;
      deps.ctx.gameCode = plan.code;
      deps.storePlayerToken(plan.code, plan.playerToken);
      if (plan.clearInviteLink) {
        deps.ctx.inviteLink = null;
      }
      if (plan.showReconnectToast) {
        deps.ui.hideReconnecting();
        deps.ui.showToast('Reconnected!', 'success');
      }
      deps.ctx.reconnectAttempts = 0;
      deps.renderer.setPlayerId(plan.playerId);
      deps.ui.setPlayerId(plan.playerId);
      if (plan.nextState) {
        deps.setState(plan.nextState);
      }
      break;
    }

    case 'matchFound':
      playPhaseChange();
      break;

    case 'gameStart':
      deps.applyGameState(deps.deserializeState(plan.state));
      deps.renderer.clearTrails();
      deps.ui.clearLog();
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
      deps.presentCombatResults(previousState!, deps.deserializeState(plan.state), plan.results);
      if (plan.shouldTransition) {
        deps.transitionToPhase();
      }
      break;
    }

    case 'stateUpdate':
      deps.applyGameState(deps.deserializeState(plan.state));
      if (plan.shouldTransition) {
        deps.transitionToPhase();
      }
      break;

    case 'gameOver':
      deps.showGameOverOutcome(plan.won, plan.reason);
      break;

    case 'rematchPending':
      deps.ui.showRematchPending();
      break;

    case 'opponentDisconnected':
      deps.setState(plan.nextState);
      deps.ui.showGameOver(plan.won, plan.reason);
      break;

    case 'error':
      console.error('Server error:', plan.message);
      deps.ui.showToast(plan.message, 'error');
      break;

    case 'pong':
      if (plan.latencyMs !== null) {
        deps.ctx.latencyMs = plan.latencyMs;
        deps.ui.updateLatency(deps.ctx.latencyMs);
      }
      break;
  }
};
