export const DISCONNECT_GRACE_MS = 30_000;
const TURN_TIMEOUT_GRACE_MS = 500;

export interface AlarmDeadlines {
  disconnectAt?: number;
  turnTimeoutAt?: number;
  inactivityAt?: number;
}

export interface AlarmSnapshot extends AlarmDeadlines {
  now: number;
  disconnectedPlayer: number | null;
}

export type AlarmAction =
  | { type: 'disconnectExpired'; playerId: number }
  | { type: 'turnTimeout' }
  | { type: 'inactivityTimeout' }
  | { type: 'reschedule' };

export interface DisconnectMarker {
  disconnectedPlayer: number;
  disconnectTime: number;
  disconnectAt: number;
}

export const normalizeDisconnectedPlayer = (value: unknown): number | null =>
  value === 0 || value === 1 ? value : null;

export const createDisconnectMarker = (playerId: number, now: number): DisconnectMarker => ({
  disconnectedPlayer: playerId,
  disconnectTime: now,
  disconnectAt: now + DISCONNECT_GRACE_MS,
});

export const shouldClearDisconnectMarker = (disconnectedPlayer: number | null, playerId: number): boolean =>
  disconnectedPlayer === playerId;

export const getNextAlarmAt = (deadlines: AlarmDeadlines): number | null => {
  const values = Object.values(deadlines).filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.min(...values) : null;
};

export const resolveAlarmAction = ({
  disconnectedPlayer,
  disconnectAt,
  turnTimeoutAt,
  inactivityAt,
  now,
}: AlarmSnapshot): AlarmAction => {
  if (disconnectedPlayer !== null && disconnectAt !== undefined && now >= disconnectAt) {
    return { type: 'disconnectExpired', playerId: disconnectedPlayer };
  }
  if (turnTimeoutAt !== undefined && now >= turnTimeoutAt - TURN_TIMEOUT_GRACE_MS) {
    return { type: 'turnTimeout' };
  }
  if (inactivityAt !== undefined && now >= inactivityAt) {
    return { type: 'inactivityTimeout' };
  }
  return { type: 'reschedule' };
};
