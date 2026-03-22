import type {
  CombatResult,
  GameState,
  MovementEvent,
  Ship,
} from '../../shared/types/domain';
import { byId } from '../dom';
import { STATIC_BUTTON_BINDINGS } from './button-bindings';
import type { UIEvent } from './events';
import { FleetBuildingView } from './fleet-building-view';
import { GameLogView } from './game-log-view';
import type { HUDInput } from './hud';
import { HUDChromeView } from './hud-chrome-view';
import { deriveHudLayoutOffsets } from './layout';
import { LobbyView } from './lobby-view';
import { OverlayView } from './overlay-view';
import { buildScreenVisibility, type UIScreenMode } from './screens';
import { ShipListView } from './ship-list-view';

export class UIManager {
  private menuEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
  private topBarEl: HTMLElement;
  private bottomBarEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private shipListEl: HTMLElement;
  private fleetBuildingEl: HTMLElement;
  private isMobile: boolean;
  private layoutSyncFrame: number | null = null;

  private readonly fleetBuildingView: FleetBuildingView;
  private readonly gameLogView: GameLogView;
  private readonly hudChromeView: HUDChromeView;
  private readonly shipListView: ShipListView;
  private readonly lobbyView: LobbyView;
  private readonly overlayView: OverlayView;

  onEvent: ((event: UIEvent) => void) | null = null;

  private readonly handleViewportResize = () => {
    this.queueLayoutSync();
  };

  constructor() {
    this.menuEl = byId('menu');
    this.scenarioEl = byId('scenarioSelect');
    this.waitingEl = byId('waiting');
    this.hudEl = byId('hud');
    this.topBarEl = byId('topBar');
    this.bottomBarEl = byId('bottomBar');
    this.gameOverEl = byId('gameOver');
    this.shipListEl = byId('shipList');
    this.fleetBuildingEl = byId('fleetBuilding');
    this.fleetBuildingView = new FleetBuildingView({
      onFleetReady: (purchases) => {
        this.emit({ type: 'fleetReady', purchases });
      },
    });
    this.gameLogView = new GameLogView({
      onChat: (text) => {
        this.emit({ type: 'chat', text });
      },
    });
    this.lobbyView = new LobbyView({
      emit: (event) => this.emit(event),
      showMenu: () => this.showMenu(),
      showScenarioSelect: () => this.showScenarioSelect(),
    });
    this.shipListView = new ShipListView({
      onSelectShip: (shipId) => {
        this.emit({ type: 'selectShip', shipId });
      },
    });
    this.overlayView = new OverlayView();
    this.hudChromeView = new HUDChromeView({
      getIsMobile: () => this.isMobile,
      queueLayoutSync: () => this.queueLayoutSync(),
      showPhaseAlert: (phase, isMyTurn) => {
        this.overlayView.showPhaseAlert(phase, isMyTurn);
      },
      onStatusText: (text) => {
        this.gameLogView.setStatusText(text);
      },
    });

    const mobileQuery = window.matchMedia('(max-width: 760px)');
    this.isMobile = mobileQuery.matches;
    this.gameLogView.setMobile(
      this.isMobile,
      this.hudEl.style.display !== 'none',
    );

    mobileQuery.addEventListener('change', (e) => {
      this.isMobile = e.matches;
      this.gameLogView.setMobile(
        e.matches,
        this.hudEl.style.display !== 'none',
      );
    });

    window.addEventListener('resize', this.handleViewportResize);
    window.visualViewport?.addEventListener(
      'resize',
      this.handleViewportResize,
    );

    this.bindStaticButtons();
  }

  private emit(event: UIEvent) {
    this.onEvent?.(event);
  }

  private bindStaticButtons() {
    for (const binding of STATIC_BUTTON_BINDINGS) {
      byId(binding.id).addEventListener('click', () => {
        this.emit(binding.event);
      });
    }
  }

  toggleLog() {
    this.gameLogView.toggle();
  }

  private applyScreenVisibility(mode: UIScreenMode) {
    const visibility = buildScreenVisibility(mode);

    this.menuEl.style.display = visibility.menu;
    this.scenarioEl.style.display = visibility.scenario;
    this.waitingEl.style.display = visibility.waiting;
    this.hudEl.style.display = visibility.hud;
    this.gameOverEl.style.display = visibility.gameOver;
    this.shipListEl.style.display = visibility.shipList;
    this.fleetBuildingEl.style.display = visibility.fleetBuilding;
    this.gameLogView.applyScreenVisibility(mode);

    byId('helpBtn').style.display = visibility.helpBtn;
    byId('soundBtn').style.display = visibility.soundBtn;
    byId('helpOverlay').style.display = visibility.helpOverlay;
  }

  hideAll() {
    this.applyScreenVisibility('hidden');
    this.gameLogView.resetVisibilityState();
    this.resetLayoutMetrics();
  }

  setPlayerId(id: number) {
    this.gameLogView.setPlayerId(id);
  }

  showMenu() {
    this.hideAll();
    this.applyScreenVisibility('menu');
    this.lobbyView.onMenuShown();
  }

