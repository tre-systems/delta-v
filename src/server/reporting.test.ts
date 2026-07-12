import { describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import {
  buildReportingCorsHeaders,
  EVENTS_RETENTION_MS,
  insertEvent,
  isErrorReportRateLimited,
  isReportingOriginAllowed,
  isServerReservedEvent,
  isTelemetryReportRateLimited,
  purgeOldEvents,
  resolveReportingAllowedOrigin,
  scrubReportPayload,
} from './reporting';

describe('resolveReportingAllowedOrigin', () => {
  it('returns the canonical production origin when no Origin header is sent', () => {
    const req = new Request('https://delta-v.test/telemetry', {
      method: 'OPTIONS',
    });
    expect(resolveReportingAllowedOrigin(req)).toBe(
      'https://delta-v.tre.systems',
    );
  });

  it('reflects the canonical production origin verbatim', () => {
    const req = new Request('https://delta-v.tre.systems/telemetry', {
      headers: { Origin: 'https://delta-v.tre.systems' },
    });
    expect(resolveReportingAllowedOrigin(req)).toBe(
      'https://delta-v.tre.systems',
    );
  });

  it('reflects localhost origins for dev / wrangler dev', () => {
    const req = new Request('http://localhost:8787/telemetry', {
      headers: { Origin: 'http://localhost:8787' },
    });
    expect(resolveReportingAllowedOrigin(req)).toBe('http://localhost:8787');
  });

  it('rejects arbitrary third-party origins by falling back to the canonical origin', () => {
    const req = new Request('https://delta-v.tre.systems/telemetry', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(resolveReportingAllowedOrigin(req)).toBe(
      'https://delta-v.tre.systems',
    );
  });

  it('adds Vary: Origin to the built header map', () => {
    const req = new Request('https://delta-v.tre.systems/telemetry');
    const headers = buildReportingCorsHeaders(req);
    expect(headers.Vary).toBe('Origin');
  });
});

describe('isReportingOriginAllowed', () => {
  it('allows missing Origin for same-origin or non-browser callers', () => {
    const req = new Request('https://delta-v.tre.systems/telemetry');
    expect(isReportingOriginAllowed(req)).toBe(true);
  });

  it('rejects explicit third-party origins', () => {
    const req = new Request('https://delta-v.tre.systems/telemetry', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(isReportingOriginAllowed(req)).toBe(false);
  });
});

describe('scrubReportPayload', () => {
  it('clips oversized string fields to the 1 KB cap', () => {
    const huge = 'x'.repeat(5000);
    const result = scrubReportPayload({
      event: 'client_error',
      message: 'ok',
      stack: huge,
    });
    expect((result.stack as string).length).toBe(1024);
    expect(result.message).toBe('ok');
    expect(result.event).toBe('client_error');
  });

  it('leaves non-string values untouched', () => {
    const result = scrubReportPayload({
      count: 42,
      nested: { a: 1 },
      ts: 12345,
    });
    expect(result.count).toBe(42);
    expect(result.nested).toEqual({ a: 1 });
    expect(result.ts).toBe(12345);
  });

  it('redacts known credential-shaped key fields at the gateway', () => {
    const result = scrubReportPayload({
      event: 'rating_applied',
      gameId: 'ABCDE-m1',
      playerKey: 'human-rob',
      aKey: 'human-aaa',
      bKey: 'human-bbb',
      winnerKey: 'human-aaa',
      seat0Key: 'human-rob',
      seat1Key: 'agent_official_quickmatch_normal',
      benignField: 'fine',
    });
    expect(result.playerKey).toBe('<redacted>');
    expect(result.aKey).toBe('<redacted>');
    expect(result.bKey).toBe('<redacted>');
    expect(result.winnerKey).toBe('<redacted>');
    expect(result.seat0Key).toBe('<redacted>');
    expect(result.seat1Key).toBe('<redacted>');
    // Non-key fields and other identifiers (gameId, ticket, etc.) pass
    // through untouched so operational metadata is preserved.
    expect(result.gameId).toBe('ABCDE-m1');
    expect(result.benignField).toBe('fine');
  });
});

describe('isServerReservedEvent', () => {
  it.each([
    'engine_error',
    'projection_parity_mismatch',
    'game_started',
    'game_ended',
    'server_create_request',
    'matchmaker_paired',
    'matchmaker_official_bot_filled',
    'rating_applied',
    'mcp_action_accepted',
    'disconnect_grace_expired',
    'live_registry_register_failed',
  ])('reserves server-originated event name %s', (event) => {
    expect(isServerReservedEvent(event)).toBe(true);
  });

  it.each([
    'client_error',
    'game_over',
    'turn_completed',
    'quick_match_queued',
    'ws_session_quality',
    'tutorial_started',
  ])('allows client event name %s', (event) => {
    expect(isServerReservedEvent(event)).toBe(false);
  });

  it('treats non-string event values as unreserved', () => {
    expect(isServerReservedEvent(undefined)).toBe(false);
    expect(isServerReservedEvent(42)).toBe(false);
  });
});

describe('insertEvent', () => {
  const makeDb = () => {
    const run = vi.fn(async () => ({}));
    const bind = vi.fn((..._args: unknown[]) => ({ run }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    return { db: { prepare } as unknown as D1Database, prepare, bind };
  };

  it('drops client posts that use a server-reserved event name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { db, prepare } = makeDb();

    await insertEvent(db, { event: 'engine_error', code: 'x' }, 'hash', null);

    expect(prepare).not.toHaveBeenCalled();
  });

  it('inserts ordinary client events', async () => {
    const { db, bind } = makeDb();

    await insertEvent(db, { event: 'game_over', won: true }, 'hash', 'ua');

    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind.mock.calls[0]?.[2]).toBe('game_over');
  });
});

describe('purgeOldEvents', () => {
  it('issues a parameterised DELETE and returns the changed row count', async () => {
    const run = vi.fn(async () => ({ meta: { changes: 7 } }));
    const bind = vi.fn((..._args: unknown[]) => ({ run }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    const removed = await purgeOldEvents(db, EVENTS_RETENTION_MS);

    expect(removed).toBe(7);
    expect(prepare).toHaveBeenCalledWith('DELETE FROM events WHERE ts < ?');
    expect(bind).toHaveBeenCalledTimes(1);
    const cutoff = (bind.mock.calls[0]?.[0] ?? 0) as number;
    expect(cutoff).toBeGreaterThan(0);
    expect(cutoff).toBeLessThanOrEqual(Date.now());
  });

  it('returns 0 when the D1 driver throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const prepare = vi.fn(() => ({
      bind: () => ({
        run: async () => {
          throw new Error('no table');
        },
      }),
    }));
    const db = { prepare } as unknown as D1Database;
    await expect(purgeOldEvents(db, 1000)).resolves.toBe(0);
  });
});

describe('telemetry + error rate limiter bindings', () => {
  it('prefers the TELEMETRY_RATE_LIMITER binding when set', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = {
      TELEMETRY_RATE_LIMITER: { limit },
    } as unknown as Env;

    await expect(isTelemetryReportRateLimited(env, 'hash')).resolves.toBe(true);
    expect(limit).toHaveBeenCalledWith({ key: 'telemetry:hash' });
  });

  it('prefers the ERROR_RATE_LIMITER binding when set', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const env = {
      ERROR_RATE_LIMITER: { limit },
    } as unknown as Env;

    await expect(isErrorReportRateLimited(env, 'hash')).resolves.toBe(false);
    expect(limit).toHaveBeenCalledWith({ key: 'error:hash' });
  });

  it('falls back to the in-memory map when no binding is present', async () => {
    const env = {} as unknown as Env;
    // Any call should not throw and should return a boolean.
    await expect(
      isTelemetryReportRateLimited(env, 'fallback'),
    ).resolves.toBeTypeOf('boolean');
    await expect(isErrorReportRateLimited(env, 'fallback')).resolves.toBeTypeOf(
      'boolean',
    );
  });
});
