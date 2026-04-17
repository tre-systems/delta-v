// HMAC secret resolution for agentToken / matchToken signing.
//
// Production: set via `wrangler secret put AGENT_TOKEN_SECRET`. The Worker
// reads it from the bound env. Rotation: issue a new secret, redeploy —
// existing tokens become invalid (they all carry the same signer).
//
// Dev / test: set DEV_MODE=1 in wrangler.toml and the fallback kicks in.
// Tokens signed under the dev secret are explicitly invalid in production
// (the prod secret will differ).
//
// If AGENT_TOKEN_SECRET is unset and DEV_MODE is not '1', callers receive
// MissingAgentTokenSecretError — the HTTP boundary translates that into
// a 500 so a mis-deployed Worker fails closed instead of silently signing
// with a public placeholder.

import type { Env } from '../env';

const DEV_SECRET =
  'delta-v-dev-only-agent-token-secret-do-not-use-in-production';

export class MissingAgentTokenSecretError extends Error {
  constructor() {
    super(
      'AGENT_TOKEN_SECRET is not set. Configure it via `wrangler secret put AGENT_TOKEN_SECRET` for production, or set DEV_MODE=1 for local dev.',
    );
    this.name = 'MissingAgentTokenSecretError';
  }
}

export const isAgentTokenSecretSet = (env: Env): boolean =>
  Boolean(env.AGENT_TOKEN_SECRET && env.AGENT_TOKEN_SECRET.length >= 16);

const isDevFallbackAllowed = (env: Env): boolean => env.DEV_MODE === '1';

export const resolveAgentTokenSecret = (env: Env): string => {
  if (isAgentTokenSecretSet(env)) {
    return env.AGENT_TOKEN_SECRET as string;
  }
  if (isDevFallbackAllowed(env)) {
    return DEV_SECRET;
  }
  throw new MissingAgentTokenSecretError();
};
