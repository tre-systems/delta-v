export const GAME_DO_STORAGE_KEYS = {
  roomConfig: 'roomConfig',
  gameCode: 'gameCode',
  matchNumber: 'matchNumber',
  roomArchived: 'roomArchived',
  disconnectedPlayer: 'disconnectedPlayer',
  disconnectTime: 'disconnectTime',
  disconnectAt: 'disconnectAt',
  turnTimeoutAt: 'turnTimeoutAt',
  inactivityAt: 'inactivityAt',
  rematchRequests: 'rematchRequests',
} as const;

export type GameDoStorageKey =
  (typeof GAME_DO_STORAGE_KEYS)[keyof typeof GAME_DO_STORAGE_KEYS];
