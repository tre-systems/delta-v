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

export function normalizeDisconnectedPlayer(value: unknown): number | null {
  return value === 0 || value === 1 ? value : null;
}

export function createDisconnectMarker(playerId: number, now: number): DisconnectMarker {
  return {
    disconnectedPlayer: playerId,
    disconnectTime: now,
    disconnectAt: now + DISCONNECT_GRACE_MS,
  };
}

export function shouldClearDisconnectMarker(disconnectedPlayer: number | null, playerId: number): boolean {
  return disconnectedPlayer === playerId;
}

export function getNextAlarmAt(deadlines: AlarmDeadlines): number | null {
  const values = Object.values(deadlines).filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.min(...values) : null;
}

export function resolveAlarmAction(snapshot: AlarmSnapshot): AlarmAction {
  if (
    snapshot.disconnectedPlayer !== null &&
    snapshot.disconnectAt !== undefined &&
    snapshot.now >= snapshot.disconnectAt
  ) {
    return { type: 'disconnectExpired', playerId: snapshot.disconnectedPlayer };
  }
  if (snapshot.turnTimeoutAt !== undefined && snapshot.now >= snapshot.turnTimeoutAt - TURN_TIMEOUT_GRACE_MS) {
    return { type: 'turnTimeout' };
  }
  if (snapshot.inactivityAt !== undefined && snapshot.now >= snapshot.inactivityAt) {
    return { type: 'inactivityTimeout' };
  }
  return { type: 'reschedule' };
}
