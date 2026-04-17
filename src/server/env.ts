export interface CreateRateLimiterBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  LIVE_REGISTRY?: DurableObjectNamespace;
  DB: D1Database;
  CREATE_RATE_LIMITER?: CreateRateLimiterBinding;
  // Global rate limiters for /telemetry and /error. Backed by Cloudflare
  // [[ratelimits]] namespaces so limits apply across isolates (a
  // distributed attacker cycling POPs can no longer bypass the per-
  // isolate Map counters).
  TELEMETRY_RATE_LIMITER?: CreateRateLimiterBinding;
  ERROR_RATE_LIMITER?: CreateRateLimiterBinding;
  // Per-agent / per-IP limiter for the hosted MCP entry point. Keyed on
  // the agentToken hash when available, hashed IP otherwise. See
  // src/server/mcp/handlers.ts.
  MCP_RATE_LIMITER?: CreateRateLimiterBinding;
  MATCH_ARCHIVE?: R2Bucket;
  // HMAC secret for signing agentToken / matchToken. Set via
  // `wrangler secret put AGENT_TOKEN_SECRET` in production. Requests
  // that need the secret fail with 500 when it is unset unless
  // DEV_MODE is enabled.
  AGENT_TOKEN_SECRET?: string;
  // Set to '1' for local dev / test to allow a deterministic
  // placeholder secret when AGENT_TOKEN_SECRET is unset. Unset in
  // production so missing secrets fail closed.
  DEV_MODE?: string;
}
