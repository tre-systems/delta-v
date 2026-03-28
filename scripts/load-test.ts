import WebSocket from 'ws';

import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiOrdnance,
} from '../src/shared/ai';
import { SHIP_STATS, type ShipType } from '../src/shared/constants';
import { buildSolarSystemMap, SCENARIOS } from '../src/shared/map-data';
import type {
  AstrogationOrder,
  FleetPurchase,
  FleetPurchaseOption,
  GameState,
  PlayerId,
  PurchasableShipType,
} from '../src/shared/types/domain';
import type { C2S, S2C } from '../src/shared/types/protocol';
import { parseArgs } from './load/config';
import {
  createAggregateMetrics,
  printMatchResult,
  printSummary,
  recordMatchResult,
} from './load/report';
import type {
  CreateGameResponse,
  LoadTestConfig,
  MatchMetrics,
} from './load/types';

const map = buildSolarSystemMap();

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const buildFleetPurchases = (
  state: GameState,
  playerId: PlayerId,
  difficulty: AIDifficulty,
): FleetPurchase[] => {
  const credits = state.players[playerId].credits ?? 0;
  const scenarioDef =
    Object.values(SCENARIOS).find(
      (scenario) => scenario.name === state.scenario,
    ) ?? null;
  const availableFleetPurchases: FleetPurchaseOption[] =
    scenarioDef?.availableFleetPurchases ??
    ((Object.keys(SHIP_STATS) as ShipType[]).filter(
      (type): type is PurchasableShipType => type !== 'orbitalBase',
    ) as FleetPurchaseOption[]);
  const available = new Set<PurchasableShipType>(
    availableFleetPurchases.filter(
      (purchase): purchase is PurchasableShipType =>
        purchase !== 'orbitalBaseCargo',
    ),
  );
  const priorities: PurchasableShipType[] =
    difficulty === 'hard'
      ? ['dreadnaught', 'frigate', 'torch', 'corsair', 'corvette']
      : difficulty === 'easy'
        ? ['corvette', 'corsair', 'packet', 'transport']
        : ['frigate', 'corsair', 'corvette', 'packet'];
  const purchases: FleetPurchase[] = [];
  let remaining = credits;

  for (const shipType of priorities) {
    if (!available.has(shipType)) continue;
    const cost = SHIP_STATS[shipType].cost;

    while (remaining >= cost) {
      purchases.push({ kind: 'ship', shipType });
      remaining -= cost;
    }
  }

  return purchases;
};

const buildIdleAstrogationOrders = (
  state: GameState,
  playerId: PlayerId,
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
  playerId: PlayerId,
): boolean =>
  state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );

    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });

