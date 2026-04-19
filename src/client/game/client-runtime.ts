import { CODE_LENGTH } from '../../shared/constants';
import { getOrderableShipsForPlayer } from '../../shared/engine/util';
import { normalizePlayerToken, normalizeRoomCode } from '../../shared/ids';
import type { SolarSystemMap } from '../../shared/types/domain';
import { initAudio, isMuted, setMuted } from '../audio';
import { byId, hide } from '../dom';
import { isClientFeatureEnabled } from '../feature-flags';
import {
  bindGameClientBrowserEvents,
  bindServiceWorkerControllerReload,
} from '../game-client-browser';
import type { InputHandler } from '../input';
import { TOAST } from '../messages/toasts';
import type { Renderer } from '../renderer/renderer';
import type { UIEvent } from '../ui/events';
import type { UIManager } from '../ui/ui';
import type { KeyboardAction } from './keyboard';
import { deriveKeyboardAction } from './keyboard';
import { getOrdnanceActionableShipIds } from './ordnance';
import type { ClientState } from './phase';
import type { KeyboardPlanningSnapshot } from './planning';
import { buildGameRoute } from './session-links';
import type { ClientSession } from './session-model';

type BrowserToastType = 'error' | 'info' | 'success';

// Deps for wiring browser-level events (keyboard, sound, tooltip, online/offline)
type BrowserBindingDeps = {
  canvas: HTMLCanvasElement;
  helpCloseBtn: HTMLElement;
  helpBtn: HTMLElement;
  soundBtn: HTMLElement;
  tooltipEl: HTMLElement;
  getState: () => ClientState;
  getMap: () => SolarSystemMap;
  hasGameState: () => boolean;
  getGameState: () => import('../../shared/types/domain').GameState | null;
  getPlanningState: () => KeyboardPlanningSnapshot;
  updateTooltip: (x: number, y: number) => void;
  onKeyboardAction: (action: KeyboardAction) => void;
  onToggleHelp: () => void;
  onUpdateSoundButton: () => void;
  showToast: (message: string, type: BrowserToastType) => void;
};

const bindMainBrowserEvents = (deps: BrowserBindingDeps): (() => void) =>
  bindGameClientBrowserEvents({
    canvas: deps.canvas,
    helpCloseBtn: deps.helpCloseBtn,
    helpBtn: deps.helpBtn,
    soundBtn: deps.soundBtn,
    getKeyboardAction: (event) =>
      deriveKeyboardAction(
        {
          state: deps.getState(),
          hasGameState: deps.hasGameState(),
          typingInInput: event.target instanceof HTMLInputElement,
          combatTargetId: deps.getPlanningState().combatTargetId,
          queuedAttackCount: deps.getPlanningState().queuedAttacks.length,
          torpedoAccelActive: deps.getPlanningState().torpedoAccel !== null,
          torpedoAimingActive: deps.getPlanningState().torpedoAimingActive,
          allShipsAcknowledged: (() => {
            const gs = deps.getGameState?.();
            if (!gs) return false;
            const planning = deps.getPlanningState();
            return getOrderableShipsForPlayer(gs, gs.activePlayer).every(
              (s) =>
                s.damage.disabledTurns > 0 ||
                planning.acknowledgedShips.has(s.id),
            );
          })(),
          allOrdnanceShipsAcknowledged: (() => {
            const gs = deps.getGameState?.();
            if (!gs) return true;
            const planning = deps.getPlanningState();
            return getOrdnanceActionableShipIds(
              gs,
              gs.activePlayer,
              deps.getMap(),
            ).every((shipId) => planning.acknowledgedOrdnanceShips.has(shipId));
          })(),
          hasSelectedShip: deps.getPlanningState().selectedShipId !== null,
        },
        { key: event.key, shiftKey: event.shiftKey },
      ),
    onKeyboardAction: (action) => deps.onKeyboardAction(action),
    onToggleHelp: () => deps.onToggleHelp(),
    onToggleSound: () => {
      setMuted(!isMuted());
      deps.onUpdateSoundButton();
    },
    onTooltipMove: (clientX, clientY) => deps.updateTooltip(clientX, clientY),
    onTooltipLeave: () => hide(deps.tooltipEl),
    onOffline: () => deps.showToast(TOAST.clientRuntime.offline, 'error'),
    onOnline: () => deps.showToast(TOAST.clientRuntime.backOnline, 'success'),
  });

// Light sanity check on archived-replay URL params. The server's /replay
// route already gatekeeps — this just avoids firing a session for values
// that clearly can't be a valid gameId (matches `ROOMCODE-mN` format).
const normalizeGameId = (raw: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^[A-Z0-9]{5}-m\d+$/.test(trimmed)) return null;
  return trimmed;
};

