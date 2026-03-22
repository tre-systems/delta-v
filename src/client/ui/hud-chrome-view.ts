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

export class HUDChromeView {
  private readonly scope = createDisposalScope();
  private lastPhase: string | null = null;
  private readonly inputSignal = signal<Omit<HUDInput, 'isMobile'> | null>(
    null,
  );
  private readonly isMobileSignal = signal(false);
  private readonly statusOverrideSignal = signal<string | null>(null);
  private readonly suppressActionButtonsSignal = signal(false);
  private readonly latencySignal = signal<number | null>(null);
  private readonly fleetStatusSignal = signal('');
  private readonly helpOverlayVisibleSignal = signal(false);
  private readonly soundMutedSignal = signal(false);
  private readonly turnTimerSignal = signal<{
    text: string;
    className: string;
  } | null>(null);
  private readonly attackButtonVisibleSignal = signal(false);
  private readonly fireButtonSignal = signal<FireButtonState>({
    isVisible: false,
    count: 0,
  });

  private readonly turnInfoEl = byId('turnInfo');
  private readonly phaseInfoEl = byId('phaseInfo');
  private readonly objectiveEl = byId('objective');
  private readonly fuelGaugeEl = byId('fuelGauge');
  private readonly undoBtn = byId('undoBtn');
  private readonly confirmBtn = byId('confirmBtn');
  private readonly launchMineBtn = byId<HTMLButtonElement>('launchMineBtn');
  private readonly launchTorpedoBtn =
    byId<HTMLButtonElement>('launchTorpedoBtn');
  private readonly launchNukeBtn = byId<HTMLButtonElement>('launchNukeBtn');
  private readonly emplaceBaseBtn = byId<HTMLButtonElement>('emplaceBaseBtn');
  private readonly skipOrdnanceBtn = byId('skipOrdnanceBtn');
  private readonly skipCombatBtn = byId('skipCombatBtn');
  private readonly skipLogisticsBtn = byId('skipLogisticsBtn');
  private readonly confirmTransfersBtn = byId('confirmTransfersBtn');
  private readonly transferPanelEl = byId('transferPanel');
  private readonly latencyEl = byId('latencyInfo');
  private readonly fleetStatusEl = byId('fleetStatus');
  private readonly helpOverlayEl = byId('helpOverlay');
  private readonly soundBtn = byId('soundBtn');
  private readonly timerEl = byId('turnTimer');
  private readonly attackBtn = byId('attackBtn');
  private readonly fireBtn = byId('fireBtn');

