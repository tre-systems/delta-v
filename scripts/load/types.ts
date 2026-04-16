import type { AIDifficulty } from '../../src/shared/ai';

export interface LoadTestConfig {
  serverUrl: string;
  scenario: string;
  games: number;
  concurrency: number;
  spawnDelayMs: number;
  thinkMinMs: number;
  thinkMaxMs: number;
  disconnectRate: number;
  reconnectDelayMs: number;
  gameTimeoutMs: number;
  difficulty: AIDifficulty;
}

// Error bins for the load harness. `serverErrors` previously lumped every
// failure class into a single counter which made load output unactionable
// (a 429 looks identical to a stale-action rejection). Keeping the legacy
// `serverErrors` as a total for backwards compatibility; new breakdowns
// below let harness consumers see which class is driving a bad run.
export interface ErrorBreakdown {
  http4xx: number;
  http5xx: number;
  rateLimited: number;
  actionRejected: number;
  timeout: number;
  invalidInput: number;
  authError: number;
  stateConflict: number;
  other: number;
}

export const createErrorBreakdown = (): ErrorBreakdown => ({
  http4xx: 0,
  http5xx: 0,
  rateLimited: 0,
  actionRejected: 0,
  timeout: 0,
  invalidInput: 0,
  authError: 0,
  stateConflict: 0,
  other: 0,
});

export interface MatchMetrics {
  id: number;
  code: string;
  turns: number;
  winner: number | null;
  reason: string;
  durationMs: number;
  reconnectAttempts: number;
  reconnectSuccesses: number;
  serverErrors: number;
  socketErrors: number;
  actionsSent: number;
  errorBreakdown: ErrorBreakdown;
}

export interface AggregateMetrics {
  started: number;
  completed: number;
  failed: number;
  reconnectAttempts: number;
  reconnectSuccesses: number;
  serverErrors: number;
  socketErrors: number;
  actionsSent: number;
  totalTurns: number;
  totalDurationMs: number;
  winReasons: Map<string, number>;
  errorBreakdown: ErrorBreakdown;
}

export interface CreateGameResponse {
  code: string;
  playerToken: string;
}
