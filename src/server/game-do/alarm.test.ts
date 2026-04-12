import { describe, expect, it, vi } from 'vitest';

import { buildSolarSystemMap } from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import { runGameDoAlarm } from './alarm';

const scheduleArchiveCompletedMatchMock = vi.hoisted(() =>
  vi.fn(() => Promise.resolve()),
);

vi.mock('./match-archive', () => ({
  scheduleArchiveCompletedMatch: scheduleArchiveCompletedMatchMock,
}));

const map = buildSolarSystemMap();

type AlarmParts = ReturnType<typeof minimalAlarmDeps>;

const minimalAlarmDeps = () => {
  const get = vi.fn().mockResolvedValue(undefined);
  const storage = { get } as unknown as DurableObjectStorage;
  return {
    storage,
    get,
    waitUntil: vi.fn(),
    getWebSockets: () => [] as WebSocket[],
    map,
    getCurrentGameState: vi.fn().mockResolvedValue(null),
    getGameCode: vi.fn().mockResolvedValue('CODE'),
    getActionRng: vi.fn().mockResolvedValue(Math.random),
    clearDisconnectMarker: vi.fn().mockResolvedValue(undefined),
    rescheduleAlarm: vi.fn().mockResolvedValue(undefined),
    publishStateChange: vi.fn().mockResolvedValue(undefined),
    reportEngineError: vi.fn(),
    reportGameAbandoned: vi.fn(),
    archiveRoomState: vi.fn().mockResolvedValue(undefined),
    env: { DB: {} as D1Database },
  };
};

const runAlarm = async (
  d: AlarmParts,
  overrides: {
    now: number;
    getWebSockets?: () => WebSocket[];
    env?: AlarmParts['env'] & { MATCH_ARCHIVE?: R2Bucket };
    getCurrentGameState?: () => Promise<GameState | null>;
  },
) => {
  await runGameDoAlarm({
    now: overrides.now,
    storage: d.storage,
    env: overrides.env ?? d.env,
    waitUntil: d.waitUntil,
    getWebSockets: overrides.getWebSockets ?? d.getWebSockets,
    map: d.map,
    getCurrentGameState: overrides.getCurrentGameState ?? d.getCurrentGameState,
    getGameCode: d.getGameCode,
    getActionRng: d.getActionRng,
    clearDisconnectMarker: d.clearDisconnectMarker,
    rescheduleAlarm: d.rescheduleAlarm,
    publishStateChange: d.publishStateChange,
    reportEngineError: d.reportEngineError,
    reportGameAbandoned: d.reportGameAbandoned,
    archiveRoomState: d.archiveRoomState,
  });
};