export const autoJoinFromUrl = (
  joinGame: (code: string, playerToken: string | null) => void,
  spectateGame: (code: string) => void,
  viewArchivedReplay: (code: string, gameId: string) => void,
  resumeLocalGame: () => boolean,
  setMenuState: () => void,
): void => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = normalizeRoomCode(urlParams.get('code'));
  const playerToken = normalizePlayerToken(urlParams.get('playerToken'));
  const viewer = urlParams.get('viewer');
  const archivedReplay = normalizeGameId(urlParams.get('archivedReplay'));

  if (code && code.length === CODE_LENGTH) {
    history.replaceState(null, '', buildGameRoute(code));
    if (archivedReplay) {
      // Archived-replay viewer path: no WebSocket, no playerToken. The
      // session controller fetches the timeline via the existing spectator
      // route (viewer=spectator) and hands it to the replay controller.
      viewArchivedReplay(code, archivedReplay);
      return;
    }
    if (viewer === 'spectator') {
      if (!isClientFeatureEnabled('spectatorMode')) {
        setMenuState();
        return;
      }
      spectateGame(code);
    } else {
      joinGame(code, playerToken);
    }
    return;
  }
  if (resumeLocalGame()) {
    return;
  }
  history.replaceState(null, '', '/');
  setMenuState();
};

export const setupServiceWorkerReload = () => {
  if (
    'serviceWorker' in navigator &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  ) {
    bindServiceWorkerControllerReload(navigator.serviceWorker, window.location);
  }
};

// Subset of MainInteractionController that setupClientRuntime needs.
// Avoids importing the full controller type to keep the dependency light.
type RuntimeInteractions = {
  handleKeyboardAction: (action: KeyboardAction) => void;
  handleUIEvent: (event: UIEvent) => void;
  toggleHelp: () => void;
  showToast: (message: string, type?: BrowserToastType) => void;
  joinGame: (code: string, playerToken?: string | null) => void;
  spectateGame: (code: string) => void;
  viewArchivedReplay: (code: string, gameId: string) => void;
};

type SetupClientRuntimeInput = {
  canvas: HTMLCanvasElement;
  map: SolarSystemMap;
  tooltipEl: HTMLElement;
  renderer: Renderer;
  input: InputHandler;
  ui: UIManager;
  ctx: Pick<ClientSession, 'state' | 'gameState' | 'planningState'>;
  interactions: RuntimeInteractions;
  updateTooltip: (x: number, y: number) => void;
  onUpdateSoundButton: () => void;
  resumeLocalGame: () => boolean;
  setMenuState: () => void;
};

export const setupClientRuntime = ({
  canvas,
  map,
  tooltipEl,
  renderer,
  input,
  ui,
  ctx,
  interactions,
  updateTooltip,
  onUpdateSoundButton,
  resumeLocalGame,
  setMenuState,
}: SetupClientRuntimeInput): (() => void) => {
  renderer.setMap(map);
  input.setMap(map);
  ui.onEvent = (event) => interactions.handleUIEvent(event);

  const soundBtn = byId('soundBtn');
  onUpdateSoundButton();

  const disposeBrowserEvents = bindMainBrowserEvents({
    canvas,
    helpCloseBtn: byId('helpCloseBtn'),
    helpBtn: byId('helpBtn'),
    soundBtn,
    tooltipEl,
    getState: () => ctx.state,
    getMap: () => map,
    hasGameState: () => !!ctx.gameState,
    getGameState: () => ctx.gameState,
    getPlanningState: (): KeyboardPlanningSnapshot => ctx.planningState,
    updateTooltip,
    onKeyboardAction: (action) => interactions.handleKeyboardAction(action),
    onToggleHelp: () => interactions.toggleHelp(),
    onUpdateSoundButton,
    showToast: (message, type) => interactions.showToast(message, type),
  });

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    const state = ctx.state;
    if (ctx.gameState && state !== 'menu' && state !== 'gameOver') {
      e.preventDefault();
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  initAudio();
  renderer.start();
  autoJoinFromUrl(
    (code, playerToken) => interactions.joinGame(code, playerToken),
    (code) => {
      interactions.spectateGame(code);
      interactions.showToast(TOAST.spectator.urlWatchOnly, 'info');
    },
    (code, gameId) => interactions.viewArchivedReplay(code, gameId),
    resumeLocalGame,
    setMenuState,
  );

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    disposeBrowserEvents();
  };
};
