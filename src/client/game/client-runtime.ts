import type { SolarSystemMap } from '../../shared/types/domain';
import { initAudio } from '../audio';
import { byId } from '../dom';
import type { InputHandler } from '../input';
import type { Renderer } from '../renderer/renderer';
import type { UIEvent } from '../ui/events';
import type { UIManager } from '../ui/ui';
import type { KeyboardAction } from './keyboard';
import { autoJoinFromUrl, bindMainBrowserEvents } from './main-composition';
import type { KeyboardPlanningSnapshot } from './planning';
import type { ClientSession } from './session-model';

type BrowserToastType = 'error' | 'info' | 'success';

type SetupClientRuntimeInput = {
  canvas: HTMLCanvasElement;
  map: SolarSystemMap;
  tooltipEl: HTMLElement;
  renderer: Renderer;
  input: InputHandler;
  ui: UIManager;
  ctx: Pick<ClientSession, 'state' | 'gameState' | 'planningState'>;
  updateTooltip: (x: number, y: number) => void;
  onKeyboardAction: (action: KeyboardAction) => void;
  onToggleHelp: () => void;
  onUpdateSoundButton: () => void;
  showToast: (message: string, type: BrowserToastType) => void;
  onUIEvent: (event: UIEvent) => void;
  joinGame: (code: string, playerToken: string | null) => void;
  spectateGame: (code: string) => void;
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
  updateTooltip,
  onKeyboardAction,
  onToggleHelp,
  onUpdateSoundButton,
  showToast,
  onUIEvent,
  joinGame,
  spectateGame,
  setMenuState,
}: SetupClientRuntimeInput): (() => void) => {
  renderer.setMap(map);
  input.setMap(map);
  ui.onEvent = onUIEvent;

  const soundBtn = byId('soundBtn');
  onUpdateSoundButton();

  const disposeBrowserEvents = bindMainBrowserEvents({
    canvas,
    helpCloseBtn: byId('helpCloseBtn'),
    helpBtn: byId('helpBtn'),
    soundBtn,
    tooltipEl,
    getState: () => ctx.state,
    hasGameState: () => !!ctx.gameState,
    getGameState: () => ctx.gameState,
    getPlanningState: (): KeyboardPlanningSnapshot => ctx.planningState,
    updateTooltip,
    onKeyboardAction,
    onToggleHelp,
    onUpdateSoundButton,
    showToast,
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
  autoJoinFromUrl(joinGame, spectateGame, setMenuState);

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    disposeBrowserEvents();
  };
};
