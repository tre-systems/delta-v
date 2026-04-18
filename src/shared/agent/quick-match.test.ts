import { describe, expect, it } from 'vitest';

import { normalizeQuickMatchServerUrl } from './quick-match';

describe('normalizeQuickMatchServerUrl', () => {
  it('maps ws and wss to http and https for REST', () => {
    expect(normalizeQuickMatchServerUrl('ws://localhost:8787/')).toBe(
      'http://localhost:8787',
    );
    expect(normalizeQuickMatchServerUrl('wss://delta-v.example/')).toBe(
      'https://delta-v.example',
    );
  });

  it('preserves http(s) and trims trailing slashes', () => {
    expect(normalizeQuickMatchServerUrl('https://x.test/api/')).toBe(
      'https://x.test/api',
    );
  });
});
