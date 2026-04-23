import { isValidScenario, SCENARIOS } from '../../shared/map-data';
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
  /** In-game "exit to menu" floating button; hud mode only. */
  exitGameBtn: 'none' | 'flex';
  helpOverlay: 'none' | 'flex';
}

export interface WaitingScreenCopy {
  titleText: string;
  codeText: string;
  codeVariant: 'roomCode' | 'statusWord';
  statusText: string;
  scenarioText: string | null;
  showCopyActions: boolean;
  // Quick-match search can take a while; the waiting screen shows a
  // cancel control so users aren't trapped in the queue state.
  // `null` hides the control; a string shows it with that label.
  cancelActionLabel: string | null;
  /** Wall-clock ms when quick-match search began; drives elapsed UI. */
  quickMatchQueuedAtMs: number | null;
  /**
   * Official-bot quick-match fallback prompt. `null` hides the prompt
   * entirely. `officialBotButtonLabel` is non-null only once the offer
   * is live — before that, the text is a countdown ("Official Bot
   * offer available in 12s").
   */
  officialBotPromptText: string | null;
  officialBotButtonLabel: string | null;
}

export type WaitingScreenState =
  | {
      kind: 'private';
      code: string;
      connecting: boolean;
    }
  | {
      kind: 'quickMatch';
      statusText: string;
      /** Present while polling for a match (not during "connecting" handoff). */
      queuedAtMs?: number;
      /**
       * Most recent server signals about the Official Bot fallback. Both
       * default to null when the server hasn't reported them yet (e.g.
       * during "Connecting..." handoff after a match is found).
       */
      officialBotOfferAvailable?: boolean;
      officialBotWaitMsRemaining?: number | null;
    };

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

export interface GameOverSummaryItem {
  label: string;
  value: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning';
}

