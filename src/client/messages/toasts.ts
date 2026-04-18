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
    rateLimited: 'Too many requests — wait a moment and try again',
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
    joinNeedCode: 'Enter a game code to join',
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
  reconnect: {
    client: 'Reconnected!',
    opponent: 'Opponent reconnected',
  },
  actionRejected: {
    staleGame: 'The game moved on before that action could apply.',
    duplicateIdempotencyKey:
      'Duplicate action key — use a fresh idempotency key if retrying.',
    wrongActivePlayer: 'It is not your turn to act in this phase.',
  },
  gameplay: {
    orbitalBaseEmplaced: 'Orbital base emplaced!',
    noDetectedEnemies: 'No detected enemies',
    combatTargetBlocked: 'Selected target is blocked or has no legal attackers',
    torpedoAimingIntro:
      'Torpedo aiming: choose an adjacent hex for boost, or queue again for a straight shot',
  },
};

export const toastJoinInvalidCode = (codeLength: number): string =>
  `Invalid code — must be ${codeLength} characters`;

export const toastOrdnanceQueued = (
  shipName: string,
  ordType: string,
  boostHint: string,
): string => `${shipName}: ${ordType} queued${boostHint}`;
