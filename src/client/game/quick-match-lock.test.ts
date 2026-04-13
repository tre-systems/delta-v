import { describe, expect, it, vi } from 'vitest';

import { createQuickMatchLock } from './quick-match-lock';

const createStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));

  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
};

describe('quick-match-lock', () => {
  it('blocks a second tab while the first tab lock is active', () => {
    const localStorage = createStorage();
    const sessionStorageA = createStorage();
    const sessionStorageB = createStorage();
    const now = vi.fn(() => 1_000);

    const lockA = createQuickMatchLock({
      localStorage,
      sessionStorage: sessionStorageA,
      now,
      createTabId: () => 'tab-a',
    });
    const lockB = createQuickMatchLock({
      localStorage,
      sessionStorage: sessionStorageB,
      now,
      createTabId: () => 'tab-b',
    });

    expect(lockA.claim('player-a')).toEqual({ ok: true });
    expect(lockB.claim('player-a')).toEqual({ ok: false });
  });

  it('allows a second tab after the lock expires', () => {
    const localStorage = createStorage();
    const sessionStorageA = createStorage();
    const sessionStorageB = createStorage();
    const now = vi.fn(() => 1_000);

    const lockA = createQuickMatchLock({
      localStorage,
      sessionStorage: sessionStorageA,
      now,
      createTabId: () => 'tab-a',
      ttlMs: 5_000,
    });
    const lockB = createQuickMatchLock({
      localStorage,
      sessionStorage: sessionStorageB,
      now,
      createTabId: () => 'tab-b',
      ttlMs: 5_000,
    });

    expect(lockA.claim('player-a')).toEqual({ ok: true });

    now.mockReturnValue(6_500);
    expect(lockB.claim('player-a')).toEqual({ ok: true });
  });

  it('releases only the owning tab lock', () => {
    const localStorage = createStorage();
    const sessionStorageA = createStorage();
    const sessionStorageB = createStorage();

    const lockA = createQuickMatchLock({
      localStorage,
      sessionStorage: sessionStorageA,
      createTabId: () => 'tab-a',
    });
    const lockB = createQuickMatchLock({
      localStorage,
      sessionStorage: sessionStorageB,
      createTabId: () => 'tab-b',
    });

    lockA.claim('player-a');
    lockB.release();

    expect(localStorage.getItem('delta-v:quick-match-lock')).not.toBeNull();

    lockA.release();

    expect(localStorage.getItem('delta-v:quick-match-lock')).toBeNull();
  });
});
