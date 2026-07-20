import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSecureRandomId } from './secure-random-id';

describe('createSecureRandomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses randomUUID when available', () => {
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', {
      randomUUID: () => '12345678-1234-4234-8234-123456789abc',
      getRandomValues,
    });

    expect(createSecureRandomId()).toBe('12345678123442348234123456789abc');
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('uses cryptographically random bytes when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });

    expect(createSecureRandomId()).toBe('ab'.repeat(16));
  });

  it('fails closed when secure randomness is unavailable', () => {
    vi.stubGlobal('crypto', {});

    expect(() => createSecureRandomId()).toThrow(
      'Secure random number generation is unavailable.',
    );
  });
});
