import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../env';
import { QUICK_MATCH_VERIFIED_AGENT_HEADER } from '../quick-match-internal';
import { queueRemoteMatch } from './quick-match';

const buildEnv = (
  responder: (req: Request) => Response | Promise<Response>,
): { env: Env; calls: Request[] } => {
  const calls: Request[] = [];
  const stub = {
    fetch: vi.fn((req: Request) => {
      calls.push(req);
      return Promise.resolve(responder(req));
    }),
  } as unknown as DurableObjectStub;
  const namespace = {
    get: vi.fn(() => stub),
    idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
  } as unknown as DurableObjectNamespace;
  return {
    env: {
      MATCHMAKER: namespace,
      GAME: namespace,
    } as unknown as Env,
    calls,
  };
};

describe('queueRemoteMatch', () => {
  it('rejects non-agent_ playerKey', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    await expect(
      queueRemoteMatch(env, {
        scenario: 'duel',
        username: 'tester',
        playerKey: 'human123',
      }),
    ).rejects.toThrow(/agent_/);
  });

  it('returns match details after matchmaker pairs', async () => {
    let pollCount = 0;
    const { env, calls } = buildEnv((req) => {
      if (req.url.endsWith('/enqueue')) {
        return Response.json({
          status: 'queued',
          ticket: 'TICKET',
          scenario: 'duel',
        });
      }
      pollCount++;
      if (pollCount < 2) {
        return Response.json({
          status: 'queued',
          ticket: 'TICKET',
          scenario: 'duel',
        });
      }
      return Response.json({
        status: 'matched',
        ticket: 'TICKET',
        scenario: 'duel',
        code: 'ABCDE',
        playerToken: 'X'.repeat(32),
      });
    });

    const result = await queueRemoteMatch(env, {
      scenario: 'duel',
      username: 'tester',
      playerKey: 'agent_test_1',
      pollMs: 5,
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({
      code: 'ABCDE',
      ticket: 'TICKET',
      scenario: 'duel',
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('throws on expired ticket', async () => {
    const { env } = buildEnv((req) => {
      if (req.url.endsWith('/enqueue')) {
        return Response.json({
          status: 'queued',
          ticket: 'TICKET',
          scenario: 'duel',
        });
      }
      return Response.json({
        status: 'expired',
        ticket: 'TICKET',
        scenario: 'duel',
        reason: 'no opponent',
      });
    });

    await expect(
      queueRemoteMatch(env, {
        scenario: 'duel',
        username: 'tester',
        playerKey: 'agent_test_2',
        pollMs: 5,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/expired/);
  });

  it('sets verified-agent header when verifiedLeaderboardAgent is true', async () => {
    const { env, calls } = buildEnv((req) => {
      if (req.url.endsWith('/enqueue')) {
        return Response.json({
          status: 'queued',
          ticket: 'TICKET',
          scenario: 'duel',
        });
      }
      return Response.json({
        status: 'matched',
        ticket: 'TICKET',
        scenario: 'duel',
        code: 'ABCDE',
        playerToken: 'X'.repeat(32),
      });
    });

    await queueRemoteMatch(env, {
      scenario: 'duel',
      username: 'tester',
      playerKey: 'agent_verify_hdr',
      verifiedLeaderboardAgent: true,
      pollMs: 5,
      timeoutMs: 2_000,
    });

    const enqueueReq = calls.find((r) => r.url.endsWith('/enqueue'));
    expect(enqueueReq).toBeDefined();
    expect(enqueueReq?.headers.get(QUICK_MATCH_VERIFIED_AGENT_HEADER)).toBe(
      '1',
    );
  });

  it('throws on enqueue failure', async () => {
    const { env } = buildEnv(
      () => new Response('Bad request', { status: 400 }),
    );
    await expect(
      queueRemoteMatch(env, {
        scenario: 'duel',
        username: 'tester',
        playerKey: 'agent_test_3',
      }),
    ).rejects.toThrow(/enqueue failed/);
  });
});
