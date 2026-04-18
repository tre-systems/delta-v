import { applyDisconnectForfeit } from '../../shared/engine/util';
import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import { scheduleArchiveCompletedMatch } from './match-archive';
import type {
  PublishStateChangeOptions,
  StatefulServerMessage,
} from './message-builders';
import {
  readAlarmDeadlines,
  readDisconnectedPlayer,
  resolveAlarmAction,
} from './session';
import { runGameDoTurnTimeout } from './turn-timeout';

export type GameDoAlarmEnv = {
  MATCH_ARCHIVE?: R2Bucket;
  DB: D1Database;
};

export type GameDoAlarmDeps = {
  now: number;
  storage: DurableObjectStorage;
  env: GameDoAlarmEnv;
  waitUntil: (promise: Promise<unknown>) => void;
  getWebSockets: () => WebSocket[];
  map: SolarSystemMap;
  getCurrentGameState: () => Promise<GameState | null>;
  getGameCode: () => Promise<string>;
  getActionRng: () => Promise<() => number>;
  runBotTurn: () => Promise<void>;
  clearDisconnectMarker: () => Promise<void>;
  rescheduleAlarm: () => Promise<void>;
  publishStateChange: (
    state: GameState,
    primaryMessage?: StatefulServerMessage,
    options?: PublishStateChangeOptions,
  ) => Promise<void>;
  reportEngineError: (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ) => void;
  reportGameAbandoned: (props: {
    gameId: string;
    turn: number;
    phase: string;
    reason: string;
    scenario: string;
  }) => void;
  // Lifecycle signal emitted for turn-timeout fires and disconnect-grace
  // expirations. Injected from GameDO so this module stays pure-ish.
  reportLifecycle?: (
    event: 'disconnect_grace_expired' | 'turn_timeout_fired',
    props: Record<string, unknown>,
  ) => void;
  archiveRoomState: () => Promise<void>;
};

export const runGameDoAlarm = async (deps: GameDoAlarmDeps): Promise<void> => {
  try {
    const disconnectedPlayer = await readDisconnectedPlayer(deps.storage);
    const deadlines = await readAlarmDeadlines(deps.storage);
    const action = resolveAlarmAction({
      now: deps.now,
      disconnectedPlayer,
      ...deadlines,
    });
    switch (action.type) {
      case 'disconnectExpired': {
        const code = await deps.getGameCode();
        deps.reportLifecycle?.('disconnect_grace_expired', {
          code,
          player: action.playerId,
        });
        await deps.clearDisconnectMarker();
        const gameState = await deps.getCurrentGameState();

        if (!gameState || gameState.phase === 'gameOver') {
          await deps.rescheduleAlarm();
          return;
        }
        const forfeit = applyDisconnectForfeit(gameState, action.playerId);
        await deps.publishStateChange(forfeit.state, undefined, {
          actor: null,
          restartTurnTimer: false,
          events: forfeit.events,
        });
        return;
      }
      case 'turnTimeout': {
        const gameStateBefore = await deps.getCurrentGameState();
        if (gameStateBefore && gameStateBefore.phase !== 'gameOver') {
          const code = await deps.getGameCode();
          deps.reportLifecycle?.('turn_timeout_fired', {
            code,
            gameId: String(gameStateBefore.gameId),
            turn: gameStateBefore.turnNumber,
            phase: gameStateBefore.phase,
            activePlayer: gameStateBefore.activePlayer,
          });
        }
        await runGameDoTurnTimeout({
          storage: deps.storage,
          map: deps.map,
          getCurrentGameState: deps.getCurrentGameState,
          getActionRng: deps.getActionRng,
          getGameCode: deps.getGameCode,
          reportEngineError: deps.reportEngineError,
          publishStateChange: deps.publishStateChange,
          rescheduleAlarm: deps.rescheduleAlarm,
        });
        return;
      }
      case 'botTurn':
        await deps.runBotTurn();
        return;
      case 'inactivityTimeout': {
        const gameState = await deps.getCurrentGameState();

        if (gameState) {
          if (gameState.phase !== 'gameOver') {
            deps.reportGameAbandoned({
              gameId: String(gameState.gameId),
              turn: gameState.turnNumber,
              phase: gameState.phase,
              reason: 'inactivity',
              scenario: gameState.scenario,
            });
          }
          const code = await deps.getGameCode();
          scheduleArchiveCompletedMatch(
            {
              storage: deps.storage,
              r2: deps.env.MATCH_ARCHIVE,
              db: deps.env.DB,
              waitUntil: deps.waitUntil,
            },
            gameState,
            code,
          );
        }
        for (const ws of deps.getWebSockets()) {
          try {
            ws.close(1000, 'Inactivity timeout');
          } catch {}
        }
        await deps.archiveRoomState();
        return;
      }
      case 'reschedule':
        await deps.rescheduleAlarm();
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  } catch (err) {
    console.error('Alarm handler failed, rescheduling:', err);
    try {
      await deps.rescheduleAlarm();
    } catch (rescheduleErr) {
      console.error('Failed to reschedule alarm after error:', rescheduleErr);
    }
  }
};
