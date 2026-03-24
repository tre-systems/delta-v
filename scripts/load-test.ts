import WebSocket from 'ws';

import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiOrdnance,
} from '../src/shared/ai';
import { SHIP_STATS } from '../src/shared/constants';
import { buildSolarSystemMap, SCENARIOS } from '../src/shared/map-data';
import type {
  AstrogationOrder,
  FleetPurchase,
  GameState,
} from '../src/shared/types/domain';
import type { C2S, S2C } from '../src/shared/types/protocol';

interface LoadTestConfig {
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

interface MatchMetrics {
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

interface AggregateMetrics {
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

interface CreateGameResponse {
  code: string;
  playerToken: string;
}

const DEFAULT_SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8787';
const map = buildSolarSystemMap();

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const parseIntegerFlag = (
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseNumberFlag = (
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const printUsage = (): void => {
  console.log(`Delta-V websocket load / chaos tester

Usage:
  npm run load:test -- --games 20 --concurrency 5

Flags:
  --server-url         Worker base URL (default: ${DEFAULT_SERVER_URL})
  --scenario           Scenario key to create (default: biplanetary)
  --games              Total matches to run (default: 10)
  --concurrency        Concurrent matches in flight (default: 4)
  --spawn-delay-ms     Delay between launches (default: 250)
  --think-min-ms       Minimum per-action think delay (default: 150)
  --think-max-ms       Maximum per-action think delay (default: 600)
  --disconnect-rate    Fraction of bots that inject one reconnect (default: 0.1)
  --reconnect-delay-ms Delay before reconnect after chaos drop (default: 1500)
  --game-timeout-ms    Fail a match if it runs too long (default: 120000)
  --difficulty         AI difficulty: easy | normal | hard (default: normal)
  --help               Show this help
`);
};

const parseArgs = (argv: string[]): LoadTestConfig => {
  const args = [...argv];
  const getFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);

    if (index === -1) return undefined;

    return args[index + 1];
  };

  if (args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const scenario = getFlag('--scenario') ?? 'biplanetary';

  if (!(scenario in SCENARIOS)) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }

  const difficultyRaw = getFlag('--difficulty') ?? 'normal';

  if (
    difficultyRaw !== 'easy' &&
    difficultyRaw !== 'normal' &&
    difficultyRaw !== 'hard'
  ) {
    throw new Error(`Unknown difficulty: ${difficultyRaw}`);
  }

  const games = Math.max(1, parseIntegerFlag(getFlag('--games'), 10));
  const concurrency = clamp(
    parseIntegerFlag(getFlag('--concurrency'), 4),
    1,
    games,
  );

  return {
    serverUrl: getFlag('--server-url') ?? DEFAULT_SERVER_URL,
    scenario,
    games,
    concurrency,
    spawnDelayMs: Math.max(
      0,
      parseIntegerFlag(getFlag('--spawn-delay-ms'), 250),
    ),
    thinkMinMs: Math.max(0, parseIntegerFlag(getFlag('--think-min-ms'), 150)),
    thinkMaxMs: Math.max(0, parseIntegerFlag(getFlag('--think-max-ms'), 600)),
    disconnectRate: clamp(
      parseNumberFlag(getFlag('--disconnect-rate'), 0.1),
      0,
      1,
    ),
    reconnectDelayMs: Math.max(
      0,
      parseIntegerFlag(getFlag('--reconnect-delay-ms'), 1500),
    ),
    gameTimeoutMs: Math.max(
      1000,
      parseIntegerFlag(getFlag('--game-timeout-ms'), 120_000),
    ),
    difficulty: difficultyRaw,
  };
};

const buildFleetPurchases = (
  state: GameState,
  playerId: number,
  difficulty: AIDifficulty,
): FleetPurchase[] => {
  const credits = state.players[playerId].credits ?? 0;
  const scenarioDef =
    Object.values(SCENARIOS).find(
      (scenario) => scenario.name === state.scenario,
    ) ?? null;
  const available =
    scenarioDef?.availableShipTypes ??
    Object.keys(SHIP_STATS).filter((type) => type !== 'orbitalBase');
  const priorities =
    difficulty === 'hard'
      ? ['dreadnaught', 'frigate', 'torch', 'corsair', 'corvette']
      : difficulty === 'easy'
        ? ['corvette', 'corsair', 'packet', 'transport']
        : ['frigate', 'corsair', 'corvette', 'packet'];
  const purchases: FleetPurchase[] = [];
  let remaining = credits;

  for (const shipType of priorities) {
    if (!available.includes(shipType)) continue;
    const cost = SHIP_STATS[shipType]?.cost ?? Number.POSITIVE_INFINITY;

    while (remaining >= cost) {
      purchases.push({ shipType });
      remaining -= cost;
    }
  }

  return purchases;
};

const buildIdleAstrogationOrders = (
  state: GameState,
  playerId: number,
): AstrogationOrder[] =>
  state.ships
    .filter((ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed')
    .map((ship) => ({
      shipId: ship.id,
      burn: null,
      overload: null,
    }));

const hasOwnedPendingAsteroidHazards = (
  state: GameState,
  playerId: number,
): boolean =>
  state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );

    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });

class BotClient {
  private ws: WebSocket | null = null;
  private playerId = -1;
  private playerToken: string | null;
  private readonly map = map;
  private readonly shouldInjectChaos: boolean;
  private chaosInjected = false;
  private reconnectPending = false;
  private readonly actionKeys = new Set<string>();
  private actionTimer: NodeJS.Timeout | null = null;
  private settledResult = false;

