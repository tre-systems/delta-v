// HMAC secret resolution for agentToken / matchToken signing.
//
// Production: set via `wrangler secret put AGENT_TOKEN_SECRET`. The Worker
// reads it from the bound env. Rotation: issue a new secret, redeploy —
// existing tokens become invalid (they all carry the same signer).
//
// Dev / test: fall back to a fixed placeholder. Tokens signed under the dev
// secret are explicitly invalid in production (the prod secret will differ).
// We log a one-time warning so the fallback isn't accidentally relied on.

import type { Env } from '../env';

const DEV_SECRET =
  'delta-v-dev-only-agent-token-secret-do-not-use-in-production';

let warned = false;

export const resolveAgentTokenSecret = (env: Env): string => {
  if (env.AGENT_TOKEN_SECRET && env.AGENT_TOKEN_SECRET.length >= 16) {
    return env.AGENT_TOKEN_SECRET;
  }
  if (!warned) {
    console.warn(
      'AGENT_TOKEN_SECRET unset — using dev fallback. Set via wrangler secret put AGENT_TOKEN_SECRET for production.',
    );
    warned = true;
  }
  return DEV_SECRET;
};
