import { describe, expect, it, vi } from 'vitest';

import { buildSolarSystemMap } from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import { runGameDoTurnTimeout } from './turn-timeout';

const map = buildSolarSystemMap();

const minimalPlayingState = {
  phase: 'astrogation',
  turnNumber: 2,
} as GameState;

describe('runGameDoTurnTimeout', () => {
  it('clears turnTimeoutAt and reschedules when there is no game state', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const storage = { delete: deleteFn } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);

    await runGameDoTurnTimeout({
      storage,
      map,
      getCurrentGameState: async () => null,
      getActionRng: async () => Math.random,
      getGameCode: async () => 'CODE',
      reportEngineError: vi.fn(),
      publishStateChange: vi.fn(),
      rescheduleAlarm,
    });

    expect(deleteFn).toHaveBeenCalledWith('turnTimeoutAt');
    expect(rescheduleAlarm).toHaveBeenCalledTimes(1);
  });

  it('clears turnTimeoutAt and reschedules when phase is gameOver', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const storage = { delete: deleteFn } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);

    await runGameDoTurnTimeout({
      storage,
      map,
      getCurrentGameState: async () =>
        ({ phase: 'gameOver', turnNumber: 1 }) as GameState,
      getActionRng: async () => Math.random,
      getGameCode: async () => 'CODE',
      reportEngineError: vi.fn(),
      publishStateChange: vi.fn(),
      rescheduleAlarm,
    });

    expect(deleteFn).toHaveBeenCalledWith('turnTimeoutAt');
    expect(rescheduleAlarm).toHaveBeenCalledTimes(1);
  });

  it('reports engine error and reschedules when getActionRng throws', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const storage = { delete: deleteFn } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);
    const reportEngineError = vi.fn();

    await runGameDoTurnTimeout({
      storage,
      map,
      getCurrentGameState: async () => minimalPlayingState,
      getActionRng: async () => {
        throw new Error('rng fail');
      },
      getGameCode: async () => 'XYZ',
      reportEngineError,
      publishStateChange: vi.fn(),
      rescheduleAlarm,
    });

    expect(reportEngineError).toHaveBeenCalled();
    expect(rescheduleAlarm).toHaveBeenCalledTimes(1);
  });
});
