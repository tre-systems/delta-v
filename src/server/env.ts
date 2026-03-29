export interface CreateRateLimiterBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
  DB: D1Database;
  CREATE_RATE_LIMITER?: CreateRateLimiterBinding;
  MATCH_ARCHIVE?: R2Bucket;
}