const createBotClient = (
  label: string,
  gameCode: string,
  config: LoadTestConfig,
  metrics: MatchMetrics,
  initialPlayerToken: string | null,
  onGameOver: (state: GameState) => void,
) => {
  let ws: WebSocket | null = null;
  let playerId: PlayerId | -1 = -1;
  let playerToken = initialPlayerToken;
  const solarMap = map;
  const shouldInjectChaos = Math.random() < config.disconnectRate;
  let chaosInjected = false;
  let reconnectPending = false;
  const actionKeys = new Set<string>();
  let actionTimer: NodeJS.Timeout | null = null;
  let settledResult = false;

  const finishConnect = (resolve: () => void) => {
    if (settledResult) return;
    settledResult = true;
    resolve();
  };

  const finishConnectReject = (
    reject: (error: Error) => void,
    error: Error,
  ) => {
    if (settledResult) return;
    settledResult = true;
    reject(error);
  };

  const clearActionTimer = () => {
    if (actionTimer) {
      clearTimeout(actionTimer);
      actionTimer = null;
    }
  };

  const send = (message: C2S) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
    metrics.actionsSent++;
  };

  const performAction = (state: GameState) => {
    switch (state.phase) {
      case 'fleetBuilding':
        send({
          type: 'fleetReady',
          purchases: buildFleetPurchases(
            state,
            playerId as PlayerId,
            config.difficulty,
          ),
        });
        return;
      case 'astrogation': {
        const orders = aiAstrogation(
          state,
          playerId as PlayerId,
          solarMap,
          config.difficulty,
        );

        send({
          type: 'astrogation',
          orders:
            orders.length > 0
              ? orders
              : buildIdleAstrogationOrders(state, playerId as PlayerId),
        });
        return;
      }
      case 'ordnance': {
        const launches = aiOrdnance(
          state,
          playerId as PlayerId,
          solarMap,
          config.difficulty,
        );

        if (launches.length > 0) {
          send({ type: 'ordnance', launches });
        } else {
          send({ type: 'skipOrdnance' });
        }
        return;
      }
      case 'combat': {
        if (hasOwnedPendingAsteroidHazards(state, playerId as PlayerId)) {
          send({ type: 'beginCombat' });
          return;
        }

        const attacks = aiCombat(
          state,
          playerId as PlayerId,
          solarMap,
          config.difficulty,
        );

        if (attacks.length > 0) {
          send({ type: 'combat', attacks });
        } else {
          send({ type: 'skipCombat' });
        }
        return;
      }
      case 'logistics':
        send({ type: 'skipLogistics' });
        return;
      case 'gameOver':
        onGameOver(state);
        return;
      default:
        return;
    }
  };

  const scheduleAction = (state: GameState) => {
    if (state.activePlayer !== playerId) return;

    const actionKey = [
      state.gameId,
      state.turnNumber,
      state.phase,
      state.activePlayer,
      playerId,
    ].join(':');

    if (actionKeys.has(actionKey)) {
      return;
    }
    actionKeys.add(actionKey);

    if (
      shouldInjectChaos &&
      !chaosInjected &&
      playerToken &&
      state.phase !== 'gameOver'
    ) {
      chaosInjected = true;
      metrics.reconnectAttempts++;
      reconnectPending = true;
      clearActionTimer();
      ws?.close();
      setTimeout(() => {
        void reconnect();
      }, config.reconnectDelayMs);
      return;
    }

    const thinkSpan = Math.max(config.thinkMaxMs - config.thinkMinMs, 0);
    const thinkDelay =
      config.thinkMinMs + Math.floor(Math.random() * (thinkSpan + 1));

    clearActionTimer();
    actionTimer = setTimeout(() => {
      actionTimer = null;
      performAction(state);
    }, thinkDelay);
  };

  const handleMessage = async (raw: WebSocket.RawData): Promise<void> => {
    let message: S2C;

    try {
      message = JSON.parse(raw.toString()) as S2C;
    } catch (error) {
      metrics.socketErrors++;
      console.error(`[${label}] invalid message payload`, error);
      return;
    }

    switch (message.type) {
      case 'welcome':
        playerId = message.playerId;
        playerToken = message.playerToken;
        return;
      case 'matchFound':
        return;
      case 'gameStart':
      case 'movementResult':
      case 'combatResult':
      case 'stateUpdate':
        metrics.turns = Math.max(metrics.turns, message.state.turnNumber);
        scheduleAction(message.state);

        if (message.state.phase === 'gameOver') {
          onGameOver(message.state);
        }
        return;
      case 'gameOver':
        return;
      case 'error':
        metrics.serverErrors++;
        console.error(`[${label}] server error: ${message.message}`);
        return;
      case 'pong':
      case 'rematchPending':
      case 'chat':
        return;
    }
  };

  const connect = async (): Promise<void> => {
    const tokenQuery = playerToken
      ? `?playerToken=${encodeURIComponent(playerToken)}`
      : '';
    const wsUrl = `${config.serverUrl.replace(/^http/, 'ws')}/ws/${gameCode}${tokenQuery}`;

    await new Promise<void>((resolve, reject) => {
      settledResult = false;

      const socket = new WebSocket(wsUrl);

      ws = socket;

      socket.once('open', () => {
        finishConnect(resolve);
      });

      socket.once('unexpected-response', (_request, response) => {
        const reason = response.statusMessage || `HTTP ${response.statusCode}`;

        finishConnectReject(reject, new Error(reason));
      });

      socket.once('error', (error) => {
        metrics.socketErrors++;
        finishConnectReject(reject, error as Error);
      });

      socket.on('message', (data) => {
        void handleMessage(data);
      });

      socket.on('close', () => {
        clearActionTimer();

        if (reconnectPending) {
          return;
        }
      });
    });
  };

  const reconnect = async (): Promise<void> => {
    try {
      await connect();
      metrics.reconnectSuccesses++;
    } catch (error) {
      metrics.socketErrors++;
      console.error(`[${label}] reconnect failed`, error);
    } finally {
      reconnectPending = false;
    }
  };

  return {
    connect,
    disconnect(): void {
      reconnectPending = false;
      clearActionTimer();
      ws?.close();
    },
  };
};

type BotClient = ReturnType<typeof createBotClient>;

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
      metrics.winner = state.outcome?.winner ?? null;
      metrics.reason = state.outcome?.reason ?? 'gameOver';
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

      host = createBotClient(
        `match-${id}-host`,
        createResponse.code,
        config,
        metrics,
        createResponse.playerToken,
        onGameOver,
      );
      guest = createBotClient(
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

const main = async (): Promise<void> => {
  const config = parseArgs(process.argv.slice(2));
  const aggregate = createAggregateMetrics();

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
        recordMatchResult(aggregate, result);
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