  setMenuLoading(loading: boolean) {
    this.lobbyView.setMenuLoading(loading);
  }

  showScenarioSelect() {
    this.hideAll();
    this.applyScreenVisibility('scenario');
  }

  showWaiting(code: string) {
    this.hideAll();
    this.applyScreenVisibility('waiting');
    this.lobbyView.showWaiting(code);
  }

  showConnecting() {
    this.hideAll();
    this.applyScreenVisibility('waiting');
    this.lobbyView.showConnecting();
  }

  showHUD() {
    this.hideAll();
    this.applyScreenVisibility('hud');
    this.gameLogView.showHUD();
    this.queueLayoutSync();
  }

  showFleetBuilding(state: GameState, playerId: number) {
    this.hideAll();
    this.applyScreenVisibility('fleetBuilding');
    this.fleetBuildingView.show(state, playerId);
  }

  showFleetWaiting() {
    this.fleetBuildingView.showWaiting();
  }

  updateHUD(input: Omit<HUDInput, 'isMobile'>) {
    this.hudChromeView.update(input);
  }

  updateLatency(latencyMs: number | null) {
    this.hudChromeView.updateLatency(latencyMs);
  }

  updateFleetStatus(status: string) {
    this.hudChromeView.updateFleetStatus(status);
  }

  toggleHelpOverlay() {
    this.hudChromeView.toggleHelpOverlay();
  }

  updateSoundButton(muted: boolean) {
    this.hudChromeView.updateSoundButton(muted);
  }

  setTurnTimer(text: string, className: string) {
    this.hudChromeView.setTurnTimer(text, className);
  }

  clearTurnTimer() {
    this.hudChromeView.clearTurnTimer();
  }

  updateShipList(
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ) {
    this.shipListView.update(ships, selectedId, burns);
  }

  showAttackButton(isVisible: boolean) {
    this.hudChromeView.showAttackButton(isVisible);
  }

  showFireButton(isVisible: boolean, count: number) {
    this.hudChromeView.showFireButton(isVisible, count);
  }

  showMovementStatus() {
    this.hudChromeView.showMovementStatus();
  }

  showGameOver(
    won: boolean,
    reason: string,
    stats?: {
      turns: number;
      myShipsAlive: number;
      myShipsTotal: number;
      enemyShipsAlive: number;
      enemyShipsTotal: number;
    },
  ) {
    this.overlayView.showGameOver(won, reason, stats);
  }

  showRematchPending() {
    this.overlayView.showRematchPending();
  }

  showReconnecting(attempt: number, maxAttempts: number, onCancel: () => void) {
    this.overlayView.showReconnecting(attempt, maxAttempts, onCancel);
  }

  hideReconnecting() {
    this.overlayView.hideReconnecting();
  }

  // --- Toast notifications ---

  showToast(message: string, type: 'error' | 'info' | 'success' = 'info') {
    this.overlayView.showToast(message, type);
  }

  // --- Game log ---

  clearLog() {
    this.gameLogView.clear();
  }

  setChatEnabled(enabled: boolean) {
    this.gameLogView.setChatEnabled(enabled);
  }

  logTurn(turn: number, player: string) {
    this.gameLogView.logTurn(turn, player);
  }

  logText(text: string, cssClass = '') {
    this.gameLogView.logText(text, cssClass);
  }

  logMovementEvents(events: MovementEvent[], ships: Ship[]) {
    this.gameLogView.logMovementEvents(events, ships);
  }

  logCombatResults(results: CombatResult[], ships: Ship[]) {
    this.gameLogView.logCombatResults(results, ships);
  }

  logLanding(shipName: string, bodyName: string) {
    this.gameLogView.logLanding(shipName, bodyName);
  }

  private queueLayoutSync() {
    if (this.layoutSyncFrame !== null) return;

    this.layoutSyncFrame = window.requestAnimationFrame(() => {
      this.layoutSyncFrame = null;
      this.syncLayoutMetrics();
    });
  }

  private syncLayoutMetrics() {
    if (this.hudEl.style.display === 'none') {
      this.resetLayoutMetrics();

      return;
    }

    const offsets = deriveHudLayoutOffsets(
      window.innerHeight,
      this.topBarEl.getBoundingClientRect(),
      this.bottomBarEl.getBoundingClientRect(),
    );

    const rootStyle = document.documentElement.style;

    rootStyle.setProperty('--hud-top-offset', `${offsets.hudTopOffsetPx}px`);
    rootStyle.setProperty(
      '--hud-bottom-offset',
      `${offsets.hudBottomOffsetPx}px`,
    );
  }

  private resetLayoutMetrics() {
    if (this.layoutSyncFrame !== null) {
      window.cancelAnimationFrame(this.layoutSyncFrame);
      this.layoutSyncFrame = null;
    }

    const rootStyle = document.documentElement.style;

    rootStyle.removeProperty('--hud-top-offset');
    rootStyle.removeProperty('--hud-bottom-offset');
  }
}
