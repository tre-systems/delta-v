// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getWebLocalStorage } from './web-local-storage';

describe('getWebLocalStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns storage when localStorage implements Storage', () => {
    const ls = getWebLocalStorage();
    expect(ls).not.toBeNull();
    expect(typeof ls?.getItem).toBe('function');
  });

  it('returns null when localStorage is a broken object', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(getWebLocalStorage()).toBeNull();
  });
});
