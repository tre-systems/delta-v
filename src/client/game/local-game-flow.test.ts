import { describe, expect, it, vi } from 'vitest';

import type { CombatResult, GameState } from '../../shared/types/domain';
import type { LocalGameFlowDeps } from './local-game-flow';
import { handleLocalResolution } from './local-game-flow';

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
      attackerIds: ['attacker-1'],
      targetId: 'target-1',
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
});
