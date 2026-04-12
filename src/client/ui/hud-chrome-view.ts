import {
  byId,
  cls,
  hide,
  listen,
  setTrustedHTML,
  show,
  text,
  visible,
} from '../dom';
import {
  computed,
  createDisposalScope,
  effect,
  type ReadonlySignal,
  signal,
  withScope,
} from '../reactive';
import { getLatencyStatus } from './formatters';
import { buildHUDView, type HUDInput } from './hud';

export interface HUDChromeViewDeps {
  queueLayoutSync: () => void;
  showPhaseAlert: (phase: string, isMyTurn: boolean) => void;
  onStatusText: (text: string | null) => void;
}

interface FireButtonState {
  isVisible: boolean;
  count: number;
}

export interface HUDChromeView {
  setMobile: (isMobile: boolean) => void;
  update: (input: Omit<HUDInput, 'isMobile'>) => void;
  updateLatency: (latencyMs: number | null) => void;
  updateFleetStatus: (status: string) => void;
  toggleHelpOverlay: () => void;
  updateSoundButton: (muted: boolean) => void;
  bindTurnTimerSignal: (
    timerSignal: ReadonlySignal<{
      text: string;
      className: string;
    } | null>,
  ) => void;
  showAttackButton: (isVisible: boolean) => void;
  showFireButton: (isVisible: boolean, count: number) => void;
  dispose: () => void;
}

const HELP_OVERLAY_FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const getFocusableHelpElements = (container: HTMLElement): HTMLElement[] => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(HELP_OVERLAY_FOCUSABLE),
  ).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true',
  );
};

const cloneHUDInput = (
  input: Omit<HUDInput, 'isMobile'>,
): Omit<HUDInput, 'isMobile'> => {
  return {
    ...input,
    astrogationCtx: {
      ...input.astrogationCtx,
    },
    launchMineState: {
      ...input.launchMineState,
    },
    launchTorpedoState: {
      ...input.launchTorpedoState,
    },
    launchNukeState: {
      ...input.launchNukeState,
    },
    emplaceBaseState: {
      ...input.emplaceBaseState,
    },
  };
};

