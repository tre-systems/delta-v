export const GAME_DO_STORAGE_KEYS = {
  roomConfig: 'roomConfig',
  gameCode: 'gameCode',
  matchNumber: 'matchNumber',
  roomArchived: 'roomArchived',
  disconnectedPlayer: 'disconnectedPlayer',
  disconnectTime: 'disconnectTime',
  disconnectAt: 'disconnectAt',
  botTurnAt: 'botTurnAt',
  turnTimeoutAt: 'turnTimeoutAt',
  inactivityAt: 'inactivityAt',
  rematchRequests: 'rematchRequests',
  // Mid-game coach directives. One entry per seat (the COACHED seat —
  // i.e. the opposite of the sender). Stored as CoachDirective JSON.
  coachDirectiveSeat0: 'coachDirective:0',
  coachDirectiveSeat1: 'coachDirective:1',
  // Flag set the first time any /coach lands in the match. Used by the
  // future leaderboard to filter coached games from uncoached Elo.
  matchCoached: 'matchCoached',
} as const;

export type GameDoStorageKey =
  (typeof GAME_DO_STORAGE_KEYS)[keyof typeof GAME_DO_STORAGE_KEYS];
