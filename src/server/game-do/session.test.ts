import { describe, expect, it } from 'vitest';

import {
  createDisconnectMarker,
  DISCONNECT_GRACE_MS,
  getNextAlarmAt,
  normalizeDisconnectedPlayer,
  resolveAlarmAction,
  shouldClearDisconnectMarker,
} from './session';

describe('game-do-session', () => {
  it('normalizes only valid disconnected player ids', () => {
    expect(normalizeDisconnectedPlayer(0)).toBe(0);
    expect(normalizeDisconnectedPlayer(1)).toBe(1);
    expect(normalizeDisconnectedPlayer(2)).toBeNull();
    expect(normalizeDisconnectedPlayer('0')).toBeNull();
    expect(normalizeDisconnectedPlayer(undefined)).toBeNull();
  });

  it('builds a disconnect marker with the grace window applied', () => {
    expect(createDisconnectMarker(1, 1_000)).toEqual({
      disconnectedPlayer: 1,
      disconnectTime: 1_000,
      disconnectAt: 1_000 + DISCONNECT_GRACE_MS,
    });
  });

  it('picks the earliest pending alarm deadline', () => {
    expect(getNextAlarmAt({})).toBeNull();
    expect(
      getNextAlarmAt({
        disconnectAt: 2_000,
        turnTimeoutAt: 1_500,
        inactivityAt: 3_000,
      }),
    ).toBe(1_500);
  });

  it('resolves disconnect expiry ahead of other timers', () => {
    expect(
      resolveAlarmAction({
        now: 2_000,
        disconnectedPlayer: 1,
        disconnectAt: 1_999,
        turnTimeoutAt: 1_500,
        inactivityAt: 1_000,
      }),
    ).toEqual({ type: 'disconnectExpired', playerId: 1 });
  });

  it('allows a small early turn-timeout window before inactivity', () => {
    expect(
      resolveAlarmAction({
        now: 9_500,
        disconnectedPlayer: null,
        turnTimeoutAt: 10_000,
        inactivityAt: 9_600,
      }),
    ).toEqual({ type: 'turnTimeout' });
  });

  it('falls back to inactivity and reschedule decisions', () => {
    expect(
      resolveAlarmAction({
        now: 4_000,
        disconnectedPlayer: null,
        inactivityAt: 3_000,
      }),
    ).toEqual({ type: 'inactivityTimeout' });
    expect(
      resolveAlarmAction({
        now: 4_000,
        disconnectedPlayer: null,
        turnTimeoutAt: 5_000,
        inactivityAt: 6_000,
      }),
    ).toEqual({ type: 'reschedule' });
  });

  it('only clears the stored disconnect marker for the same player', () => {
    expect(shouldClearDisconnectMarker(0, 0)).toBe(true);
    expect(shouldClearDisconnectMarker(1, 0)).toBe(false);
    expect(shouldClearDisconnectMarker(null, 0)).toBe(false);
  });
});
