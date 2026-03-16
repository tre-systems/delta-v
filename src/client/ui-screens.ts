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

export function buildScreenVisibility(mode: UIScreenMode, logVisible: boolean): UIScreenVisibility {
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
    case 'hidden':
    default:
      return HIDDEN_VISIBILITY;
  }
}

export function buildWaitingScreenCopy(code: string, connecting: boolean): WaitingScreenCopy {
  return connecting
    ? { codeText: '...', statusText: 'Connecting...' }
    : { codeText: code, statusText: 'Waiting for opponent...' };
}

export function toggleLogVisible(logVisible: boolean): boolean {
  return !logVisible;
}
