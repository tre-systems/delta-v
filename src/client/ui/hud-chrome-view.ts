import { byId, hide, show, visible } from '../dom';
import { ACTION_BUTTON_IDS } from './button-bindings';
import { getLatencyStatus } from './formatters';
import { buildHUDView, type HUDInput } from './hud';

export interface HUDChromeViewDeps {
  getIsMobile: () => boolean;
  queueLayoutSync: () => void;
  showPhaseAlert: (phase: string, isMyTurn: boolean) => void;
}

export class HUDChromeView {
  private lastPhase: string | null = null;

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
  private readonly statusMsgEl = byId('statusMsg');
  private readonly latencyEl = byId('latencyInfo');
  private readonly fleetStatusEl = byId('fleetStatus');
  private readonly helpOverlayEl = byId('helpOverlay');
  private readonly soundBtn = byId('soundBtn');
  private readonly timerEl = byId('turnTimer');
  private readonly attackBtn = byId('attackBtn');
  private readonly fireBtn = byId('fireBtn');

  constructor(private readonly deps: HUDChromeViewDeps) {}

  update(input: Omit<HUDInput, 'isMobile'>): void {
    const hudView = buildHUDView({
      ...input,
      isMobile: this.deps.getIsMobile(),
    });
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

    visible(this.undoBtn, hudView.undoVisible, 'inline-block');
    visible(this.confirmBtn, hudView.confirmVisible, 'inline-block');

    visible(this.launchMineBtn, hudView.launchMine.visible, 'inline-block');
    visible(
      this.launchTorpedoBtn,
      hudView.launchTorpedo.visible,
      'inline-block',
    );
    visible(this.launchNukeBtn, hudView.launchNuke.visible, 'inline-block');
    visible(this.emplaceBaseBtn, hudView.emplaceBaseVisible, 'inline-block');
    visible(this.skipOrdnanceBtn, hudView.skipOrdnanceVisible, 'inline-block');

    this.launchMineBtn.disabled = hudView.launchMine.disabled;
    this.launchTorpedoBtn.disabled = hudView.launchTorpedo.disabled;
    this.launchNukeBtn.disabled = hudView.launchNuke.disabled;

    this.launchMineBtn.style.opacity = hudView.launchMine.opacity;
    this.launchTorpedoBtn.style.opacity = hudView.launchTorpedo.opacity;
    this.launchNukeBtn.style.opacity = hudView.launchNuke.opacity;

    this.launchMineBtn.title = hudView.launchMine.title;
    this.launchTorpedoBtn.title = hudView.launchTorpedo.title;
    this.launchNukeBtn.title = hudView.launchNuke.title;

    visible(this.skipCombatBtn, hudView.skipCombatVisible, 'inline-block');
    visible(
      this.skipLogisticsBtn,
      hudView.skipLogisticsVisible,
      'inline-block',
    );
    visible(
      this.confirmTransfersBtn,
      hudView.confirmTransfersVisible,
      'inline-block',
    );
    visible(this.transferPanelEl, hudView.showTransferPanel, 'block');

    if (hudView.statusText) {
      this.statusMsgEl.textContent = hudView.statusText;
      show(this.statusMsgEl, 'block');
    } else {
      hide(this.statusMsgEl);
    }

    this.deps.queueLayoutSync();
  }

  updateLatency(latencyMs: number | null): void {
    const status = getLatencyStatus(latencyMs);

    this.latencyEl.textContent = status.text;
    this.latencyEl.className = status.className;
  }

  updateFleetStatus(status: string): void {
    this.fleetStatusEl.textContent = status;
  }

  toggleHelpOverlay(): void {
    visible(
      this.helpOverlayEl,
      this.helpOverlayEl.style.display === 'none',
      'flex',
    );
  }

  updateSoundButton(muted: boolean): void {
    this.soundBtn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    this.soundBtn.title = muted ? 'Sound off' : 'Sound on';
    this.soundBtn.setAttribute(
      'aria-label',
      muted ? 'Enable sound effects' : 'Disable sound effects',
    );
    this.soundBtn.classList.toggle('muted', muted);
  }

  setTurnTimer(text: string, className: string): void {
    this.timerEl.textContent = text;
    this.timerEl.className = className;
    this.deps.queueLayoutSync();
  }

  clearTurnTimer(): void {
    this.timerEl.textContent = '';
    this.deps.queueLayoutSync();
  }

  showAttackButton(isVisible: boolean): void {
    visible(this.attackBtn, isVisible, 'inline-block');
    this.deps.queueLayoutSync();
  }

  showFireButton(isVisible: boolean, count: number): void {
    visible(this.fireBtn, isVisible, 'inline-block');
    this.fireBtn.textContent = count > 0 ? `FIRE ALL (${count})` : 'FIRE ALL';
    this.deps.queueLayoutSync();
  }

  showMovementStatus(): void {
    this.statusMsgEl.textContent = 'Ships moving...';
    show(this.statusMsgEl, 'block');

    for (const id of ACTION_BUTTON_IDS) {
      hide(byId(id));
    }

    this.deps.queueLayoutSync();
  }
}
