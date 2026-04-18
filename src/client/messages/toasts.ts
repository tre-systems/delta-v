/**
 * Central copy for short `showToast` messages.
 * Use an em dash (—) between clauses where we use a break, not a hyphen.
 */
export const TOAST = {
  connection: {
    couldNotReconnect: 'Could not reconnect to game',
    couldNotConnect: 'Could not connect to game',
    couldNotReachServer: 'Could not reach game server',
    connectionRejected: 'Connection rejected by server',
    serverErrorRetryShortly: 'Server error — try again shortly',
  },
  session: {
    quickMatchExpired: 'Quick Match expired. Try again.',
    quickMatchLostConnection: 'Quick Match lost connection. Try again.',
    quickMatchUnavailable: 'Quick Match is unavailable right now.',
    quickMatchEnterFailed: 'Failed to enter Quick Match. Try again.',
    quickMatchOtherTab:
      'Quick Match is already active in another tab. Use a private window to join as a second local player.',
    gameCreateTimeout: 'Game creation timed out. Try again.',
    gameCreateNetwork: 'Network error — check your connection.',
    gameCreateFailed: 'Failed to create game. Try again.',
  },
  clientRuntime: {
    offline: "You're offline — check your connection",
    backOnline: 'Back online',
  },
  timer: {
    thirtySecondsRemaining: '30 seconds remaining!',
  },
  lobby: {
    claimCouldNotSaveOnline:
      'Could not save callsign online — you can still play.',
  },
  sessionController: {
    joinRoomFullSpectator:
      'This room is full — you are joining as a spectator.',
    replayUnavailable: 'Replay unavailable for this match.',
    replayNoEntries: 'Replay has no entries.',
    replayLocalOnly:
      'Replay is only available for multiplayer matches right now.',
  },
  spectator: {
    urlWatchOnly:
      'Watching as a spectator — you can see both sides but cannot command ships.',
  },
} as const;
