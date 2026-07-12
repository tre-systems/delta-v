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

const fleetBuildingTimeoutState = (): GameState =>
  createGameOrThrow(
    SCENARIOS.fleetAction,
    buildSolarSystemMap(),
    asGameId('ttoutf'),
    findBaseHex,
  );

const logisticsTimeoutState = (): GameState => {
  const state = createGameOrThrow(
    SCENARIOS.convoy,
    buildSolarSystemMap(),
    asGameId('ttoutl'),
    findBaseHex,
  );
  state.phase = 'logistics';
  return state;
};

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

  it('reports engine error and re-arms the timer when getActionRng throws', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const putFn = vi.fn().mockResolvedValue(undefined);
    const storage = {
      delete: deleteFn,
      put: putFn,
    } as unknown as DurableObjectStorage;
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
    // The timer must survive the error so the timeout retries instead of
    // leaving the match stalled until the inactivity reaper voids it.
    expect(putFn).toHaveBeenCalledWith('turnTimeoutAt', expect.any(Number));
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

  it('auto-readies an idle seat when fleet building times out', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const putFn = vi.fn().mockResolvedValue(undefined);
    const storage = {
      delete: deleteFn,
      put: putFn,
    } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);
    const publishStateChange = vi.fn().mockResolvedValue(undefined);
    const state = fleetBuildingTimeoutState();

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
    const [nextState, , opts] = publishStateChange.mock.calls[0] as [
      GameState,
      unknown,
      { lastTurnAutoPlayed?: { seat: 0 | 1; index: number; reason: string } },
    ];
    expect(opts.lastTurnAutoPlayed?.reason).toBe('timeout');
    const seat = opts.lastTurnAutoPlayed?.seat;
    expect(seat).toBe(state.activePlayer);
    expect(seat === 0 || seat === 1).toBe(true);
    if (seat === 0 || seat === 1) {
      expect(nextState.players[seat].ready).toBe(true);
    }
  });

  it('auto-skips logistics when the phase times out', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const putFn = vi.fn().mockResolvedValue(undefined);
    const storage = {
      delete: deleteFn,
      put: putFn,
    } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);
    const publishStateChange = vi.fn().mockResolvedValue(undefined);
    const state = logisticsTimeoutState();

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
    const [nextState, , opts] = publishStateChange.mock.calls[0] as [
      GameState,
      unknown,
      { lastTurnAutoPlayed?: { seat: number; index: number; reason: string } },
    ];
    expect(opts.lastTurnAutoPlayed?.reason).toBe('timeout');
    expect(opts.lastTurnAutoPlayed?.seat).toBe(state.activePlayer);
    expect(nextState.phase).toBe('astrogation');
  });

  it('re-arms the turn timer when a live phase yields no outcome', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const putFn = vi.fn().mockResolvedValue(undefined);
    const storage = {
      delete: deleteFn,
      put: putFn,
    } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);
    const publishStateChange = vi.fn().mockResolvedValue(undefined);
    // Both seats already ready is unresolvable by the timeout automation; the
    // timer must be re-armed rather than silently dying.
    const state = fleetBuildingTimeoutState();
    state.players[0].ready = true;
    state.players[1].ready = true;

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

    expect(publishStateChange).not.toHaveBeenCalled();
    expect(putFn).toHaveBeenCalledWith('turnTimeoutAt', expect.any(Number));
    expect(rescheduleAlarm).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm the turn timer in the waiting phase', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const putFn = vi.fn().mockResolvedValue(undefined);
    const storage = {
      delete: deleteFn,
      put: putFn,
    } as unknown as DurableObjectStorage;
    const rescheduleAlarm = vi.fn().mockResolvedValue(undefined);

    await runGameDoTurnTimeout({
      storage,
      map,
      getCurrentGameState: async () =>
        ({ phase: 'waiting', turnNumber: 1 }) as GameState,
      getActionRng: async () => () => 0.5,
      getGameCode: async () => 'CODE',
      reportEngineError: vi.fn(),
      publishStateChange: vi.fn(),
      rescheduleAlarm,
    });

    expect(putFn).not.toHaveBeenCalled();
    expect(rescheduleAlarm).toHaveBeenCalledTimes(1);
  });
});
