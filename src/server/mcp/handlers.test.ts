import { describe, expect, it, vi } from 'vitest';

import { issueAgentToken, issueMatchToken } from '../auth';
import type { Env } from '../env';
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
  const env = {
    GAME: namespace,
    MATCHMAKER: namespace, // not exercised here; keep shape
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
      'delta_v_get_observation',
      'delta_v_get_state',
      'delta_v_quick_match',
      'delta_v_send_action',
      'delta_v_send_chat',
      'delta_v_wait_for_turn',
    ]);
    void server; // keep import used
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
    const token = 'X'.repeat(32);
    const res = await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'delta_v_get_state',
          arguments: { code: 'ABCDE', playerToken: token },
        },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe('/mcp/state');
    expect(new URL(calls[0].url).searchParams.get('playerToken')).toBe(token);

    const body = (await res.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).not.toBe(true);
  });

  it('rejects malformed code on tool call', async () => {
    const { env } = buildEnv(() => new Response('{}'));
    const res = await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'delta_v_get_state',
          arguments: {
            code: 'lower',
            playerToken: 'X'.repeat(32),
          },
        },
      }),
      env,
    );
    const body = (await res.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
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

  it('resolves matchToken into code+playerToken when calling get_state', async () => {
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

  it('rejects tool call with neither matchToken nor code+playerToken', async () => {
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
    const body = (await res.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
  });

  it('forwards delta_v_send_action body to the GAME DO', async () => {
    const { env, calls } = buildEnv(() =>
      Response.json({
        ok: true,
        accepted: true,
        actionType: 'skipOrdnance',
      }),
    );
    const token = 'X'.repeat(32);
    await handleMcpHttpRequest(
      post({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'delta_v_send_action',
          arguments: {
            code: 'ABCDE',
            playerToken: token,
            action: { type: 'skipOrdnance' },
            waitForResult: true,
          },
        },
      }),
      env,
    );
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe('/mcp/action');
    const forwarded = (await calls[0].json()) as Record<string, unknown>;
    expect(forwarded.action).toEqual({ type: 'skipOrdnance' });
    expect(forwarded.waitForResult).toBe(true);
  });
});