export const createHUDChromeView = (deps: HUDChromeViewDeps): HUDChromeView => {
  const scope = createDisposalScope();
  let helpOverlayReturnFocusEl: HTMLElement | null = null;
  const inputSignal = signal<Omit<HUDInput, 'isMobile'> | null>(null);
  const isMobileSignal = signal(false);
  const latencySignal = signal<number | null>(null);
  const fleetStatusSignal = signal('');
  const helpOverlayVisibleSignal = signal(false);
  const soundMutedSignal = signal(false);
  const hiddenTurnTimerSignal = signal<{
    text: string;
    className: string;
  } | null>(null);
  const turnTimerSourceSignal = signal<
    ReadonlySignal<{
      text: string;
      className: string;
    } | null>
  >(hiddenTurnTimerSignal);
  const attackButtonVisibleSignal = signal(false);
  const fireButtonSignal = signal<FireButtonState>({
    isVisible: false,
    count: 0,
  });

  const turnInfoEl = byId('turnInfo');
  const phaseInfoEl = byId('phaseInfo');
  const objectiveCompassEl = byId('objectiveCompass');
  const objectiveEl = byId('objective');
  const fuelGaugeEl = byId('fuelGauge');
  const undoBtn = byId('undoBtn');
  const skipShipBtn = byId('skipShipBtn');
  const confirmBtn = byId('confirmBtn');
  const landFromOrbitBtn = byId<HTMLButtonElement>('landFromOrbitBtn');
  const launchMineBtn = byId<HTMLButtonElement>('launchMineBtn');
  const launchTorpedoBtn = byId<HTMLButtonElement>('launchTorpedoBtn');
  const launchNukeBtn = byId<HTMLButtonElement>('launchNukeBtn');
  const emplaceBaseBtn = byId<HTMLButtonElement>('emplaceBaseBtn');
  const skipOrdnanceBtn = byId('skipOrdnanceBtn');
  const skipCombatBtn = byId('skipCombatBtn');
  const skipLogisticsBtn = byId('skipLogisticsBtn');
  const confirmTransfersBtn = byId('confirmTransfersBtn');
  const transferPanelEl = byId('transferPanel');
  const hudBottomButtonsEl = byId('hudBottomButtons');
  const latencyEl = byId('latencyInfo');
  const fleetStatusEl = byId('fleetStatus');
  const helpOverlayEl = byId('helpOverlay');
  const helpBtn = byId<HTMLButtonElement>('helpBtn');
  const helpCloseBtn = byId<HTMLButtonElement>('helpCloseBtn');
  const soundBtn = byId('soundBtn');
  const timerEl = byId('turnTimer');
  const attackBtn = byId('attackBtn');
  const fireBtn = byId('fireBtn');

  const setMobile = (isMobile: boolean): void => {
    isMobileSignal.value = isMobile;
  };

  const update = (input: Omit<HUDInput, 'isMobile'>): void => {
    inputSignal.value = cloneHUDInput(input);
  };

  const updateLatency = (latencyMs: number | null): void => {
    latencySignal.value = latencyMs;
  };

  const updateFleetStatus = (status: string): void => {
    fleetStatusSignal.value = status;
  };

  const toggleHelpOverlay = (): void => {
    const opening = !helpOverlayVisibleSignal.peek();

    if (opening) {
      const activeElement = document.activeElement;
      helpOverlayReturnFocusEl =
        activeElement instanceof HTMLElement ? activeElement : null;
    }

    helpOverlayVisibleSignal.update((value) => !value);

    queueMicrotask(() => {
      if (opening) {
        helpCloseBtn.focus();
        return;
      }

      const restoreTarget = helpOverlayReturnFocusEl;
      helpOverlayReturnFocusEl = null;
      (restoreTarget ?? helpBtn).focus();
    });
  };

  const updateSoundButton = (muted: boolean): void => {
    soundMutedSignal.value = muted;
  };

  const bindTurnTimerSignal = (
    timerSignal: ReadonlySignal<{
      text: string;
      className: string;
    } | null>,
  ): void => {
    turnTimerSourceSignal.value = timerSignal;
  };

  const showAttackButton = (isVisible: boolean): void => {
    attackButtonVisibleSignal.value = isVisible;
    deps.queueLayoutSync();
  };

  const showFireButton = (isVisible: boolean, count: number): void => {
    fireButtonSignal.value = {
      isVisible,
      count,
    };
    deps.queueLayoutSync();
  };

  const dispose = (): void => {
    scope.dispose();
  };

  withScope(scope, () => {
    const viewSignal = computed(() => {
      const input = inputSignal.value;

      if (!input) return null;

      const hudView = buildHUDView({
        ...input,
        isMobile: isMobileSignal.value,
      });

      return {
        input,
        hudView,
        statusOverrideText: input.statusOverrideText ?? null,
        suppressActionButtons: input.suppressActionButtons ?? false,
      };
    });

    const statusTextSignal = computed(() => {
      const state = viewSignal.value;

      return state?.statusOverrideText ?? state?.hudView.statusText ?? null;
    });

    effect(() => {
      const state = viewSignal.value;

      if (!state) return;
      const { hudView } = state;
      const hideActions = state.suppressActionButtons;

      text(turnInfoEl, hudView.turnText);
      text(phaseInfoEl, hudView.phaseText);
      text(objectiveEl, hudView.objectiveText);

      const compassDeg = hudView.objectiveCompassDegrees;
      if (compassDeg !== null) {
        show(objectiveCompassEl, 'inline-flex');
        objectiveCompassEl.style.transform = `rotate(${compassDeg}deg)`;
        objectiveCompassEl.title = 'Direction to objective (map)';
      } else {
        hide(objectiveCompassEl);
        objectiveCompassEl.style.transform = '';
        objectiveCompassEl.title = '';
      }

      text(fuelGaugeEl, hudView.fuelGaugeText);

      visible(undoBtn, !hideActions && hudView.undoVisible, 'inline-block');
      visible(
        skipShipBtn,
        !hideActions && hudView.skipShipVisible,
        'inline-block',
      );
      visible(
        confirmBtn,
        !hideActions && hudView.confirmVisible,
        'inline-block',
      );
      visible(
        landFromOrbitBtn,
        !hideActions && hudView.landFromOrbit.visible,
        'inline-block',
      );
      landFromOrbitBtn.disabled = hudView.landFromOrbit.disabled;
      landFromOrbitBtn.style.opacity = hudView.landFromOrbit.opacity;
      landFromOrbitBtn.title = hudView.landFromOrbit.title;
      landFromOrbitBtn.textContent = hudView.landFromOrbit.title.startsWith(
        'Landing',
      )
        ? 'LANDING'
        : 'LAND';

      visible(
        launchMineBtn,
        !hideActions && hudView.launchMine.visible,
        'inline-block',
      );
      visible(
        launchTorpedoBtn,
        !hideActions && hudView.launchTorpedo.visible,
        'inline-block',
      );
      visible(
        launchNukeBtn,
        !hideActions && hudView.launchNuke.visible,
        'inline-block',
      );
      visible(
        emplaceBaseBtn,
        !hideActions && hudView.emplaceBase.visible,
        'inline-block',
      );
      visible(
        skipOrdnanceBtn,
        !hideActions && hudView.skipOrdnanceVisible,
        'inline-block',
      );
      skipOrdnanceBtn.textContent = hudView.skipOrdnanceLabel;
      skipOrdnanceBtn.className = hudView.skipOrdnanceIsConfirm
        ? 'btn btn-confirm'
        : 'btn btn-skip';

      launchMineBtn.disabled = hudView.launchMine.disabled;
      launchTorpedoBtn.disabled = hudView.launchTorpedo.disabled;
      launchNukeBtn.disabled = hudView.launchNuke.disabled;
      emplaceBaseBtn.disabled = hudView.emplaceBase.disabled;

      launchMineBtn.classList.toggle(
        'active',
        hudView.queuedOrdnanceType === 'mine',
      );
      launchTorpedoBtn.classList.toggle(
        'active',
        hudView.queuedOrdnanceType === 'torpedo',
      );
      launchNukeBtn.classList.toggle(
        'active',
        hudView.queuedOrdnanceType === 'nuke',
      );

      launchMineBtn.style.opacity = hudView.launchMine.opacity;
      launchTorpedoBtn.style.opacity = hudView.launchTorpedo.opacity;
      launchNukeBtn.style.opacity = hudView.launchNuke.opacity;
      emplaceBaseBtn.style.opacity = hudView.emplaceBase.opacity;

      launchMineBtn.title = hudView.launchMine.title;
      launchTorpedoBtn.title = hudView.launchTorpedo.title;
      launchNukeBtn.title = hudView.launchNuke.title;
      emplaceBaseBtn.title = hudView.emplaceBase.title;

      visible(
        skipCombatBtn,
        !hideActions && hudView.skipCombatVisible,
        'inline-block',
      );
      visible(
        skipLogisticsBtn,
        !hideActions && hudView.skipLogisticsVisible,
        'inline-block',
      );
      visible(
        confirmTransfersBtn,
        !hideActions && hudView.confirmTransfersVisible,
        'inline-block',
      );
      visible(
        transferPanelEl,
        !hideActions && hudView.showTransferPanel,
        'block',
      );

      deps.queueLayoutSync();
    });

    effect(() => {
      const state = viewSignal.value;
      const attackVisible = attackButtonVisibleSignal.value;
      const fireVisible = fireButtonSignal.value.isVisible;
      const hasButtons =
        !!state &&
        !state.suppressActionButtons &&
        (state.hudView.undoVisible ||
          state.hudView.skipShipVisible ||
          state.hudView.confirmVisible ||
          state.hudView.landFromOrbit.visible ||
          state.hudView.launchMine.visible ||
          state.hudView.launchTorpedo.visible ||
          state.hudView.launchNuke.visible ||
          state.hudView.emplaceBase.visible ||
          state.hudView.skipOrdnanceVisible ||
          state.hudView.skipCombatVisible ||
          state.hudView.skipLogisticsVisible ||
          state.hudView.confirmTransfersVisible ||
          attackVisible ||
          fireVisible);
      const isEmpty = !hasButtons;

      if (hudBottomButtonsEl.classList.contains('is-empty') !== isEmpty) {
        hudBottomButtonsEl.classList.toggle('is-empty', isEmpty);
        deps.queueLayoutSync();
      }
    });

    effect(() => {
      deps.onStatusText(statusTextSignal.value);
    });

    effect(() => {
      const status = getLatencyStatus(latencySignal.value);

      text(latencyEl, status.text);
      latencyEl.className = status.className;
    });

    text(fleetStatusEl, fleetStatusSignal);
    visible(helpOverlayEl, helpOverlayVisibleSignal, 'flex');

    effect(() => {
      const muted = soundMutedSignal.value;

      setTrustedHTML(
        soundBtn,
        muted
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
      );
      soundBtn.title = muted ? 'Sound off' : 'Sound on';
      soundBtn.setAttribute(
        'aria-label',
        muted ? 'Enable sound effects' : 'Disable sound effects',
      );
      cls(soundBtn, 'muted', muted);
    });

    effect(() => {
      const timer = turnTimerSourceSignal.value.value;
      const nextText = timer?.text ?? '';
      const nextClassName = timer?.className ?? '';
      const didChange =
        timerEl.textContent !== nextText || timerEl.className !== nextClassName;

      text(timerEl, nextText);
      timerEl.className = nextClassName;

      if (didChange) {
        deps.queueLayoutSync();
      }
    });

    effect(() => {
      const hideActions = viewSignal.value?.suppressActionButtons ?? false;
      const attackVisible = attackButtonVisibleSignal.value;

      visible(attackBtn, !hideActions && attackVisible, 'inline-block');
    });

    effect(() => {
      const hideActions = viewSignal.value?.suppressActionButtons ?? false;
      const fireButton = fireButtonSignal.value;

      visible(fireBtn, !hideActions && fireButton.isVisible, 'inline-block');
      const isConfirm = fireButton.count > 0;
      text(fireBtn, isConfirm ? 'CONFIRM' : 'END COMBAT');
      fireBtn.className = isConfirm ? 'btn btn-confirm' : 'btn btn-skip';
    });

    listen(helpOverlayEl, 'keydown', (event) => {
      if (!helpOverlayVisibleSignal.peek()) {
        return;
      }

      const keyEvent = event as KeyboardEvent;

      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        toggleHelpOverlay();
        return;
      }

      if (keyEvent.key !== 'Tab') {
        return;
      }

      const focusable = getFocusableHelpElements(helpOverlayEl);
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (keyEvent.shiftKey) {
        if (active === first || !helpOverlayEl.contains(active)) {
          keyEvent.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        keyEvent.preventDefault();
        first.focus();
      }
    });
  });

  return {
    setMobile,
    update,
    updateLatency,
    updateFleetStatus,
    toggleHelpOverlay,
    updateSoundButton,
    bindTurnTimerSignal,
    showAttackButton,
    showFireButton,
    dispose,
  };
};