  constructor(
    private readonly label: string,
    private readonly gameCode: string,
    private readonly config: LoadTestConfig,
    private readonly metrics: MatchMetrics,
    playerToken: string | null,
    private readonly onGameOver: (state: GameState) => void,
  ) {
    this.playerToken = playerToken;
    this.shouldInjectChaos = Math.random() < config.disconnectRate;
  }

  async connect(): Promise<void> {
    const tokenQuery = this.playerToken
      ? `?playerToken=${encodeURIComponent(this.playerToken)}`
      : '';
    const wsUrl =
      this.config.serverUrl.replace(/^http/, 'ws') +
      `/ws/${this.gameCode}${tokenQuery}`;

    await new Promise<void>((resolve, reject) => {
      this.settledResult = false;

      const ws = new WebSocket(wsUrl);

      this.ws = ws;

      ws.once('open', () => {
        this.finishConnect(resolve);
      });

      ws.once('unexpected-response', (_request, response) => {
        const reason = response.statusMessage || `HTTP ${response.statusCode}`;

        this.finishConnectReject(reject, new Error(reason));
      });

      ws.once('error', (error) => {
        this.metrics.socketErrors++;
        this.finishConnectReject(reject, error as Error);
      });

      ws.on('message', (data) => {
        void this.handleMessage(data);
      });

      ws.on('close', () => {
        this.clearActionTimer();

        if (this.reconnectPending) {
          return;
        }
      });
    });
  }

  disconnect(): void {
    this.reconnectPending = false;
    this.clearActionTimer();
    this.ws?.close();
  }

  private finishConnect(resolve: () => void): void {
    if (this.settledResult) return;
    this.settledResult = true;
    resolve();
  }

  private finishConnectReject(
    reject: (error: Error) => void,
    error: Error,
  ): void {
    if (this.settledResult) return;
    this.settledResult = true;
    reject(error);
  }

  private clearActionTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  private send(message: C2S): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
    this.metrics.actionsSent++;
  }

  private scheduleAction(state: GameState): void {
    if (state.activePlayer !== this.playerId) return;

    const actionKey = [
      state.gameId,
      state.turnNumber,
      state.phase,
      state.activePlayer,
      this.playerId,
    ].join(':');

    if (this.actionKeys.has(actionKey)) {
      return;
    }
    this.actionKeys.add(actionKey);

    if (
      this.shouldInjectChaos &&
      !this.chaosInjected &&
      this.playerToken &&
      state.phase !== 'gameOver'
    ) {
      this.chaosInjected = true;
      this.metrics.reconnectAttempts++;
      this.reconnectPending = true;
      this.clearActionTimer();
      this.ws?.close();
      setTimeout(() => {
        void this.reconnect();
      }, this.config.reconnectDelayMs);
      return;
    }

    const thinkSpan = Math.max(
      this.config.thinkMaxMs - this.config.thinkMinMs,
      0,
    );
    const thinkDelay =
      this.config.thinkMinMs + Math.floor(Math.random() * (thinkSpan + 1));

    this.clearActionTimer();
    this.actionTimer = setTimeout(() => {
      this.actionTimer = null;
      this.performAction(state);
    }, thinkDelay);
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect();
      this.metrics.reconnectSuccesses++;
    } catch (error) {
      this.metrics.socketErrors++;
      console.error(`[${this.label}] reconnect failed`, error);
    } finally {
      this.reconnectPending = false;
    }
  }

  private performAction(state: GameState): void {
    switch (state.phase) {
      case 'fleetBuilding':
        this.send({
          type: 'fleetReady',
          purchases: buildFleetPurchases(
            state,
            this.playerId,
            this.config.difficulty,
          ),
        });
        return;
      case 'astrogation': {
        const orders = aiAstrogation(
          state,
          this.playerId,
          this.map,
          this.config.difficulty,
        );

        this.send({
          type: 'astrogation',
          orders:
            orders.length > 0
              ? orders
              : buildIdleAstrogationOrders(state, this.playerId),
        });
        return;
      }
      case 'ordnance': {
        const launches = aiOrdnance(
          state,
          this.playerId,
          this.map,
          this.config.difficulty,
        );

        if (launches.length > 0) {
          this.send({ type: 'ordnance', launches });
        } else {
          this.send({ type: 'skipOrdnance' });
        }
        return;
      }
      case 'combat': {
        if (hasOwnedPendingAsteroidHazards(state, this.playerId)) {
          this.send({ type: 'beginCombat' });
          return;
        }

        const attacks = aiCombat(
          state,
          this.playerId,
          this.map,
          this.config.difficulty,
        );

        if (attacks.length > 0) {
          this.send({ type: 'combat', attacks });
        } else {
          this.send({ type: 'skipCombat' });
        }
        return;
      }
      case 'logistics':
        this.send({ type: 'skipLogistics' });
        return;
      case 'gameOver':
        this.onGameOver(state);
        return;
      default:
        return;
    }
  }

