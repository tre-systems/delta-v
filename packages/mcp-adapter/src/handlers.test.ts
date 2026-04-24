import { describe, expect, it, vi } from 'vitest';

import { issueAgentToken, issueMatchToken } from '../../../src/server/auth';
import type { Env } from '../../../src/server/env';
import {
  hashIp,
  shouldSampleOperationalLog,
} from '../../../src/server/reporting';
import {
  LEADERBOARD_AGENTS_URI,
  MATCH_LOG_URI_TEMPLATE,
  MATCH_OBSERVATION_URI_TEMPLATE,
  MATCH_REPLAY_URI_TEMPLATE,
  RULES_CURRENT_URI,
} from '../../../src/shared/agent';
import { buildMcpServer, handleMcpHttpRequest } from './handlers';

const TEST_SECRET = 'mcp-handlers-test-secret-must-be-16-chars';

// Helper: build a fake DurableObjectStub that records GAME DO fetches and
// returns whatever JSON we tell it to. The Worker's MCP tools delegate to
// env.GAME.get(idFromName(code)).fetch(...) — by stubbing both we can test
// the full tool-call → DO route plumbing without spinning up workerd.
const buildEnv = (
  doResponse: (req: Request) => Response | Promise<Response>,
): { env: Env; calls: Request[] } => {
  const calls: Request[] = [];
  const stub = {
    fetch: vi.fn((req: Request) => {
      calls.push(req);
      return Promise.resolve(doResponse(req));
    }),
  } as unknown as DurableObjectStub;
  const namespace = {
    get: vi.fn(() => stub),
    idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
  } as unknown as DurableObjectNamespace;
  const liveRegistryStub = {
    fetch: vi.fn(async () => Response.json({ matches: [] })),
  } as unknown as DurableObjectStub;
  const liveRegistry = {
    get: vi.fn(() => liveRegistryStub),
    idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
  } as unknown as DurableObjectNamespace;
  const env = {
    GAME: namespace,
    MATCHMAKER: namespace, // not exercised here; keep shape
    LIVE_REGISTRY: liveRegistry,
    AGENT_TOKEN_SECRET: TEST_SECRET,
  } as unknown as Env;
  return { env, calls };
};

const postAuthorized = (body: unknown, agentToken: string): Request =>
  new Request('https://w.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json,text/event-stream',
      Authorization: `Bearer ${agentToken}`,
    },
    body: JSON.stringify(body),
  });

const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};

const post = (body: unknown): Request =>
  new Request('https://w.test/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json,text/event-stream',
    },
    body: JSON.stringify(body),
  });

const findSampledIp = async (): Promise<string> => {
  for (let index = 1; index < 256; index++) {
    const candidate = `10.0.1.${index}`;
    if (shouldSampleOperationalLog(await hashIp(candidate))) {
      return candidate;
    }
  }
  throw new Error('failed to find sampled IP');
};

