import type { AggregateMetrics, LoadTestConfig, MatchMetrics } from './types';

const isFailedMatch = (reason: string): boolean =>
  reason === 'match timeout' ||
  reason.startsWith('create failed:') ||
  reason.startsWith('socket error:') ||
  reason.startsWith('server error:');

export const createAggregateMetrics = (): AggregateMetrics => ({
  started: 0,
  completed: 0,
  failed: 0,
  reconnectAttempts: 0,
  reconnectSuccesses: 0,
  serverErrors: 0,
  socketErrors: 0,
  actionsSent: 0,
  totalTurns: 0,
  totalDurationMs: 0,
  winReasons: new Map(),
});

export const recordMatchResult = (
  aggregate: AggregateMetrics,
  result: MatchMetrics,
): void => {
  if (isFailedMatch(result.reason)) {
    aggregate.failed++;
  } else {
    aggregate.completed++;
  }

  aggregate.reconnectAttempts += result.reconnectAttempts;
  aggregate.reconnectSuccesses += result.reconnectSuccesses;
  aggregate.serverErrors += result.serverErrors;
  aggregate.socketErrors += result.socketErrors;
  aggregate.actionsSent += result.actionsSent;
  aggregate.totalTurns += result.turns;
  aggregate.totalDurationMs += result.durationMs;
  aggregate.winReasons.set(
    result.reason,
    (aggregate.winReasons.get(result.reason) ?? 0) + 1,
  );
};

export const printMatchResult = (metrics: MatchMetrics): void => {
  const reconnectSummary =
    metrics.reconnectAttempts > 0
      ? ` reconnect=${metrics.reconnectSuccesses}/${metrics.reconnectAttempts}`
      : '';

  console.log(
    [
      `[match ${metrics.id}]`,
      metrics.code,
      `winner=${metrics.winner ?? 'draw'}`,
      `turns=${metrics.turns}`,
      `reason=${metrics.reason}`,
      `duration=${metrics.durationMs}ms`,
      `actions=${metrics.actionsSent}`,
      reconnectSummary,
    ]
      .filter(Boolean)
      .join(' '),
  );
};

export const printSummary = (
  config: LoadTestConfig,
  aggregate: AggregateMetrics,
): void => {
  const averageTurns =
    aggregate.completed > 0 ? aggregate.totalTurns / aggregate.completed : 0;
  const averageDuration =
    aggregate.completed > 0
      ? aggregate.totalDurationMs / aggregate.completed
      : 0;

  console.log('\n=== Load Test Summary ===');
  console.log(`server: ${config.serverUrl}`);
  console.log(`scenario: ${config.scenario}`);
  console.log(`games: ${aggregate.started}`);
  console.log(`completed: ${aggregate.completed}`);
  console.log(`failed: ${aggregate.failed}`);
  console.log(`average turns: ${averageTurns.toFixed(1)}`);
  console.log(`average duration: ${averageDuration.toFixed(0)}ms`);
  console.log(
    `reconnects: ${aggregate.reconnectSuccesses}/${aggregate.reconnectAttempts}`,
  );
  console.log(`server errors: ${aggregate.serverErrors}`);
  console.log(`socket errors: ${aggregate.socketErrors}`);
  console.log(`actions sent: ${aggregate.actionsSent}`);

  if (aggregate.winReasons.size > 0) {
    console.log('\nwin reasons:');

    for (const [reason, count] of aggregate.winReasons.entries()) {
      console.log(`  - ${reason}: ${count}`);
    }
  }
};
