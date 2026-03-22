import { byId, hide, visible } from '../dom';
import {
  batch,
  computed,
  createDisposalScope,
  effect,
  signal,
} from '../reactive';
import { ACTION_BUTTON_IDS } from './button-bindings';
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
  setTurnTimer: (text: string, className: string) => void;
  clearTurnTimer: () => void;
  showAttackButton: (isVisible: boolean) => void;
  showFireButton: (isVisible: boolean, count: number) => void;
  showMovementStatus: () => void;
  dispose: () => void;
}

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
  };
};

export const createHUDChromeView = (deps: HUDChromeViewDeps): HUDChromeView => {
  const scope = createDisposalScope();
  let lastPhase: string | null = null;
  const inputSignal = signal<Omit<HUDInput, 'isMobile'> | null>(null);
  const isMobileSignal = signal(false);
  const statusOverrideSignal = signal<string | null>(null);
  const suppressActionButtonsSignal = signal(false);
  const latencySignal = signal<number | null>(null);
  const fleetStatusSignal = signal('');
  const helpOverlayVisibleSignal = signal(false);
  const soundMutedSignal = signal(false);
  const turnTimerSignal = signal<{
    text: string;
    className: string;
  } | null>(null);
  const attackButtonVisibleSignal = signal(false);
  const fireButtonSignal = signal<FireButtonState>({
    isVisible: false,
    count: 0,
  });

  const turnInfoEl = byId('turnInfo');
  const phaseInfoEl = byId('phaseInfo');
  const objectiveEl = byId('objective');
  const fuelGaugeEl = byId('fuelGauge');
  const undoBtn = byId('undoBtn');
  const confirmBtn = byId('confirmBtn');
  const launchMineBtn = byId<HTMLButtonElement>('launchMineBtn');
  const launchTorpedoBtn = byId<HTMLButtonElement>('launchTorpedoBtn');
  const launchNukeBtn = byId<HTMLButtonElement>('launchNukeBtn');
  const emplaceBaseBtn = byId<HTMLButtonElement>('emplaceBaseBtn');
  const skipOrdnanceBtn = byId('skipOrdnanceBtn');
  const skipCombatBtn = byId('skipCombatBtn');
  const skipLogisticsBtn = byId('skipLogisticsBtn');
  const confirmTransfersBtn = byId('confirmTransfersBtn');
  const transferPanelEl = byId('transferPanel');
  const latencyEl = byId('latencyInfo');
  const fleetStatusEl = byId('fleetStatus');
  const helpOverlayEl = byId('helpOverlay');
  const soundBtn = byId('soundBtn');
  const timerEl = byId('turnTimer');
  const attackBtn = byId('attackBtn');
  const fireBtn = byId('fireBtn');

  const viewSignal = scope.add(
    computed(() => {
      const input = inputSignal.value;
      if (!input) return null;

      const hudView = buildHUDView({
        ...input,
        isMobile: isMobileSignal.value,
      });

      return {
        input,
        hudView,
        suppressActionButtons: suppressActionButtonsSignal.value,
      };
    }),
  );

  const statusTextSignal = scope.add(
    computed(() => {
      const statusOverride = statusOverrideSignal.value;
      const state = viewSignal.value;

      return statusOverride ?? state?.hudView.statusText ?? null;
    }),
  );

  scope.add(
    effect(() => {
      const state = viewSignal.value;
      if (!state) return;
      const { input, hudView } = state;
      const hideActions = state.suppressActionButtons;

      const { turn, phase, isMyTurn } = input;

      turnInfoEl.textContent = hudView.turnText;
      phaseInfoEl.textContent = hudView.phaseText;
      objectiveEl.textContent = hudView.objectiveText;

      const phaseKey = `${turn}-${phase}-${isMyTurn}`;

      if (lastPhase !== phaseKey) {
        lastPhase = phaseKey;
        deps.showPhaseAlert(phase, isMyTurn);
      }

      fuelGaugeEl.textContent = hudView.fuelGaugeText;

      visible(undoBtn, !hideActions && hudView.undoVisible, 'inline-block');
      visible(
        confirmBtn,
        !hideActions && hudView.confirmVisible,
        'inline-block',
      );

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
        !hideActions && hudView.emplaceBaseVisible,
        'inline-block',
      );
      visible(
        skipOrdnanceBtn,
        !hideActions && hudView.skipOrdnanceVisible,
        'inline-block',
      );

      launchMineBtn.disabled = hudView.launchMine.disabled;
      launchTorpedoBtn.disabled = hudView.launchTorpedo.disabled;
      launchNukeBtn.disabled = hudView.launchNuke.disabled;

      launchMineBtn.style.opacity = hudView.launchMine.opacity;
      launchTorpedoBtn.style.opacity = hudView.launchTorpedo.opacity;
      launchNukeBtn.style.opacity = hudView.launchNuke.opacity;

      launchMineBtn.title = hudView.launchMine.title;
      launchTorpedoBtn.title = hudView.launchTorpedo.title;
      launchNukeBtn.title = hudView.launchNuke.title;

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
    }),
  );

  scope.add(
    effect(() => {
      deps.onStatusText(statusTextSignal.value);
    }),
  );

  scope.add(
    effect(() => {
      const status = getLatencyStatus(latencySignal.value);

      latencyEl.textContent = status.text;
      latencyEl.className = status.className;
    }),
  );

  scope.add(
    effect(() => {
      fleetStatusEl.textContent = fleetStatusSignal.value;
    }),
  );

  scope.add(
    effect(() => {
      visible(helpOverlayEl, helpOverlayVisibleSignal.value, 'flex');
    }),
  );

  scope.add(
    effect(() => {
      const muted = soundMutedSignal.value;

      soundBtn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
      soundBtn.title = muted ? 'Sound off' : 'Sound on';
      soundBtn.setAttribute(
        'aria-label',
        muted ? 'Enable sound effects' : 'Disable sound effects',
      );
      soundBtn.classList.toggle('muted', muted);
    }),
  );

  scope.add(
    effect(() => {
      const timer = turnTimerSignal.value;

      timerEl.textContent = timer?.text ?? '';
      timerEl.className = timer?.className ?? '';
    }),
  );

  scope.add(
    effect(() => {
      visible(attackBtn, attackButtonVisibleSignal.value, 'inline-block');
    }),
  );

  scope.add(
    effect(() => {
      const fireButton = fireButtonSignal.value;

      visible(fireBtn, fireButton.isVisible, 'inline-block');
      fireBtn.textContent =
        fireButton.count > 0 ? `FIRE ALL (${fireButton.count})` : 'FIRE ALL';
    }),
  );

  const setMobile = (isMobile: boolean): void => {
    isMobileSignal.value = isMobile;
  };

  const update = (input: Omit<HUDInput, 'isMobile'>): void => {
    batch(() => {
      statusOverrideSignal.value = null;
      suppressActionButtonsSignal.value = false;
      inputSignal.value = cloneHUDInput(input);
    });
  };

  const updateLatency = (latencyMs: number | null): void => {
    latencySignal.value = latencyMs;
  };

  const updateFleetStatus = (status: string): void => {
    fleetStatusSignal.value = status;
  };

  const toggleHelpOverlay = (): void => {
    helpOverlayVisibleSignal.update((value) => !value);
  };

  const updateSoundButton = (muted: boolean): void => {
    soundMutedSignal.value = muted;
  };

  const setTurnTimer = (text: string, className: string): void => {
    turnTimerSignal.value = { text, className };
    deps.queueLayoutSync();
  };

  const clearTurnTimer = (): void => {
    turnTimerSignal.value = null;
    deps.queueLayoutSync();
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

  const showMovementStatus = (): void => {
    const hasInput = inputSignal.peek() !== null;

    batch(() => {
      statusOverrideSignal.value = 'Ships moving...';
      suppressActionButtonsSignal.value = true;
      attackButtonVisibleSignal.value = false;
      fireButtonSignal.value = {
        isVisible: false,
        count: 0,
      };
    });

    for (const id of ACTION_BUTTON_IDS) {
      hide(byId(id));
    }

    if (!hasInput) {
      deps.queueLayoutSync();
    }
  };

  const dispose = (): void => {
    scope.dispose();
  };

  return {
    setMobile,
    update,
    updateLatency,
    updateFleetStatus,
    toggleHelpOverlay,
    updateSoundButton,
    setTurnTimer,
    clearTurnTimer,
    showAttackButton,
    showFireButton,
    showMovementStatus,
    dispose,
  };
};