export interface GameOverShipItem {
  name: string;
  outcomeText: string;
  detailText: string | null;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface GameOverShipGroup {
  title: string;
  items: GameOverShipItem[];
}

export interface GameOverView {
  titleText: 'VICTORY' | 'DEFEAT' | 'GAME OVER';
  kickerText: string | null;
  reasonText: string;
  summaryItems: GameOverSummaryItem[];
  shipGroups: GameOverShipGroup[];
  rematchText: 'Rematch';
  rematchDisabled: false;
}

const isSpectatorStats = (stats: GameOverStatsLike): boolean =>
  (stats.playerId ?? 0) < 0;

export interface ReconnectView {
  reconnectText: 'Connection lost';
  attemptText: string;
}

export interface RematchPendingView {
  rematchText: 'Waiting...';
  rematchDisabled: true;
}

type GameOverShipFate = NonNullable<GameOverStatsLike['shipFates']>[number];

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
  exitGameBtn: 'none',
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
        exitGameBtn: 'flex',
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
  scenarioActive: boolean,
): UIScreenMode => {
  switch (interaction) {
    case 'menu':
      return scenarioActive ? 'scenario' : 'menu';
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

const buildOfficialBotPrompt = (
  state: Extract<WaitingScreenState, { kind: 'quickMatch' }>,
): Pick<
  WaitingScreenCopy,
  'officialBotPromptText' | 'officialBotButtonLabel'
> => {
  const remaining = state.officialBotWaitMsRemaining;
  // Hide the prompt entirely until the server tells us the feature is
  // live for this queue (either "available now" or a real countdown).
  // Treating null/undefined as "hidden" means we stay silent if the
  // Worker has the official-bot feature disabled.
  if (state.officialBotOfferAvailable) {
    return {
      officialBotPromptText: "Still searching? Don't want to wait?",
      officialBotButtonLabel: 'Play Official Bot now',
    };
  }
  if (typeof remaining === 'number' && remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    return {
      officialBotPromptText: `Official Bot offer available in ${seconds}s`,
      officialBotButtonLabel: null,
    };
  }
  return { officialBotPromptText: null, officialBotButtonLabel: null };
};

export const buildWaitingScreenCopy = (
  state: WaitingScreenState,
): WaitingScreenCopy => {
  if (state.kind === 'quickMatch') {
    return {
      titleText: 'Quick Match',
      codeText: 'SEARCHING',
      codeVariant: 'statusWord',
      statusText: state.statusText,
      scenarioText: null,
      showCopyActions: false,
      cancelActionLabel: 'Cancel search',
      quickMatchQueuedAtMs: state.queuedAtMs ?? null,
      ...buildOfficialBotPrompt(state),
    };
  }

  return state.connecting
    ? {
        titleText: 'Connecting',
        codeText: state.code || '...',
        codeVariant: 'roomCode',
        statusText: 'Establishing connection...',
        scenarioText: null,
        showCopyActions: true,
        cancelActionLabel: 'Cancel',
        quickMatchQueuedAtMs: null,
        officialBotPromptText: null,
        officialBotButtonLabel: null,
      }
    : {
        titleText: 'Game Created',
        codeText: state.code,
        codeVariant: 'roomCode',
        statusText: 'Waiting for opponent...',
        scenarioText: null,
        showCopyActions: true,
        cancelActionLabel: 'Cancel',
        quickMatchQueuedAtMs: null,
        officialBotPromptText: null,
        officialBotButtonLabel: null,
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

const formatStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    survived: 'Survived',
    destroyed: 'Destroyed',
    landed: 'Landed',
    captured: 'Captured',
  };

  if (labels[status]) {
    return labels[status];
  }

  return status
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
};

const getFateTone = (
  fate: Pick<GameOverShipFate, 'status'>,
): GameOverShipItem['tone'] => {
  switch (fate.status) {
    case 'survived':
    case 'landed':
      return 'success';
    case 'captured':
      return 'warning';
    case 'destroyed':
      return 'danger';
    default:
      return 'neutral';
  }
};

const formatFateDetail = (fate: {
  status: string;
  deathCause?: string;
  killedBy?: string;
}): string | null => {
  if (fate.status !== 'destroyed') {
    return null;
  }

  const parts: string[] = [];
  if (fate.deathCause) {
    parts.push(DEATH_CAUSE_LABELS[fate.deathCause] ?? fate.deathCause);
  }

  if (fate.killedBy) {
    parts.push(fate.killedBy);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
};

const buildSummaryItems = (stats: GameOverStatsLike): GameOverSummaryItem[] => {
  const spectator = isSpectatorStats(stats);
  const items: GameOverSummaryItem[] = [
    {
      label: 'Turns',
      value: String(stats.turns),
      tone: 'accent',
    },
    {
      label: spectator ? 'Fleet 1' : 'Your fleet',
      value: `${stats.myShipsAlive}/${stats.myShipsTotal} survived`,
      tone: spectator ? 'accent' : 'success',
    },
    {
      label: spectator ? 'Fleet 2' : 'Enemy fleet',
      value: `${stats.enemyShipsAlive}/${stats.enemyShipsTotal} survived`,
      tone: 'warning',
    },
  ];

  if (!spectator && stats.enemyShipsDestroyed > 0) {
    items.push({
      label: 'Kills',
      value: String(stats.enemyShipsDestroyed),
      tone: 'accent',
    });
  }

  if (spectator) {
    if (stats.myFuelSpent > 0) {
      items.push({
        label: 'Fleet 1 fuel',
        value: String(stats.myFuelSpent),
        tone: 'neutral',
      });
    }

    if (stats.enemyFuelSpent > 0) {
      items.push({
        label: 'Fleet 2 fuel',
        value: String(stats.enemyFuelSpent),
        tone: 'neutral',
      });
    }
  } else if (stats.myFuelSpent > 0) {
    items.push({
      label: 'Fuel spent',
      value: String(stats.myFuelSpent),
      tone: 'neutral',
    });
  }

  if (stats.basesDestroyed > 0) {
    items.push({
      label: 'Bases destroyed',
      value: String(stats.basesDestroyed),
      tone: 'warning',
    });
  }

  return items;
};

const buildShipGroups = (stats: GameOverStatsLike): GameOverShipGroup[] => {
  if (!stats.shipFates || stats.shipFates.length === 0) {
    return [];
  }

  const spectator = isSpectatorStats(stats);

  const buildItems = (fates: GameOverShipFate[]): GameOverShipItem[] =>
    fates.map((fate) => ({
      name: fate.name,
      outcomeText: formatStatusLabel(fate.status),
      detailText: formatFateDetail(fate),
      tone: getFateTone(fate),
    }));

  if (spectator) {
    const owners = Array.from(
      new Set(stats.shipFates.map((fate) => fate.owner)),
    ).sort((a, b) => a - b);

    return owners.map((owner) => ({
      title: `Fleet ${owner + 1}`,
      items: buildItems(
        stats.shipFates?.filter((fate) => fate.owner === owner) ?? [],
      ),
    }));
  }

  const pid = stats.playerId ?? 0;
  const myFates = stats.shipFates.filter((fate) => fate.owner === pid);
  const enemyFates = stats.shipFates.filter((fate) => fate.owner !== pid);
  const groups: GameOverShipGroup[] = [
    {
      title: 'Your ships',
      items: buildItems(myFates),
    },
  ];

  if (enemyFates.length > 0) {
    groups.push({
      title: 'Enemy ships',
      items: buildItems(enemyFates),
    });
  }

  return groups;
};

const getScenarioName = (stats: GameOverStatsLike): string | null => {
  const scenarioDef = stats.scenario
    ? isValidScenario(stats.scenario)
      ? SCENARIOS[stats.scenario]
      : (Object.values(SCENARIOS).find((s) => s.name === stats.scenario) ??
        null)
    : null;
  return scenarioDef?.name ?? stats.scenario ?? null;
};

export const buildGameOverView = (
  won: boolean,
  reason: string,
  stats?: GameOverStatsLike,
): GameOverView => ({
  titleText:
    stats && isSpectatorStats(stats) ? 'GAME OVER' : won ? 'VICTORY' : 'DEFEAT',
  kickerText: stats ? getScenarioName(stats) : null,
  reasonText: reason,
  summaryItems: stats ? buildSummaryItems(stats) : [],
  shipGroups: stats ? buildShipGroups(stats) : [],
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
