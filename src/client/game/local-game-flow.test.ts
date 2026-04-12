import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ai-flow', () => ({
  deriveAIActionPlan: vi.fn(),
}));

import { must } from '../../shared/assert';
import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId, asShipId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { CombatResult, GameState } from '../../shared/types/domain';
import { deriveAIActionPlan } from './ai-flow';
import type { LocalGameFlowDeps } from './local-game-flow';
import { handleLocalResolution, runAITurn } from './local-game-flow';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const createDeps = (
  overrides: Partial<LocalGameFlowDeps> = {},
): LocalGameFlowDeps => {
  return {
    getGameState: vi.fn(() => null),
    getPlayerId: vi.fn(() => 0),
    getMap: vi.fn(),
    getAIDifficulty: vi.fn(),
    applyGameState: vi.fn(),
    presentMovementResult: vi.fn(),
    presentCombatResults: vi.fn(),
    showGameOverOutcome: vi.fn(),
    transitionToPhase: vi.fn(),
    logText: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  } as unknown as LocalGameFlowDeps;
};

describe('handleLocalResolution', () => {
  it('shows an error toast when the resolution is an engine error', () => {
    const showToast = vi.fn();
    const deps = createDeps({ showToast });

    handleLocalResolution(
      deps,
      { kind: 'error', error: 'Not allowed' },
      vi.fn(),
      'Local test:',
    );

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Not allowed', 'error');
  });

  it('presents a single combat result and advances without resetting combat', () => {
    const presentCombatResults = vi.fn();
    const onContinue = vi.fn();
    const previousState = {
      phase: 'combat',
    } as unknown as GameState;
    const state = {
      phase: 'combat',
    } as unknown as GameState;
    const result: CombatResult = {
      attackerIds: [asShipId('attacker-1')],
      targetId: asShipId('target-1'),
      targetType: 'ship',
      attackType: 'gun',
      odds: '1:1',
      attackStrength: 1,
      defendStrength: 1,
      rangeMod: 0,
      velocityMod: 0,
      dieRoll: 4,
      modifiedRoll: 4,
      damageType: 'disabled',
      disabledTurns: 1,
      counterattack: null,
    };
    const deps = createDeps({
      getGameState: vi.fn(() => state),
      presentCombatResults,
    });

    handleLocalResolution(
      deps,
      {
        kind: 'combatSingle',
        previousState,
        state,
        result,
      },
      onContinue,
      'Local test:',
    );

    expect(presentCombatResults).toHaveBeenCalledWith(
      previousState,
      state,
      [result],
      false,
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows game over instead of advancing when single combat ends the game', () => {
    const presentCombatResults = vi.fn();
    const showGameOverOutcome = vi.fn();
    const onContinue = vi.fn();
    const previousState = {
      phase: 'combat',
    } as unknown as GameState;
    const gameOverState = {
      phase: 'gameOver',
      outcome: { winner: 0, reason: 'Fleet eliminated!' },
    } as unknown as GameState;
    const result: CombatResult = {
      attackerIds: [asShipId('attacker-1')],
      targetId: asShipId('target-1'),
      targetType: 'ship',
      attackType: 'gun',
      odds: '1:1',
      attackStrength: 1,
      defendStrength: 1,
      rangeMod: 0,
      velocityMod: 0,
      dieRoll: 6,
      modifiedRoll: 6,
      damageType: 'eliminated',
      disabledTurns: 0,
      counterattack: null,
    };
    const deps = createDeps({
      getGameState: vi.fn(() => gameOverState),
      presentCombatResults,
      showGameOverOutcome,
    });

    handleLocalResolution(
      deps,
      {
        kind: 'combatSingle',
        previousState,
        state: gameOverState,
        result,
      },
      onContinue,
      'Local test:',
    );

    expect(presentCombatResults).toHaveBeenCalledWith(
      previousState,
      gameOverState,
      [result],
      false,
    );
    expect(showGameOverOutcome).toHaveBeenCalledWith(true, 'Fleet eliminated!');
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('logs logistics transfer events before continuing', () => {
    const applyGameState = vi.fn();
    const logText = vi.fn();
    const onContinue = vi.fn();
    const state = {
      phase: 'logistics',
      ships: [
        { id: 'ship-a', type: 'packet' },
        { id: 'ship-b', type: 'packet' },
      ],
    } as unknown as GameState;
    const deps = createDeps({
      getGameState: vi.fn(() => state),
      applyGameState,
      logText,
    });

    handleLocalResolution(
      deps,
      {
        kind: 'logistics',
        state,
        engineEvents: [
          {
            type: 'fuelTransferred',
            fromShipId: asShipId('ship-a'),
            toShipId: asShipId('ship-b'),
            amount: 2,
          },
        ],
      },
      onContinue,
      'Local test:',
    );

    expect(logText).toHaveBeenCalledTimes(1);
    expect(logText.mock.calls[0][0]).toContain('Transferred 2 fuel');
    expect(applyGameState).toHaveBeenCalledWith(state);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('runAITurn', () => {
  it('returns after an AI ordnance resolution error instead of hanging', async () => {
    vi.useFakeTimers();
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('AI-ERROR'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((ship) => ship.owner === 1));
    state.phase = 'ordnance';
    state.activePlayer = 1;
    aiShip.lifecycle = 'active';
    aiShip.resuppliedThisTurn = true;

    vi.mocked(deriveAIActionPlan).mockReturnValue({
      kind: 'ordnance',
      aiPlayer: 1,
      launches: [
        {
          shipId: aiShip.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      logEntries: [],
      skip: false,
      errorPrefix: 'AI ordnance error:',
    });

    const showToast = vi.fn();
    const deps = createDeps({
      getGameState: vi.fn(() => state),
      getMap: vi.fn(() => map),
      getAIDifficulty: vi.fn(() => 'normal' as const),
      showToast,
    });

    const turnPromise = runAITurn(deps);
    await vi.advanceTimersByTimeAsync(500);
    await expect(turnPromise).resolves.toBeUndefined();
    expect(showToast).toHaveBeenCalledWith(
      'Ships cannot launch ordnance during a turn in which they resupply',
      'error',
    );
  });
});