describe('runGameDoAlarm', () => {
  it('reschedules when no alarm window has fired', async () => {
    const d = minimalAlarmDeps();
    await runAlarm(d, { now: 10_000 });
    expect(d.rescheduleAlarm).toHaveBeenCalledTimes(1);
    expect(d.clearDisconnectMarker).not.toHaveBeenCalled();
    expect(d.publishStateChange).not.toHaveBeenCalled();
  });

  it('clears disconnect marker and reschedules when disconnect fired but there is no live game', async () => {
    const d = minimalAlarmDeps();
    d.get.mockImplementation(async (key: string) => {
      if (key === 'disconnectedPlayer') return 0;
      if (key === 'disconnectAt') return 1000;
      return undefined;
    });
    await runAlarm(d, { now: 50_000 });
    expect(d.clearDisconnectMarker).toHaveBeenCalledTimes(1);
    expect(d.rescheduleAlarm).toHaveBeenCalledTimes(1);
    expect(d.publishStateChange).not.toHaveBeenCalled();
  });

  it('publishes game over when disconnect grace expires with an active game', async () => {
    const d = minimalAlarmDeps();
    d.get.mockImplementation(async (key: string) => {
      if (key === 'disconnectedPlayer') return 0;
      if (key === 'disconnectAt') return 1000;
      return undefined;
    });
    const gameState = {
      phase: 'astrogation',
      turnNumber: 3,
      outcome: null,
    } as GameState;
    d.getCurrentGameState = vi.fn().mockResolvedValue(gameState);

    await runAlarm(d, { now: 50_000 });

    expect(d.clearDisconnectMarker).toHaveBeenCalledTimes(1);
    expect(d.publishStateChange).toHaveBeenCalledTimes(1);
    const [published] = d.publishStateChange.mock.calls;
    expect(published[0].phase).toBe('gameOver');
    expect(published[0].outcome?.winner).toBe(1);
    expect(published[2]?.events?.[0]).toMatchObject({
      type: 'gameOver',
      winner: 1,
    });
  });

  it('closes all sockets and archives room on inactivity timeout', async () => {
    const d = minimalAlarmDeps();
    d.get.mockImplementation(async (key: string) => {
      if (key === 'inactivityAt') return 1000;
      return undefined;
    });
    const closeA = vi.fn();
    const closeB = vi.fn();
    const sockets = [
      { close: closeA } as unknown as WebSocket,
      { close: closeB } as unknown as WebSocket,
    ];

    await runAlarm(d, {
      now: 20_000,
      getWebSockets: () => sockets,
    });

    expect(closeA).toHaveBeenCalledWith(1000, 'Inactivity timeout');
    expect(closeB).toHaveBeenCalledWith(1000, 'Inactivity timeout');
    expect(d.archiveRoomState).toHaveBeenCalledTimes(1);
    expect(d.rescheduleAlarm).not.toHaveBeenCalled();
    expect(scheduleArchiveCompletedMatchMock).not.toHaveBeenCalled();
  });

  it('schedules match archive on inactivity when MATCH_ARCHIVE is set', async () => {
    scheduleArchiveCompletedMatchMock.mockClear();
    const d = minimalAlarmDeps();
    d.get.mockImplementation(async (key: string) => {
      if (key === 'inactivityAt') return 500;
      return undefined;
    });
    const gameState = { phase: 'astrogation', turnNumber: 1 } as GameState;
    d.getCurrentGameState = vi.fn().mockResolvedValue(gameState);
    const bucket = {} as R2Bucket;

    await runAlarm(d, {
      now: 10_000,
      getWebSockets: () => [],
      env: { ...d.env, MATCH_ARCHIVE: bucket },
    });

    expect(scheduleArchiveCompletedMatchMock).toHaveBeenCalledWith(
      {
        storage: d.storage,
        r2: bucket,
        db: d.env.DB,
        waitUntil: d.waitUntil,
      },
      gameState,
      'CODE',
    );
    expect(d.archiveRoomState).toHaveBeenCalledTimes(1);
  });

  describe('error handling', () => {
    it('reschedules when publishStateChange throws during disconnectExpired', async () => {
      const d = minimalAlarmDeps();
      d.get.mockImplementation(async (key: string) => {
        if (key === 'disconnectedPlayer') return 0;
        if (key === 'disconnectAt') return 1000;
        return undefined;
      });
      const gameState = {
        phase: 'astrogation',
        turnNumber: 3,
        outcome: null,
      } as GameState;
      d.getCurrentGameState = vi.fn().mockResolvedValue(gameState);
      d.publishStateChange.mockRejectedValueOnce(new Error('publish failed'));

      await runAlarm(d, { now: 50_000 });

      expect(d.rescheduleAlarm).toHaveBeenCalledTimes(1);
    });

    it('reschedules when clearDisconnectMarker throws during disconnectExpired', async () => {
      const d = minimalAlarmDeps();
      d.get.mockImplementation(async (key: string) => {
        if (key === 'disconnectedPlayer') return 0;
        if (key === 'disconnectAt') return 1000;
        return undefined;
      });
      d.clearDisconnectMarker.mockRejectedValueOnce(
        new Error('clear marker failed'),
      );

      await runAlarm(d, { now: 50_000 });

      expect(d.rescheduleAlarm).toHaveBeenCalledTimes(1);
    });

    it('reschedules when archiveRoomState throws during inactivityTimeout', async () => {
      const d = minimalAlarmDeps();
      d.get.mockImplementation(async (key: string) => {
        if (key === 'inactivityAt') return 1000;
        return undefined;
      });
      d.archiveRoomState.mockRejectedValueOnce(new Error('archive failed'));

      await runAlarm(d, { now: 20_000 });

      expect(d.rescheduleAlarm).toHaveBeenCalledTimes(1);
    });

    it('does not throw when both the alarm handler and reschedule fail', async () => {
      const d = minimalAlarmDeps();
      d.get.mockImplementation(async (key: string) => {
        if (key === 'disconnectedPlayer') return 0;
        if (key === 'disconnectAt') return 1000;
        return undefined;
      });
      d.clearDisconnectMarker.mockRejectedValueOnce(new Error('boom'));
      d.rescheduleAlarm.mockRejectedValueOnce(new Error('reschedule boom'));

      // Should not throw even when reschedule also fails
      await expect(runAlarm(d, { now: 50_000 })).resolves.toBeUndefined();
    });

    it('reschedules when getCurrentGameState throws during inactivityTimeout', async () => {
      const d = minimalAlarmDeps();
      d.get.mockImplementation(async (key: string) => {
        if (key === 'inactivityAt') return 1000;
        return undefined;
      });
      d.getCurrentGameState = vi
        .fn()
        .mockRejectedValue(new Error('state read failed'));

      await runAlarm(d, { now: 20_000 });

      expect(d.rescheduleAlarm).toHaveBeenCalledTimes(1);
    });
  });
});
