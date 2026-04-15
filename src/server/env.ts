export interface CreateRateLimiterBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  DB: D1Database;
  CREATE_RATE_LIMITER?: CreateRateLimiterBinding;
  MATCH_ARCHIVE?: R2Bucket;
  // HMAC secret for signing agentToken / matchToken. Set via
  // `wrangler secret put AGENT_TOKEN_SECRET` in production. In dev/test
  // we fall back to a deterministic placeholder so signing works locally
  // without configuration.
  AGENT_TOKEN_SECRET?: string;
}
