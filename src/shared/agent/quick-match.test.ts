import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeQuickMatchServerUrl, queueForMatch } from './quick-match';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('rejects unknown scenarios before enqueueing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      queueForMatch({
        serverUrl: 'https://delta-v.example',
        scenario: 'not-a-real-scenario',
        username: 'Agent',
        playerKey: 'agent_test_validation',
      }),
    ).rejects.toThrow('Unknown scenario: not-a-real-scenario');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
