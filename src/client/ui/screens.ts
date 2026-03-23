export type UIScreenMode =
  | 'hidden'
  | 'menu'
  | 'scenario'
  | 'waiting'
  | 'hud'
  | 'fleetBuilding';

export interface UIScreenVisibility {
  menu: 'none' | 'flex';
  scenario: 'none' | 'flex';
  waiting: 'none' | 'flex';
  hud: 'none' | 'block';
  gameOver: 'none' | 'flex';
  shipList: 'none' | 'flex';
  gameLog: 'none' | 'flex';
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
  myShipsDestroyed: number;
  enemyShipsDestroyed: number;
  myFuelSpent: number;
  enemyFuelSpent: number;
  basesDestroyed: number;
  ordnanceInFlight: number;
}

export interface GameOverStatLine {
  label: string;
  value: string;
}

export interface GameOverView {
  titleText: 'VICTORY' | 'DEFEAT';
  reasonText: string;
  statLines: GameOverStatLine[];
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
  fleetBuilding: 'none',
  helpBtn: 'none',
  soundBtn: 'none',
  helpOverlay: 'none',
};

export const buildScreenVisibility = (
  mode: UIScreenMode,
): UIScreenVisibility => {
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

export const buildWaitingScreenCopy = (
  code: string,
  connecting: boolean,
): WaitingScreenCopy => {
  return connecting
    ? { codeText: '...', statusText: 'Connecting...' }
    : {
        codeText: code,
        statusText: 'Waiting for opponent...',
      };
};

const buildStatLines = (stats: GameOverStatsLike): GameOverStatLine[] => {
  const lines: GameOverStatLine[] = [
    { label: 'Turns', value: String(stats.turns) },
    {
      label: 'Your fleet',
      value: `${stats.myShipsAlive}/${stats.myShipsTotal} survived`,
    },
    {
      label: 'Enemy fleet',
      value: `${stats.enemyShipsAlive}/${stats.enemyShipsTotal} survived`,
    },
  ];

  if (stats.enemyShipsDestroyed > 0) {
    lines.push({
      label: 'Kills',
      value: String(stats.enemyShipsDestroyed),
    });
  }

  if (stats.myFuelSpent > 0) {
    lines.push({
      label: 'Fuel spent',
      value: String(stats.myFuelSpent),
    });
  }

  if (stats.basesDestroyed > 0) {
    lines.push({
      label: 'Bases destroyed',
      value: String(stats.basesDestroyed),
    });
  }

  return lines;
};

export const buildGameOverView = (
  won: boolean,
  reason: string,
  stats?: GameOverStatsLike,
): GameOverView => ({
  titleText: won ? 'VICTORY' : 'DEFEAT',
  reasonText: reason,
  statLines: stats ? buildStatLines(stats) : [],
  rematchText: 'Rematch',
  rematchDisabled: false,
});

export const buildRematchPendingView = (): RematchPendingView => {
  return {
    rematchText: 'Waiting...',
    rematchDisabled: true,
  };
};

export const buildReconnectView = (
  attempt: number,
  maxAttempts: number,
): ReconnectView => {
  return {
    reconnectText: 'Connection lost',
    attemptText: `Attempt ${attempt} of ${maxAttempts}`,
  };
};
