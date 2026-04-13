import type { PlayerId } from '../../shared/types/domain';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';

export const DISCONNECT_GRACE_MS = 30_000;

const TURN_TIMEOUT_GRACE_MS = 500;

export interface AlarmDeadlines {
  disconnectAt?: number;
  botTurnAt?: number;
  turnTimeoutAt?: number;
  inactivityAt?: number;
}

export interface AlarmSnapshot extends AlarmDeadlines {
  now: number;
  disconnectedPlayer: PlayerId | null;
}

export type AlarmAction =
  | { type: 'disconnectExpired'; playerId: PlayerId }
  | { type: 'botTurn' }
  | { type: 'turnTimeout' }
  | { type: 'inactivityTimeout' }
  | { type: 'reschedule' };

export interface DisconnectMarker {
  disconnectedPlayer: PlayerId;
  disconnectTime: number;
  disconnectAt: number;
}

export const normalizeDisconnectedPlayer = (value: unknown): PlayerId | null =>
  value === 0 || value === 1 ? value : null;

export const readAlarmDeadlines = async (
  storage: DurableObjectStorage,
): Promise<AlarmDeadlines> => {
  const [disconnectAt, botTurnAt, turnTimeoutAt, inactivityAt] =
    await Promise.all([
      storage.get<number>(GAME_DO_STORAGE_KEYS.disconnectAt),
      storage.get<number>(GAME_DO_STORAGE_KEYS.botTurnAt),
      storage.get<number>(GAME_DO_STORAGE_KEYS.turnTimeoutAt),
      storage.get<number>(GAME_DO_STORAGE_KEYS.inactivityAt),
    ]);

  return {
    disconnectAt,
    botTurnAt,
    turnTimeoutAt,
    inactivityAt,
  };
};

export const readDisconnectedPlayer = async (
  storage: DurableObjectStorage,
): Promise<PlayerId | null> =>
  normalizeDisconnectedPlayer(
    await storage.get<number>(GAME_DO_STORAGE_KEYS.disconnectedPlayer),
  );

export const createDisconnectMarker = (
  playerId: PlayerId,
  now: number,
): DisconnectMarker => ({
  disconnectedPlayer: playerId,
  disconnectTime: now,
  disconnectAt: now + DISCONNECT_GRACE_MS,
});

export const shouldClearDisconnectMarker = (
  disconnectedPlayer: PlayerId | null,
  playerId: PlayerId,
): boolean => disconnectedPlayer === playerId;

export const getNextAlarmAt = (deadlines: AlarmDeadlines): number | null => {
  const values = Object.values(deadlines).filter(
    (value): value is number => value !== undefined,
  );

  return values.length > 0 ? Math.min(...values) : null;
};

export const resolveAlarmAction = ({
  disconnectedPlayer,
  disconnectAt,
  botTurnAt,
  turnTimeoutAt,
  inactivityAt,
  now,
}: AlarmSnapshot): AlarmAction => {
  if (
    disconnectedPlayer !== null &&
    disconnectAt !== undefined &&
    now >= disconnectAt
  ) {
    return {
      type: 'disconnectExpired',
      playerId: disconnectedPlayer,
    };
  }

  if (botTurnAt !== undefined && now >= botTurnAt) {
    return { type: 'botTurn' };
  }

  if (
    turnTimeoutAt !== undefined &&
    now >= turnTimeoutAt - TURN_TIMEOUT_GRACE_MS
  ) {
    return { type: 'turnTimeout' };
  }

  if (inactivityAt !== undefined && now >= inactivityAt) {
    return { type: 'inactivityTimeout' };
  }

  return { type: 'reschedule' };
};