  private async handleMessage(raw: WebSocket.RawData): Promise<void> {
    let message: S2C;

    try {
      message = JSON.parse(raw.toString()) as S2C;
    } catch (error) {
      this.metrics.socketErrors++;
      console.error(`[${this.label}] invalid message payload`, error);
      return;
    }

    switch (message.type) {
      case 'welcome':
        this.playerId = message.playerId;
        this.playerToken = message.playerToken;
        return;
      case 'matchFound':
        return;
      case 'gameStart':
      case 'movementResult':
      case 'combatResult':
      case 'stateUpdate':
        this.metrics.turns = Math.max(
          this.metrics.turns,
          message.state.turnNumber,
        );
        this.scheduleAction(message.state);

        if (message.state.phase === 'gameOver') {
          this.onGameOver(message.state);
        }
        return;
      case 'gameOver':
        return;
      case 'error':
        this.metrics.serverErrors++;
        console.error(`[${this.label}] server error: ${message.message}`);
        return;
      case 'pong':
      case 'rematchPending':
      case 'chat':
        return;
    }
  }
}

const createGame = async (
  config: LoadTestConfig,
): Promise<CreateGameResponse> => {
  const response = await fetch(`${config.serverUrl}/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scenario: config.scenario,
    }),
  });

  if (!response.ok) {
    throw new Error(`create failed: HTTP ${response.status}`);
  }

  return (await response.json()) as CreateGameResponse;
};

const runMatch = async (
  id: number,
  config: LoadTestConfig,
): Promise<MatchMetrics> => {
  const createdAt = Date.now();
  const createResponse = await createGame(config);
  const metrics: MatchMetrics = {
    id,
    code: createResponse.code,
    turns: 0,
    winner: null,
    reason: 'unfinished',
    durationMs: 0,
    reconnectAttempts: 0,
    reconnectSuccesses: 0,
    serverErrors: 0,
    socketErrors: 0,
    actionsSent: 0,
  };

  let resolved = false;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let host: BotClient | null = null;
  let guest: BotClient | null = null;

  const finish = (state: GameState | null, error?: Error): MatchMetrics => {
    if (resolved) {
      return metrics;
    }
    resolved = true;

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    host?.disconnect();
    guest?.disconnect();

    metrics.durationMs = Date.now() - createdAt;

    if (error) {
      metrics.reason = error.message;
      metrics.winner = null;
      return metrics;
    }

    if (state) {
      metrics.turns = Math.max(metrics.turns, state.turnNumber);
      metrics.winner = state.winner;
      metrics.reason = state.winReason ?? 'gameOver';
    }

    return metrics;
  };

  try {
    const completion = new Promise<MatchMetrics>((resolve, reject) => {
      const onGameOver = (state: GameState) => {
        resolve(finish(state));
      };

      timeoutHandle = setTimeout(() => {
        resolve(finish(null, new Error('match timeout')));
      }, config.gameTimeoutMs);

      host = new BotClient(
        `match-${id}-host`,
        createResponse.code,
        config,
        metrics,
        createResponse.playerToken,
        onGameOver,
      );
      guest = new BotClient(
        `match-${id}-guest`,
        createResponse.code,
        config,
        metrics,
        null,
        onGameOver,
      );

      void host
        .connect()
        .then(async () => {
          await delay(100);
          await guest?.connect();
        })
        .catch((error) => {
          reject(error);
        });
    });

    return await completion;
  } catch (error) {
    return finish(
      null,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
};

const printMatchResult = (metrics: MatchMetrics): void => {
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

const printSummary = (
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

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2));
  const aggregate: AggregateMetrics = {
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
  };

  console.log(
    `Starting websocket load test: ${config.games} games, ` +
      `concurrency ${config.concurrency}, scenario ${config.scenario}`,
  );

  let nextMatchId = 0;

  const worker = async () => {
    while (nextMatchId < config.games) {
      const matchId = nextMatchId++;

      aggregate.started++;

      try {
        const result = await runMatch(matchId, config);

        if (
          result.reason === 'match timeout' ||
          result.reason.startsWith('create failed:') ||
          result.reason.startsWith('socket error:') ||
          result.reason.startsWith('server error:')
        ) {
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
        printMatchResult(result);
      } catch (error) {
        aggregate.failed++;
        console.error(`[match ${matchId}] fatal error`, error);
      }

      if (config.spawnDelayMs > 0) {
        await delay(config.spawnDelayMs);
      }
    }
  };

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  printSummary(config, aggregate);

  if (aggregate.failed > 0 || aggregate.serverErrors > 0) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
