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
}

export interface CreateGameResponse {
  code: string;
  playerToken: string;
}
