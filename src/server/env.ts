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
  // packages/mcp-adapter/src/handlers.ts.
  MCP_RATE_LIMITER?: CreateRateLimiterBinding;
  MATCH_ARCHIVE?: R2Bucket;
  // Shared secret for the internal GET /api/metrics route. Send as
  // `Authorization: Bearer <token>`. Leave unset to disable the route
  // outside loopback dev/test requests.
  INTERNAL_METRICS_TOKEN?: string;
  // HMAC secret for signing agentToken / matchToken. Set via
  // `wrangler secret put AGENT_TOKEN_SECRET` in production. Requests
  // that need the secret fail with 500 when it is unset unless
  // DEV_MODE is enabled.
  AGENT_TOKEN_SECRET?: string;
  // Set to '1' for local dev / test to allow a deterministic
  // placeholder secret when AGENT_TOKEN_SECRET is unset. Unset in
  // production so missing secrets fail closed.
  DEV_MODE?: string;
  // Optional Cloudflare deployment metadata. When present, /healthz
  // reports the current deployment id as `sha`.
  CF_VERSION_METADATA?: {
    id?: string;
  };
  // Optional deploy metadata injected by the platform or CI. Used as a
  // fallback when version metadata is unavailable.
  CF_PAGES_COMMIT_SHA?: string;
  GIT_COMMIT_SHA?: string;
}
