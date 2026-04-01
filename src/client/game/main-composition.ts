import { CODE_LENGTH } from '../../shared/constants';
import { normalizePlayerToken, normalizeRoomCode } from '../../shared/ids';
import { isMuted, setMuted } from '../audio';
import { hide } from '../dom';
import {
  bindGameClientBrowserEvents,
  bindServiceWorkerControllerReload,
} from '../game-client-browser';
import { deriveKeyboardAction } from './keyboard';
import type { ClientState } from './phase';
import type { PlanningState } from './planning';
import { buildGameRoute } from './session-links';

interface BrowserBindingDeps {
  canvas: HTMLCanvasElement;
  helpCloseBtn: HTMLElement;
  helpBtn: HTMLElement;
  soundBtn: HTMLElement;
  tooltipEl: HTMLElement;
  getState: () => ClientState;
  hasGameState: () => boolean;
  getPlanningState: () => PlanningState;
  updateTooltip: (x: number, y: number) => void;
  onKeyboardAction: (action: import('./keyboard').KeyboardAction) => void;
  onToggleHelp: () => void;
  onUpdateSoundButton: () => void;
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
}

export const bindMainBrowserEvents = (deps: BrowserBindingDeps): (() => void) =>
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
    onOffline: () =>
      deps.showToast("You're offline — check your connection", 'error'),
    onOnline: () => deps.showToast('Back online', 'success'),
  });

export const autoJoinFromUrl = (
  joinGame: (code: string, playerToken: string | null) => void,
  spectateGame: (code: string) => void,
  setMenuState: () => void,
): void => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = normalizeRoomCode(urlParams.get('code'));
  const playerToken = normalizePlayerToken(urlParams.get('playerToken'));
  const viewer = urlParams.get('viewer');

  if (code && code.length === CODE_LENGTH) {
    history.replaceState(null, '', buildGameRoute(code));
    if (viewer === 'spectator') {
      spectateGame(code);
    } else {
      joinGame(code, playerToken);
    }
    return;
  }
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
