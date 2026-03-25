import { describe, expect, it, vi } from 'vitest';

import type { LocalGameFlowDeps } from './local-game-flow';
import { handleLocalResolution } from './local-game-flow';

describe('handleLocalResolution', () => {
  it('shows an error toast when the resolution is an engine error', () => {
    const showToast = vi.fn();
    const deps = {
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
      showToast,
    } as unknown as LocalGameFlowDeps;

    handleLocalResolution(
      deps,
      { kind: 'error', error: 'Not allowed' },
      vi.fn(),
      'Local test:',
    );

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Not allowed', 'error');
  });
});
