import { describe, expect, it } from 'vitest';

import type { Env } from '../env';
import { verifyAgentToken } from './';
import { handleAgentTokenIssue } from './issue-route';

const TEST_SECRET = 'issue-route-test-secret-must-be-16-chars';

const env = (): Env =>
  ({
    AGENT_TOKEN_SECRET: TEST_SECRET,
  }) as unknown as Env;

const post = (body: unknown): Request =>
  new Request('https://w.test/api/agent-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('handleAgentTokenIssue', () => {
  it('rejects non-POST methods', async () => {
    const res = await handleAgentTokenIssue(
      new Request('https://w.test/api/agent-token', { method: 'GET' }),
      env(),
    );
    expect(res.status).toBe(405);
  });

  it('rejects malformed JSON', async () => {
    const res = await handleAgentTokenIssue(
      new Request('https://w.test/api/agent-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing playerKey', async () => {
    const res = await handleAgentTokenIssue(post({}), env());
    expect(res.status).toBe(400);
  });

  it('rejects non-agent_-prefixed playerKey', async () => {
    const res = await handleAgentTokenIssue(
      post({ playerKey: 'human_user' }),
      env(),
    );
    expect(res.status).toBe(400);
  });

  it('issues a valid token for a well-formed agent_ key', async () => {
    const res = await handleAgentTokenIssue(
      post({ playerKey: 'agent_alpha-v1' }),
      env(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      token: string;
      expiresAt: number;
      ttlMs: number;
      playerKey: string;
      tokenType: string;
    };
    expect(body.ok).toBe(true);
    expect(body.tokenType).toBe('Bearer');
    expect(body.playerKey).toBe('agent_alpha-v1');
    expect(body.ttlMs).toBe(86_400_000);

    const verified = await verifyAgentToken(body.token, {
      secret: TEST_SECRET,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.playerKey).toBe('agent_alpha-v1');
    }
  });
});
