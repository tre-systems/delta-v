export type UIScreenMode = 'hidden' | 'menu' | 'scenario' | 'waiting' | 'hud' | 'fleetBuilding';

export interface UIScreenVisibility {
  menu: 'none' | 'flex';
  scenario: 'none' | 'flex';
  waiting: 'none' | 'flex';
  hud: 'none' | 'block';
  gameOver: 'none' | 'flex';
  shipList: 'none' | 'flex';
  gameLog: 'none' | 'flex';
  logShowBtn: 'none' | 'block';
  fleetBuilding: 'none' | 'flex';
  helpBtn: 'none' | 'flex';
  soundBtn: 'none' | 'flex';
  helpOverlay: 'none' | 'flex';
}

export interface WaitingScreenCopy {
  codeText: string;
  statusText: string;
}

export interface GameOverStatsLike {
  turns: number;
  myShipsAlive: number;
  myShipsTotal: number;
  enemyShipsAlive: number;
  enemyShipsTotal: number;
}

export interface GameOverView {
  titleText: 'VICTORY' | 'DEFEAT';
  reasonText: string;
  rematchText: 'Rematch';
  rematchDisabled: false;
}

export interface ReconnectView {
  reconnectText: 'Connection lost';
  attemptText: string;
}

export interface RematchPendingView {
  rematchText: 'Waiting...';
  rematchDisabled: true;
}

const HIDDEN_VISIBILITY: UIScreenVisibility = {
  menu: 'none',
  scenario: 'none',
  waiting: 'none',
  hud: 'none',
  gameOver: 'none',
  shipList: 'none',
  gameLog: 'none',
  logShowBtn: 'none',
  fleetBuilding: 'none',
  helpBtn: 'none',
  soundBtn: 'none',
  helpOverlay: 'none',
};

export const buildScreenVisibility = (mode: UIScreenMode, logVisible: boolean): UIScreenVisibility => {
  switch (mode) {
    case 'menu':
      return {
        ...HIDDEN_VISIBILITY,
        menu: 'flex',
        soundBtn: 'flex',
      };
    case 'scenario':
      return {
        ...HIDDEN_VISIBILITY,
        scenario: 'flex',
        soundBtn: 'flex',
      };
    case 'waiting':
      return {
        ...HIDDEN_VISIBILITY,
        waiting: 'flex',
        soundBtn: 'flex',
      };
    case 'hud':
      return {
        ...HIDDEN_VISIBILITY,
        hud: 'block',
        shipList: 'flex',
        gameLog: logVisible ? 'flex' : 'none',
        logShowBtn: logVisible ? 'none' : 'block',
        helpBtn: 'flex',
        soundBtn: 'flex',
      };
    case 'fleetBuilding':
      return {
        ...HIDDEN_VISIBILITY,
        fleetBuilding: 'flex',
        soundBtn: 'flex',
      };
    default:
      return HIDDEN_VISIBILITY;
  }
};

export const buildWaitingScreenCopy = (code: string, connecting: boolean): WaitingScreenCopy => {
  return connecting
    ? { codeText: '...', statusText: 'Connecting...' }
    : { codeText: code, statusText: 'Waiting for opponent...' };
};

export const buildGameOverView = (won: boolean, reason: string, stats?: GameOverStatsLike): GameOverView => {
  const reasonText = stats
    ? `${reason}\n\nTurns: ${stats.turns} | Your ships: ${stats.myShipsAlive}/${stats.myShipsTotal} | Enemy: ${stats.enemyShipsAlive}/${stats.enemyShipsTotal}`
    : reason;
  return {
    titleText: won ? 'VICTORY' : 'DEFEAT',
    reasonText,
    rematchText: 'Rematch',
    rematchDisabled: false,
  };
};

export const buildRematchPendingView = (): RematchPendingView => {
  return {
    rematchText: 'Waiting...',
    rematchDisabled: true,
  };
};

export const buildReconnectView = (attempt: number, maxAttempts: number): ReconnectView => {
  return {
    reconnectText: 'Connection lost',
    attemptText: `Attempt ${attempt} of ${maxAttempts}`,
  };
};

export const toggleLogVisible = (logVisible: boolean): boolean => {
  return !logVisible;
};
