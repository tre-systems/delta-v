import { describe, expect, it, vi } from 'vitest';

import { createTestState } from '../../shared/test-helpers';
import { ErrorCode } from '../../shared/types/domain';
import { type RunActionDeps, runGameStateAction } from './actions';

const createDeps = (
  state = createTestState(),
): RunActionDeps & {
  sendActionRejected: ReturnType<typeof vi.fn>;
  sendError: ReturnType<typeof vi.fn>;
} => ({
  getCurrentGameState: async () => state,
  getGameCode: async () => 'TEST1',
  reportEngineError: vi.fn(),
  sendError: vi.fn<RunActionDeps['sendError']>(),
  sendActionAccepted: vi.fn(),
  sendActionRejected: vi.fn<RunActionDeps['sendActionRejected']>(),
});

describe('runGameStateAction', () => {
  it('surfaces engine validation failures as actionRejected', async () => {
    const state = createTestState({
      turnNumber: 3,
      phase: 'combat',
      activePlayer: 1,
    });
    const deps = createDeps(state);

    await runGameStateAction(
      deps,
      async () => ({
        error: {
          code: ErrorCode.INVALID_TARGET,
          message: 'Target ship not found',
        },
      }),
      async () => {},
    );

    expect(deps.sendActionRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'actionRejected',
        reason: 'invalidTarget',
        message: 'Target ship not found',
        actual: {
          turn: 3,
          phase: 'combat',
          activePlayer: 1,
        },
        state,
      }),
    );
    expect(deps.sendError).not.toHaveBeenCalled();
  });

  it('keeps non-actionable room/runtime errors on the error channel', async () => {
    const deps = createDeps();

    await runGameStateAction(
      deps,
      async () => ({
        error: {
          code: ErrorCode.GAME_COMPLETED,
          message: 'Game already over',
        },
      }),
      async () => {},
    );

    expect(deps.sendActionRejected).not.toHaveBeenCalled();
    expect(deps.sendError).toHaveBeenCalledWith(
      'Game already over',
      ErrorCode.GAME_COMPLETED,
    );
  });
});
