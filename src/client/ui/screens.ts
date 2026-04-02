import { SCENARIOS } from '../../shared/map-data';
import type { InteractionMode } from '../game/interaction-fsm';

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
  scenario?: string;
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
  playerId?: number;
  shipFates?: Array<{
    name: string;
    status: string;
    owner: number;
    deathCause?: string;
    killedBy?: string;
  }>;
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

    case 'hidden':
      return HIDDEN_VISIBILITY;

    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
};

export const mapInteractionModeToUIScreenMode = (
  interaction: InteractionMode,
  legacyMode: UIScreenMode,
): UIScreenMode => {
  switch (interaction) {
    case 'menu':
      return legacyMode === 'scenario' ? 'scenario' : 'menu';
    case 'waiting':
      return 'waiting';
    case 'fleetBuilding':
      return 'fleetBuilding';
    case 'astrogation':
    case 'ordnance':
    case 'logistics':
    case 'combat':
    case 'animating':
    case 'opponentTurn':
    case 'gameOver':
      return 'hud';
    default: {
      const _exhaustive: never = interaction;
      return _exhaustive;
    }
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

const DEATH_CAUSE_LABELS: Record<string, string> = {
  gun: 'Guns',
  baseDefense: 'Base defense',
  crash: 'Crashed',
  mine: 'Mine',
  torpedo: 'Torpedo',
  nuke: 'Nuke',
  ramming: 'Rammed',
  asteroid: 'Asteroid',
  mapExit: 'Off map',
};

const formatFateValue = (fate: {
  status: string;
  deathCause?: string;
  killedBy?: string;
}): string => {
  const label = fate.status.toUpperCase();

  if (fate.status !== 'destroyed' || !fate.deathCause) return label;
  const cause = DEATH_CAUSE_LABELS[fate.deathCause] ?? fate.deathCause;
  const killer = fate.killedBy ? ` by ${fate.killedBy}` : '';
  return `${label}${killer} (${cause})`;
};

const buildStatLines = (stats: GameOverStatsLike): GameOverStatLine[] => {
  const scenarioDef = stats.scenario
    ? (SCENARIOS[stats.scenario] ??
      Object.values(SCENARIOS).find((s) => s.name === stats.scenario) ??
      null)
    : null;
  const lines: GameOverStatLine[] = [];

  if (scenarioDef) {
    lines.push({ label: scenarioDef.name, value: '' });
  }

  lines.push(
    { label: 'Turns', value: String(stats.turns) },
    {
      label: 'Your fleet',
      value: `${stats.myShipsAlive}/${stats.myShipsTotal} survived`,
    },
    {
      label: 'Enemy fleet',
      value: `${stats.enemyShipsAlive}/${stats.enemyShipsTotal} survived`,
    },
  );

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

  if (stats.shipFates && stats.shipFates.length > 0) {
    const pid = stats.playerId ?? 0;
    const myFates = stats.shipFates.filter((f) => f.owner === pid);
    const enemyFates = stats.shipFates.filter((f) => f.owner !== pid);

    lines.push({ label: '', value: '' }); // Spacer
    lines.push({ label: 'YOUR SHIPS', value: '' });

    for (const fate of myFates) {
      lines.push({
        label: fate.name,
        value: formatFateValue(fate),
      });
    }

    if (enemyFates.length > 0) {
      lines.push({ label: 'ENEMY SHIPS', value: '' });

      for (const fate of enemyFates) {
        lines.push({
          label: fate.name,
          value: formatFateValue(fate),
        });
      }
    }
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