  constructor(private readonly deps: HUDChromeViewDeps) {
    const viewSignal = this.scope.add(
      computed(() => {
        const input = this.inputSignal.value;
        if (!input) return null;

        const hudView = buildHUDView({
          ...input,
          isMobile: this.isMobileSignal.value,
        });

        return {
          input,
          hudView,
          suppressActionButtons: this.suppressActionButtonsSignal.value,
        };
      }),
    );

    const statusTextSignal = this.scope.add(
      computed(() => {
        const statusOverride = this.statusOverrideSignal.value;
        const state = viewSignal.value;

        return statusOverride ?? state?.hudView.statusText ?? null;
      }),
    );

    this.scope.add(
      effect(() => {
        const state = viewSignal.value;
        if (!state) return;
        const { input, hudView } = state;
        const hideActions = state.suppressActionButtons;

        const { turn, phase, isMyTurn } = input;

        this.turnInfoEl.textContent = hudView.turnText;
        this.phaseInfoEl.textContent = hudView.phaseText;
        this.objectiveEl.textContent = hudView.objectiveText;

        const phaseKey = `${turn}-${phase}-${isMyTurn}`;

        if (this.lastPhase !== phaseKey) {
          this.lastPhase = phaseKey;
          this.deps.showPhaseAlert(phase, isMyTurn);
        }

        this.fuelGaugeEl.textContent = hudView.fuelGaugeText;

        visible(
          this.undoBtn,
          !hideActions && hudView.undoVisible,
          'inline-block',
        );
        visible(
          this.confirmBtn,
          !hideActions && hudView.confirmVisible,
          'inline-block',
        );

        visible(
          this.launchMineBtn,
          !hideActions && hudView.launchMine.visible,
          'inline-block',
        );
        visible(
          this.launchTorpedoBtn,
          !hideActions && hudView.launchTorpedo.visible,
          'inline-block',
        );
        visible(
          this.launchNukeBtn,
          !hideActions && hudView.launchNuke.visible,
          'inline-block',
        );
        visible(
          this.emplaceBaseBtn,
          !hideActions && hudView.emplaceBaseVisible,
          'inline-block',
        );
        visible(
          this.skipOrdnanceBtn,
          !hideActions && hudView.skipOrdnanceVisible,
          'inline-block',
        );

        this.launchMineBtn.disabled = hudView.launchMine.disabled;
        this.launchTorpedoBtn.disabled = hudView.launchTorpedo.disabled;
        this.launchNukeBtn.disabled = hudView.launchNuke.disabled;

        this.launchMineBtn.style.opacity = hudView.launchMine.opacity;
        this.launchTorpedoBtn.style.opacity = hudView.launchTorpedo.opacity;
        this.launchNukeBtn.style.opacity = hudView.launchNuke.opacity;

        this.launchMineBtn.title = hudView.launchMine.title;
        this.launchTorpedoBtn.title = hudView.launchTorpedo.title;
        this.launchNukeBtn.title = hudView.launchNuke.title;

        visible(
          this.skipCombatBtn,
          !hideActions && hudView.skipCombatVisible,
          'inline-block',
        );
        visible(
          this.skipLogisticsBtn,
          !hideActions && hudView.skipLogisticsVisible,
          'inline-block',
        );
        visible(
          this.confirmTransfersBtn,
          !hideActions && hudView.confirmTransfersVisible,
          'inline-block',
        );
        visible(
          this.transferPanelEl,
          !hideActions && hudView.showTransferPanel,
          'block',
        );

        this.deps.queueLayoutSync();
      }),
    );

    this.scope.add(
      effect(() => {
        this.deps.onStatusText(statusTextSignal.value);
      }),
    );

    this.scope.add(
      effect(() => {
        const status = getLatencyStatus(this.latencySignal.value);

        this.latencyEl.textContent = status.text;
        this.latencyEl.className = status.className;
      }),
    );

    this.scope.add(
      effect(() => {
        this.fleetStatusEl.textContent = this.fleetStatusSignal.value;
      }),
    );

    this.scope.add(
      effect(() => {
        visible(
          this.helpOverlayEl,
          this.helpOverlayVisibleSignal.value,
          'flex',
        );
      }),
    );

    this.scope.add(
      effect(() => {
        const muted = this.soundMutedSignal.value;

        this.soundBtn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
        this.soundBtn.title = muted ? 'Sound off' : 'Sound on';
        this.soundBtn.setAttribute(
          'aria-label',
          muted ? 'Enable sound effects' : 'Disable sound effects',
        );
        this.soundBtn.classList.toggle('muted', muted);
      }),
    );

    this.scope.add(
      effect(() => {
        const timer = this.turnTimerSignal.value;

        this.timerEl.textContent = timer?.text ?? '';
        this.timerEl.className = timer?.className ?? '';
      }),
    );

    this.scope.add(
      effect(() => {
        visible(
          this.attackBtn,
          this.attackButtonVisibleSignal.value,
          'inline-block',
        );
      }),
    );

    this.scope.add(
      effect(() => {
        const fireButton = this.fireButtonSignal.value;

        visible(this.fireBtn, fireButton.isVisible, 'inline-block');
        this.fireBtn.textContent =
          fireButton.count > 0 ? `FIRE ALL (${fireButton.count})` : 'FIRE ALL';
      }),
    );
  }

  setMobile(isMobile: boolean): void {
    this.isMobileSignal.value = isMobile;
  }

  update(input: Omit<HUDInput, 'isMobile'>): void {
    batch(() => {
      this.statusOverrideSignal.value = null;
      this.suppressActionButtonsSignal.value = false;
      this.inputSignal.value = cloneHUDInput(input);
    });
  }

  updateLatency(latencyMs: number | null): void {
    this.latencySignal.value = latencyMs;
  }

  updateFleetStatus(status: string): void {
    this.fleetStatusSignal.value = status;
  }

  toggleHelpOverlay(): void {
    this.helpOverlayVisibleSignal.update((value) => !value);
  }

  updateSoundButton(muted: boolean): void {
    this.soundMutedSignal.value = muted;
  }

  setTurnTimer(text: string, className: string): void {
    this.turnTimerSignal.value = { text, className };
    this.deps.queueLayoutSync();
  }

  clearTurnTimer(): void {
    this.turnTimerSignal.value = null;
    this.deps.queueLayoutSync();
  }

  showAttackButton(isVisible: boolean): void {
    this.attackButtonVisibleSignal.value = isVisible;
    this.deps.queueLayoutSync();
  }

  showFireButton(isVisible: boolean, count: number): void {
    this.fireButtonSignal.value = {
      isVisible,
      count,
    };
    this.deps.queueLayoutSync();
  }

  showMovementStatus(): void {
    const hasInput = this.inputSignal.peek() !== null;

    batch(() => {
      this.statusOverrideSignal.value = 'Ships moving...';
      this.suppressActionButtonsSignal.value = true;
      this.attackButtonVisibleSignal.value = false;
      this.fireButtonSignal.value = {
        isVisible: false,
        count: 0,
      };
    });

    for (const id of ACTION_BUTTON_IDS) {
      hide(byId(id));
    }

    if (!hasInput) {
      this.deps.queueLayoutSync();
    }
  }

  dispose(): void {
    this.scope.dispose();
  }
}