describe('handleMcpHttpRequest abuse protections', () => {
  it('returns 500 when AGENT_TOKEN_SECRET is missing in production mode', async () => {
    const res = await handleMcpHttpRequest(post(initializeBody), {
      GAME: {},
    } as unknown as Env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('server_misconfigured');
  });

  it('returns 413 when the POST body exceeds the MCP body cap', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const huge = 'x'.repeat(16 * 1024 + 10);
    const res = await handleMcpHttpRequest(
      new Request('https://w.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json,text/event-stream',
        },
        body: huge,
      }),
      env,
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('payload_too_large');
  });

  it('returns 413 early when Content-Length declares an oversize body', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      new Request('https://w.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(16 * 1024 + 1),
        },
        body: 'small',
      }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it('returns 429 when the MCP_RATE_LIMITER binding denies the call', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = {
      GAME: {},
      MATCHMAKER: {},
      AGENT_TOKEN_SECRET: TEST_SECRET,
      MCP_RATE_LIMITER: { limit },
    } as unknown as Env;
    const res = await handleMcpHttpRequest(
      new Request('https://w.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json,text/event-stream',
          'cf-connecting-ip': '1.1.1.1',
        },
        body: JSON.stringify(initializeBody),
      }),
      env,
    );
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalled();
    const callArg = (
      limit.mock.calls as unknown as Array<[{ key: string }]>
    )[0]?.[0];
    expect(callArg?.key.startsWith('ip:')).toBe(true);
  });

  it('falls back to a Worker-local MCP rate limit when the binding is missing', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const buildRequest = () =>
      new Request('https://w.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json,text/event-stream',
          'cf-connecting-ip': '2.2.2.2',
        },
        body: JSON.stringify(initializeBody),
      });

    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await handleMcpHttpRequest(buildRequest(), env);
      expect(response.status).toBe(200);
    }

    const blocked = await handleMcpHttpRequest(buildRequest(), env);
    expect(blocked.status).toBe(429);
  });

  it('derives the MCP rate-limit key from the agentToken hash when present', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = {
      GAME: {},
      MATCHMAKER: {},
      AGENT_TOKEN_SECRET: TEST_SECRET,
      MCP_RATE_LIMITER: { limit },
    } as unknown as Env;
    const { token } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test123_ok',
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(initializeBody, token),
      env,
    );
    expect(res.status).toBe(429);
    const callArg = (
      limit.mock.calls as unknown as Array<[{ key: string }]>
    )[0]?.[0];
    expect(callArg?.key.startsWith('agent:')).toBe(true);
  });
});

