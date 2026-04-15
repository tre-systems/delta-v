import { describe, expect, it, vi } from 'vitest';

import { StateWaiters } from './state-waiters';

describe('StateWaiters', () => {
  it('resolves to true when wakeAll fires before timeout', async () => {
    const waiters = new StateWaiters();
    const promise = waiters.wait(0, 10_000);
    expect(waiters.pending(0)).toBe(1);
    waiters.wakeAll(0);
    await expect(promise).resolves.toBe(true);
    expect(waiters.pending(0)).toBe(0);
  });

  it('resolves to false on timeout', async () => {
    vi.useFakeTimers();
    try {
      const waiters = new StateWaiters();
      const promise = waiters.wait(1, 5_000);
      vi.advanceTimersByTime(5_001);
      await expect(promise).resolves.toBe(false);
      expect(waiters.pending(1)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wakes only the targeted seat', async () => {
    const waiters = new StateWaiters();
    const seatZero = waiters.wait(0, 60_000);
    const seatOne = waiters.wait(1, 60_000);
    waiters.wakeAll(0);
    await expect(seatZero).resolves.toBe(true);
    expect(waiters.pending(1)).toBe(1);
    waiters.wakeAll(1);
    await expect(seatOne).resolves.toBe(true);
  });

  it('wakeAllSeats clears every queue', async () => {
    const waiters = new StateWaiters();
    const a = waiters.wait(0, 60_000);
    const b = waiters.wait(0, 60_000);
    const c = waiters.wait(1, 60_000);
    waiters.wakeAllSeats();
    await expect(Promise.all([a, b, c])).resolves.toEqual([true, true, true]);
    expect(waiters.pending(0)).toBe(0);
    expect(waiters.pending(1)).toBe(0);
  });

  it('handles concurrent waiters on the same seat', async () => {
    const waiters = new StateWaiters();
    const a = waiters.wait(0, 60_000);
    const b = waiters.wait(0, 60_000);
    expect(waiters.pending(0)).toBe(2);
    waiters.wakeAll(0);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
  });
});
