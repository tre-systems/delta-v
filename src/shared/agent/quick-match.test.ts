import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeQuickMatchServerUrl,
  pollQuickMatchTicket,
  queueForMatch,
} from './quick-match';

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

  it('returns the queued ticket immediately when waitForOpponent is false', async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        status: 'queued',
        ticket: 'TICKET',
        scenario: 'duel',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      queueForMatch({
        serverUrl: 'https://delta-v.example',
        scenario: 'duel',
        username: 'Agent',
        playerKey: 'agent_test_wait_false',
        waitForOpponent: false,
        authorizationBearer: 'token',
      }),
    ).resolves.toEqual({
      status: 'queued',
      ticket: 'TICKET',
      scenario: 'duel',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends rendezvousCode when provided', async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        status: 'queued',
        ticket: 'TICKET',
        scenario: 'duel',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await queueForMatch({
      serverUrl: 'https://delta-v.example',
      scenario: 'duel',
      rendezvousCode: 'qa123',
      username: 'Agent',
      playerKey: 'agent_test_rendezvous',
      waitForOpponent: false,
      authorizationBearer: 'token',
    });

    const firstCall = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ];
    const body = JSON.parse(String(firstCall[1]?.body)) as {
      rendezvousCode?: string;
    };
    expect(body.rendezvousCode).toBe('qa123');
  });

  it('polls a queued ticket until it matches', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          status: 'queued',
          ticket: 'TICKET',
          scenario: 'duel',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: 'matched',
          ticket: 'TICKET',
          scenario: 'duel',
          code: 'ABCDE',
          playerToken: 'X'.repeat(32),
        }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      pollQuickMatchTicket({
        serverUrl: 'https://delta-v.example',
        ticket: 'TICKET',
        pollMs: 0,
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({
      status: 'matched',
      ticket: 'TICKET',
      scenario: 'duel',
      code: 'ABCDE',
      playerToken: 'X'.repeat(32),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
