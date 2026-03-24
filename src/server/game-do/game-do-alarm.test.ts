import { describe, expect, it, vi } from 'vitest';

import { buildSolarSystemMap } from '../../shared/map-data';
import { runGameDoAlarm } from './game-do-alarm';

const map = buildSolarSystemMap();

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
    archiveRoomState: vi.fn().mockResolvedValue(undefined),
    env: { DB: {} as D1Database },
  };
};

describe('runGameDoAlarm', () => {
  it('reschedules when no alarm window has fired', async () => {
    const d = minimalAlarmDeps();

    await runGameDoAlarm({
      now: 10_000,
      storage: d.storage,
      env: d.env,
      waitUntil: d.waitUntil,
      getWebSockets: d.getWebSockets,
      map: d.map,
      getCurrentGameState: d.getCurrentGameState,
      getGameCode: d.getGameCode,
      getActionRng: d.getActionRng,
      clearDisconnectMarker: d.clearDisconnectMarker,
      rescheduleAlarm: d.rescheduleAlarm,
      publishStateChange: d.publishStateChange,
      reportEngineError: d.reportEngineError,
      archiveRoomState: d.archiveRoomState,
    });

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

    await runGameDoAlarm({
      now: 50_000,
      storage: d.storage,
      env: d.env,
      waitUntil: d.waitUntil,
      getWebSockets: d.getWebSockets,
      map: d.map,
      getCurrentGameState: d.getCurrentGameState,
      getGameCode: d.getGameCode,
      getActionRng: d.getActionRng,
      clearDisconnectMarker: d.clearDisconnectMarker,
      rescheduleAlarm: d.rescheduleAlarm,
      publishStateChange: d.publishStateChange,
      reportEngineError: d.reportEngineError,
      archiveRoomState: d.archiveRoomState,
    });

    expect(d.clearDisconnectMarker).toHaveBeenCalledTimes(1);
    expect(d.rescheduleAlarm).toHaveBeenCalledTimes(1);
    expect(d.publishStateChange).not.toHaveBeenCalled();
  });
});
