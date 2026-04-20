import { describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  handleServerMessage,
  type MessageHandlerDeps,
} from './message-handler';
import { stubClientSession } from './session-model';

const createDeps = (): MessageHandlerDeps => {
  const state = createGameOrThrow(
    SCENARIOS.biplanetary,
    buildSolarSystemMap(),
    asGameId('MSGTEST'),
    findBaseHex,
    undefined,
    'biplanetary',
  );
  state.turnNumber = 5;
  state.phase = 'ordnance';
  state.activePlayer = 0;

  return {
    ctx: stubClientSession({
      state: 'playing_ordnance',
      playerId: 0,
      reconnectAttempts: 0,
      latencyMs: -1,
      gameState: state,
    }),
    setState: vi.fn(),
    applyGameState: vi.fn(),
    transitionToPhase: vi.fn(),
    presentMovementResult: vi.fn(),
    presentCombatResults: vi.fn(),
    showGameOverOutcome: vi.fn(),
    advanceToNextAttacker: vi.fn(),
    storePlayerToken: vi.fn(),
    resetTurnTelemetry: vi.fn(),
    onAnimationComplete: vi.fn(),
    logScenarioBriefing: vi.fn(),
    trackEvent: vi.fn(),
    deserializeState: (raw) => raw,
    renderer: {
      clearTrails: vi.fn(),
    },
    ui: {
      log: {
        logText: vi.fn(),
        setChatEnabled: vi.fn(),
        clear: vi.fn(),
      },
      overlay: {
        showToast: vi.fn(),
        hideGameOver: vi.fn(),
        showRematchPending: vi.fn(),
      },
    },
  };
};

describe('message-handler', () => {
  it('logs structured actionRejected hints instead of showing info toasts', () => {
    const deps = createDeps();
    const state = deps.ctx.gameState;

    if (!state) {
      throw new Error('expected game state');
    }

    handleServerMessage(deps, {
      type: 'actionRejected',
      reason: 'stalePhase',
      message: 'expected phase astrogation but server is in ordnance',
      submitterPlayerId: 0,
      expected: { turn: 4, phase: 'astrogation' },
      actual: {
        turn: 5,
        phase: 'ordnance',
        activePlayer: 0,
      },
      state,
    });

    expect(deps.ui.log.logText).toHaveBeenCalledWith(
      'The game moved on before that action could apply.',
      'log-system',
    );
    expect(deps.ui.overlay.showToast).not.toHaveBeenCalled();
  });
});
