import { describe, expect, it, vi } from 'vitest';
import { issueAgentToken } from '../../../src/server/auth';
import type { Env } from '../../../src/server/env';
import { handleMcpHttpRequest } from './handlers';

const secret = 'synthetic-mcp-limit-secret-32-chars';
const tool = 'delta_v_list_sessions';

const fixture = () => {
  const fetch = vi.fn(async () => Response.json({ matches: [] }));
  const env = {
    AGENT_TOKEN_SECRET: secret,
    IP_HASH_SALT: 'synthetic-mcp-limit-salt',
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    LIVE_REGISTRY: {
      get: () => ({ fetch }),
      idFromName: (name: string) => name,
    },
  } as unknown as Env;
  return { env, fetch };
};

const request = async (args: unknown, modern: boolean) => {
  const { token } = await issueAgentToken({
    secret,
    playerKey: 'agent_limits_fixture',
  });
  return new Request('https://w.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json,text/event-stream',
      authorization: `Bearer ${token}`,
      ...(modern
        ? {
            'mcp-method': 'tools/call',
            'mcp-name': tool,
            'mcp-protocol-version': '2026-07-28',
          }
        : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: tool,
        arguments: args,
        ...(modern
          ? {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': {
                  name: 'limits-fixture',
                  version: '0',
                },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            }
          : {}),
      },
    }),
  });
};

describe.each([false, true])('hosted MCP limits (modern=%s)', (modern) => {
  it.each([
    'array',
    'object',
  ])('bounds %s input before registry dispatch', async (kind) => {
    const { env, fetch } = fixture();
    const values = Array.from({ length: 2000 }, (_, i) => [i.toString(36), 0]);
    const padding: unknown =
      kind === 'array' ? values.map(() => 0) : Object.fromEntries(values);
    const response = await handleMcpHttpRequest(
      await request({ padding }, modern),
      env,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { result: { isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(JSON.stringify(body)).toContain('maximum of 2000 elements');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts boundary and normal calls on fresh servers', async () => {
    const { env, fetch } = fixture();
    for (const args of [{ padding: Array(1999).fill(0) }, {}]) {
      const response = await handleMcpHttpRequest(
        await request(args, modern),
        env,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as { result: { isError?: boolean } };
      expect(body.result.isError).not.toBe(true);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('counts UTF-8 bytes despite a misleading declared length', async () => {
    const { env, fetch } = fixture();
    const req = await request({ padding: '界'.repeat(6000) }, modern);
    req.headers.set('content-length', '1');
    expect((await handleMcpHttpRequest(req, env)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('cancels oversized chunked input before buffering the complete request', async () => {
  const { env, fetch } = fixture();
  let pulls = 0;
  const cancel = vi.fn();
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(10_000));
      if (pulls === 100) controller.close();
    },
    cancel,
  });
  const req = new Request('https://w.test/mcp', {
    method: 'POST',
    body,
    duplex: 'half',
    headers: { 'content-type': 'application/json' },
  } as RequestInit);
  expect((await handleMcpHttpRequest(req, env)).status).toBe(413);
  expect(cancel).toHaveBeenCalledOnce();
  expect(pulls).toBeLessThan(5);
  expect(fetch).not.toHaveBeenCalled();
});
