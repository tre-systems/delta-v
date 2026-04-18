import { describe, expect, it, vi } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import { runGameDoTurnTimeout } from './turn-timeout';

const map = buildSolarSystemMap();

const minimalPlayingState = {
  phase: 'astrogation',
  turnNumber: 2,
} as GameState;

const ordnanceTimeoutState = (): GameState => {
  const state = createGameOrThrow(
    SCENARIOS.biplanetary,
    buildSolarSystemMap(),
    asGameId('ttout1'),
    findBaseHex,
  );
  const activeShip = state.ships.find((s) => s.owner === state.activePlayer);
  const opposingShip = state.ships.find((s) => s.owner !== state.activePlayer);
  if (!activeShip || !opposingShip) throw new Error('ships');
  state.phase = 'ordnance';
  activeShip.position = { q: 4, r: 4 };
  activeShip.velocity = { dq: 0, dr: 0 };
  opposingShip.position = { q: 4, r: 4 };
  opposingShip.velocity = { dq: 0, dr: 0 };
  return state;
};

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

  it('passes lastTurnAutoPlayed to publishStateChange on successful timeout', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const storage = { delete: deleteFn } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);
    const publishStateChange = vi.fn().mockResolvedValue(undefined);
    const state = ordnanceTimeoutState();

    await runGameDoTurnTimeout({
      storage,
      map,
      getCurrentGameState: async () => state,
      getActionRng: async () => () => 0.5,
      getGameCode: async () => 'CODE',
      reportEngineError: vi.fn(),
      publishStateChange,
      rescheduleAlarm,
    });

    expect(publishStateChange).toHaveBeenCalledTimes(1);
    const [, , opts] = publishStateChange.mock.calls[0] as [
      unknown,
      unknown,
      { lastTurnAutoPlayed?: { seat: number; index: number; reason: string } },
    ];
    expect(opts.lastTurnAutoPlayed?.reason).toBe('timeout');
    expect(opts.lastTurnAutoPlayed?.seat).toBe(state.activePlayer);
    expect(typeof opts.lastTurnAutoPlayed?.index).toBe('number');
  });
});
