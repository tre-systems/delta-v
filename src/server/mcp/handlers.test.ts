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
          id: 11,
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
        id: 12,
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