describe('handleMcpHttpRequest', () => {
  it('rejects non-POST/DELETE with 405', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      new Request('https://w.test/mcp', { method: 'GET' }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it('serves initialize successfully', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(post(initializeBody), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: expect.objectContaining({
        serverInfo: expect.objectContaining({ name: 'delta-v-mcp-remote' }),
      }),
    });
  });

  it('lists the expected tool surface', async () => {
    const server = buildMcpServer({} as unknown as Env, null);
    // McpServer has a private registry; hit listTools via JSON-RPC roundtrip
    // through the public transport instead.
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      env,
    );
    const body = (await res.json()) as {
      result: { tools: { name: string }[] };
    };
    const names = body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'delta_v_close_session',
      'delta_v_get_events',
      'delta_v_get_observation',
      'delta_v_get_state',
      'delta_v_list_sessions',
      'delta_v_quick_match',
      'delta_v_quick_match_connect',
      'delta_v_send_action',
      'delta_v_send_chat',
      'delta_v_wait_for_turn',
    ]);
    void server; // keep import used
  });

  it('lists the shipped rules resources', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      post({ jsonrpc: '2.0', id: 21, method: 'resources/list' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { resources: Array<{ uri: string }> };
    };
    const uris = body.result.resources.map((resource) => resource.uri);
    expect(uris).toContain(RULES_CURRENT_URI);
    expect(uris).toContain('game://rules/duel');
    expect(uris).toContain(LEADERBOARD_AGENTS_URI);
  });

  it('lists the shipped match resource templates', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      post({ jsonrpc: '2.0', id: 211, method: 'resources/templates/list' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { resourceTemplates: Array<{ uriTemplate: string }> };
    };
    const templates = body.result.resourceTemplates.map(
      (resource) => resource.uriTemplate,
    );
    expect(templates).toContain(MATCH_OBSERVATION_URI_TEMPLATE);
    expect(templates).toContain(MATCH_LOG_URI_TEMPLATE);
    expect(templates).toContain(MATCH_REPLAY_URI_TEMPLATE);
  });

  it('reads the current rules resource as JSON text', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 22,
        method: 'resources/read',
        params: { uri: RULES_CURRENT_URI },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        contents: Array<{ text?: string; mimeType?: string; uri: string }>;
      };
    };
    expect(body.result.contents).toHaveLength(1);
    expect(body.result.contents[0]).toMatchObject({
      uri: RULES_CURRENT_URI,
      mimeType: 'application/json',
    });
    expect(body.result.contents[0]?.text).toContain(
      '"defaultScenario": "duel"',
    );
    expect(body.result.contents[0]?.text).toContain('"duel"');
  });

  it('reads the agent leaderboard resource as filtered JSON text', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    env.DB = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({
            results: [
              {
                username: 'agent_alpha',
                is_agent: 1,
                rating: 1623,
                rd: 74,
                games_played: 12,
                distinct_opponents: 6,
                last_match_at: 1_234_567,
              },
              {
                username: 'human_beta',
                is_agent: 0,
                rating: 1700,
                rd: 62,
                games_played: 15,
                distinct_opponents: 8,
                last_match_at: 2_345_678,
              },
            ],
          })),
        })),
      })),
    } as unknown as Env['DB'];

    const res = await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 23,
        method: 'resources/read',
        params: { uri: LEADERBOARD_AGENTS_URI },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        contents: Array<{ text?: string; mimeType?: string; uri: string }>;
      };
    };
    expect(body.result.contents).toHaveLength(1);
    expect(body.result.contents[0]).toMatchObject({
      uri: LEADERBOARD_AGENTS_URI,
      mimeType: 'application/json',
    });
    expect(body.result.contents[0]?.text).toContain(
      '"kind": "agentLeaderboard"',
    );
    expect(body.result.contents[0]?.text).toContain('"agent_alpha"');
    expect(body.result.contents[0]?.text).not.toContain('"human_beta"');
  });

  it('reads the hosted match observation resource via the GAME DO', async () => {
    const { env, calls } = buildEnv((req) => {
      if (req.url.includes('/mcp/observation')) {
        return Response.json({
          phase: 'astrogation',
          turnNumber: 1,
          activePlayer: 0,
          summary: 'Your turn.',
          candidates: [],
          legalActionInfo: null,
          recommendedIndex: null,
          state: { phase: 'astrogation', turnNumber: 1, activePlayer: 0 },
        });
      }
      return Response.json({});
    });
    const agent = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_resource_observation_1',
    });
    const match = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken: 'A'.repeat(32),
      agentToken: agent.token,
    });
    const uri = `game://matches/${match.token}/observation`;
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 231,
          method: 'resources/read',
          params: { uri },
        },
        agent.token,
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls.at(-1)?.url).toContain('/mcp/observation?');
    const body = (await res.json()) as {
      result: { contents: Array<{ text?: string; uri: string }> };
    };
    expect(body.result.contents[0]?.uri).toBe(uri);
    expect(body.result.contents[0]?.text).toContain(
      '"kind": "matchObservation"',
    );
  });

  it('reads the hosted match log resource via the GAME DO', async () => {
    const { env, calls } = buildEnv((req) => {
      if (req.url.includes('/mcp/events')) {
        return Response.json({
          ok: true,
          events: [
            {
              id: 1,
              receivedAt: 123,
              type: 'welcome',
              message: {
                type: 'welcome',
                playerId: 0,
                code: 'ABCDE',
                playerToken: 'A'.repeat(32),
              },
            },
          ],
          latestEventId: 1,
          bufferedRemaining: 1,
        });
      }
      return Response.json({});
    });
    const agent = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_resource_log_1',
    });
    const match = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken: 'A'.repeat(32),
      agentToken: agent.token,
    });
    const uri = `game://matches/${match.token}/log`;
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 232,
          method: 'resources/read',
          params: { uri },
        },
        agent.token,
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls.at(-1)?.url).toContain('/mcp/events?');
    const body = (await res.json()) as {
      result: { contents: Array<{ text?: string; uri: string }> };
    };
    expect(body.result.contents[0]?.uri).toBe(uri);
    expect(body.result.contents[0]?.text).toContain('"kind": "matchLog"');
    expect(body.result.contents[0]?.text).toContain('"latestEventId": 1');
  });

  it('reads the hosted match replay resource via the GAME DO', async () => {
    const { env, calls } = buildEnv((req) => {
      if (req.url.includes('/replay?')) {
        return Response.json({
          gameId: 'ABCDE-m1',
          roomCode: 'ABCDE',
          matchNumber: 1,
          scenario: 'duel',
          createdAt: 123,
          entries: [],
        });
      }
      return Response.json({});
    });
    const agent = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_resource_replay_1',
    });
    const match = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken: 'A'.repeat(32),
      agentToken: agent.token,
    });
    const uri = `game://matches/${match.token}/replay`;
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 233,
          method: 'resources/read',
          params: { uri },
        },
        agent.token,
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls.at(-1)?.url).toContain('/replay?playerToken=');
    const body = (await res.json()) as {
      result: { contents: Array<{ text?: string; uri: string }> };
    };
    expect(body.result.contents[0]?.uri).toBe(uri);
    expect(body.result.contents[0]?.text).toContain('"kind": "matchReplay"');
    expect(body.result.contents[0]?.text).toContain('"gameId": "ABCDE-m1"');
  });

  it('forwards delta_v_get_events to the GAME DO', async () => {
    const { env, calls } = buildEnv(() =>
      Response.json({
        ok: true,
        events: [],
        bufferedRemaining: 0,
        latestEventId: 0,
      }),
    );
    const { token: agentToken } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_events',
    });
    const { token: matchToken } = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken: 'X'.repeat(32),
      agentToken,
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 24,
          method: 'tools/call',
          params: {
            name: 'delta_v_get_events',
            arguments: { matchToken, afterEventId: 7 },
          },
        },
        agentToken,
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls.at(-1)?.url).toContain('/mcp/events?playerToken=');
    expect(calls.at(-1)?.method).toBe('POST');
  });

  it('lists hosted sessions for the authenticated agent', async () => {
    const doFetch = vi.fn(async (req: Request) => {
      if (req.url.includes('/mcp/session-summary')) {
        return Response.json({
          ok: true,
          session: {
            code: 'ABCDE',
            scenario: 'duel',
            playerId: 0,
            playerToken: 'A'.repeat(32),
            currentPhase: 'astrogation',
            turnNumber: 1,
            eventsBuffered: 3,
          },
        });
      }
      return Response.json({});
    });
    const namespace = {
      get: vi.fn(() => ({ fetch: doFetch }) as unknown as DurableObjectStub),
      idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
    } as unknown as DurableObjectNamespace;
    const liveRegistry = {
      get: vi.fn(
        () =>
          ({
            fetch: vi.fn(async () =>
              Response.json({
                matches: [{ code: 'ABCDE', scenario: 'duel', startedAt: 1 }],
              }),
            ),
          }) as unknown as DurableObjectStub,
      ),
      idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
    } as unknown as DurableObjectNamespace;
    const agent = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_session_list_1',
    });
    const env = {
      GAME: namespace,
      MATCHMAKER: namespace,
      LIVE_REGISTRY: liveRegistry,
      AGENT_TOKEN_SECRET: TEST_SECRET,
    } as unknown as Env;
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 25,
          method: 'tools/call',
          params: { name: 'delta_v_list_sessions', arguments: {} },
        },
        agent.token,
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        structuredContent: {
          sessions: Array<{
            code: string;
            sessionId?: string;
            matchToken?: string;
          }>;
        };
      };
    };
    expect(body.result.structuredContent.sessions).toHaveLength(1);
    expect(body.result.structuredContent.sessions[0]?.code).toBe('ABCDE');
    expect(body.result.structuredContent.sessions[0]?.sessionId).toBe(
      body.result.structuredContent.sessions[0]?.matchToken,
    );
  });

  it('forwards delta_v_get_state to the GAME DO', async () => {
    const { env, calls } = buildEnv(() =>
      Response.json({
        ok: true,
        code: 'ABCDE',
        playerId: 0,
        state: null,
        hasState: false,
      }),
    );
    const { token: agentToken } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_state',
    });
    const { token: matchToken } = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken: 'X'.repeat(32),
      agentToken,
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'delta_v_get_state',
            arguments: { matchToken },
          },
        },
        agentToken,
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe('/mcp/state');
    expect(new URL(calls[0].url).searchParams.get('playerToken')).toBe(
      'X'.repeat(32),
    );

    const body = (await res.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).not.toBe(true);
  });

  it('returns a queued quick-match ticket immediately when waitForOpponent is false', async () => {
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

    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 30,
          method: 'tools/call',
          params: {
            name: 'delta_v_quick_match',
            arguments: {
              playerKey: 'agent_test_wait_false',
              username: 'Bot',
              waitForOpponent: false,
            },
          },
        },
        (
          await issueAgentToken({
            secret: TEST_SECRET,
            playerKey: 'agent_test_wait_false',
          })
        ).token,
      ),
      env,
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/enqueue');
    const body = (await res.json()) as {
      result: { structuredContent?: Record<string, unknown> };
    };
    expect(body.result.structuredContent).toMatchObject({
      status: 'queued',
      ticket: 'TICKET',
      scenario: 'duel',
    });
  });

  it('rejects tool call with an invalid matchToken', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const { token: agentToken } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_invalid_match',
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'delta_v_get_state',
            arguments: {
              matchToken: 'not-a-real-match-token',
            },
          },
        },
        agentToken,
      ),
      env,
    );
    const body = (await res.json()) as {
      result: { isError: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain('Invalid matchToken');
  });

  it('rejects an invalid Bearer token with 401', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      postAuthorized(initializeBody, 'not.a.valid.token'),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  it('logs invalid Bearer failures on a sampled path', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const ip = await findSampledIp();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await handleMcpHttpRequest(
      new Request('https://w.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json,text/event-stream',
          Authorization: 'Bearer not.a.valid.token',
          'cf-connecting-ip': ip,
        },
        body: JSON.stringify(initializeBody),
      }),
      env,
    );

    expect(res.status).toBe(401);
    expect(log).toHaveBeenCalledWith(
      '[auth-failure]',
      expect.objectContaining({
        route: '/mcp',
        reason: 'invalid_agent_token',
      }),
    );
    log.mockRestore();
  });

  it('accepts a valid Bearer token and routes initialize', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const { token } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_alpha',
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(initializeBody, token),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('resolves matchToken into the hosted seat credentials when calling get_state', async () => {
    const { env, calls } = buildEnv(() =>
      Response.json({
        ok: true,
        code: 'ABCDE',
        playerId: 0,
        state: null,
        hasState: false,
      }),
    );
    const playerToken = 'P'.repeat(32);
    const { token: agentToken } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_beta',
    });
    const { token: matchToken } = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken,
      agentToken,
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'delta_v_get_state',
            arguments: { matchToken },
          },
        },
        agentToken,
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    // The DO call should include the unwrapped playerToken.
    expect(new URL(calls[0].url).searchParams.get('playerToken')).toBe(
      playerToken,
    );
    const body = (await res.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).not.toBe(true);
  });

  it('rejects matchToken without Authorization bearer', async () => {
    const { env } = buildEnv(() =>
      Response.json({
        ok: true,
        code: 'ABCDE',
        playerId: 0,
        state: null,
        hasState: false,
      }),
    );
    const playerToken = 'P'.repeat(32);
    const { token: agentToken } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_no_bearer',
    });
    const { token: matchToken } = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken,
      agentToken,
    });
    const res = await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'delta_v_get_state',
          arguments: { matchToken },
        },
      }),
      env,
    );
    const body = (await res.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
  });

  it('rejects matchToken issued for a different agentToken', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const { token: agentTokenA } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_a',
    });
    const { token: agentTokenB } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_b',
    });
    const { token: matchToken } = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken: 'P'.repeat(32),
      agentToken: agentTokenA,
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: {
            name: 'delta_v_get_state',
            arguments: { matchToken },
          },
        },
        agentTokenB,
      ),
      env,
    );
    const body = (await res.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
  });

  it('rejects tool call without a hosted match handle', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'delta_v_get_state',
          arguments: {},
        },
      }),
      env,
    );
    const body = (await res.json()) as {
      result: { isError: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain('Provide matchToken');
  });

  it('rejects unknown hosted sessionId with a stale-session message', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const { token } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_stale_session',
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 14,
          method: 'tools/call',
          params: {
            name: 'delta_v_get_state',
            arguments: { sessionId: 'not-a-real-session' },
          },
        },
        token,
      ),
      env,
    );
    const body = (await res.json()) as {
      result: { isError: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain(
      'Unknown or expired sessionId',
    );
  });

  it('requires Authorization bearer for delta_v_quick_match', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'delta_v_quick_match',
          arguments: { scenario: 'duel' },
        },
      }),
      env,
    );
    const body = (await res.json()) as {
      result: { isError: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain(
      'delta_v_quick_match requires Authorization',
    );
  });

  it('rejects invalid rendezvousCode at MCP validation time', async () => {
    const { env, calls } = buildEnv(() => new Response('{}'));
    const { token } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_rendezvous',
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 31,
          method: 'tools/call',
          params: {
            name: 'delta_v_quick_match',
            arguments: {
              rendezvousCode: 'rdv_a',
              waitForOpponent: false,
            },
          },
        },
        token,
      ),
      env,
    );

    const body = (await res.json()) as {
      result: { isError: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain('rendezvousCode');
    expect(calls).toHaveLength(0);
  });

  it('rejects unknown quick-match fields instead of dropping them', async () => {
    const { env, calls } = buildEnv(() => new Response('{}'));
    const { token } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_unknown_field',
    });
    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 32,
          method: 'tools/call',
          params: {
            name: 'delta_v_quick_match_connect',
            arguments: {
              ticket: 'stale-ticket',
            },
          },
        },
        token,
      ),
      env,
    );

    const body = (await res.json()) as {
      result: { isError: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain('ticket');
    expect(calls).toHaveLength(0);
  });

  it('truncates inferred quick-match usernames to the backend cap', async () => {
    const { env, calls } = buildEnv((req) => {
      if (req.url.endsWith('/enqueue')) {
        return Response.json({
          status: 'queued',
          ticket: 'TICKET',
          scenario: 'duel',
        });
      }
      return Response.json({});
    });
    const { token } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_claude_code_tester_001',
    });

    await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 33,
          method: 'tools/call',
          params: {
            name: 'delta_v_quick_match',
            arguments: { waitForOpponent: false },
          },
        },
        token,
      ),
      env,
    );

    const body = (await calls[0].json()) as {
      player?: { username?: unknown };
    };
    expect(body.player?.username).toBe('agent_claude_code_te');
  });

  it('validates send_action shape before resolving the session', async () => {
    const { env, calls } = buildEnv(() => new Response('{}'));
    const { token: agentToken } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_invalid_action',
    });

    const res = await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 34,
          method: 'tools/call',
          params: {
            name: 'delta_v_send_action',
            arguments: {
              sessionId: 'not-a-real-session',
              action: { type: 'astrogation' },
            },
          },
        },
        agentToken,
      ),
      env,
    );

    const body = (await res.json()) as {
      result: { isError: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain('Invalid action payload');
    expect(calls).toHaveLength(0);
  });

  it('forwards delta_v_send_action body to the GAME DO', async () => {
    const { env, calls } = buildEnv(() =>
      Response.json({
        ok: true,
        accepted: true,
        actionType: 'skipOrdnance',
      }),
    );
    const { token: agentToken } = await issueAgentToken({
      secret: TEST_SECRET,
      playerKey: 'agent_test_send_action',
    });
    const { token: matchToken } = await issueMatchToken({
      secret: TEST_SECRET,
      code: 'ABCDE',
      playerToken: 'X'.repeat(32),
      agentToken,
    });
    await handleMcpHttpRequest(
      postAuthorized(
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'delta_v_send_action',
            arguments: {
              matchToken,
              action: { type: 'skipOrdnance' },
              waitForResult: true,
            },
          },
        },
        agentToken,
      ),
      env,
    );
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe('/mcp/action');
    const forwarded = (await calls[0].json()) as Record<string, unknown>;
    expect(forwarded.action).toEqual({ type: 'skipOrdnance' });
    expect(forwarded.waitForResult).toBe(true);
  });
});
