import type { EngineEvent } from '../../shared/engine/engine-events';
import { applyDisconnectForfeit } from '../../shared/engine/util';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { archiveCompletedMatch } from './match-archive';
import type { StatefulServerMessage } from './messages';
import { normalizeDisconnectedPlayer, resolveAlarmAction } from './session';
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
  clearDisconnectMarker: () => Promise<void>;
  rescheduleAlarm: () => Promise<void>;
  publishStateChange: (
    state: GameState,
    primaryMessage?: StatefulServerMessage,
    options?: {
      actor?: PlayerId | null;
      restartTurnTimer?: boolean;
      events?: EngineEvent[];
    },
  ) => Promise<void>;
  reportEngineError: (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ) => void;
  archiveRoomState: () => Promise<void>;
};

export const runGameDoAlarm = async (deps: GameDoAlarmDeps): Promise<void> => {
  const disconnectedPlayer = normalizeDisconnectedPlayer(
    await deps.storage.get<number>('disconnectedPlayer'),
  );
  const action = resolveAlarmAction({
    now: deps.now,
    disconnectedPlayer,
    disconnectAt: await deps.storage.get<number>('disconnectAt'),
    turnTimeoutAt: await deps.storage.get<number>('turnTimeoutAt'),
    inactivityAt: await deps.storage.get<number>('inactivityAt'),
  });
  switch (action.type) {
    case 'disconnectExpired': {
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
    case 'turnTimeout':
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
    case 'inactivityTimeout': {
      if (deps.env.MATCH_ARCHIVE) {
        const gameState = await deps.getCurrentGameState();

        if (gameState) {
          const code = await deps.getGameCode();
          deps.waitUntil(
            archiveCompletedMatch(
              deps.storage,
              deps.env.MATCH_ARCHIVE,
              deps.env.DB,
              gameState,
              code,
            ),
          );
        }
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
  }
};
