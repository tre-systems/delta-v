import type { GameState, Ship } from '../../shared/types/domain';
import { byId, listen, visible } from '../dom';
import { createDisposalScope, withScope } from '../reactive';
import { STATIC_BUTTON_BINDINGS } from './button-bindings';
import type { UIEvent } from './events';
import {
  createFleetBuildingView,
  type FleetBuildingView,
} from './fleet-building-view';
import { createGameLogView, type GameLogView } from './game-log-view';
import type { HUDInput } from './hud';
import { createHUDChromeView, type HUDChromeView } from './hud-chrome-view';
import { deriveHudLayoutOffsets } from './layout';
import { createLobbyView, type LobbyView } from './lobby-view';
import { createOverlayView, type OverlayView } from './overlay-view';
import { buildScreenVisibility, type UIScreenMode } from './screens';
import { createShipListView, type ShipListView } from './ship-list-view';

export class UIManager {
  private readonly scope = createDisposalScope();
  private menuEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private waitingEl: HTMLElement;
  private hudEl: HTMLElement;
  private topBarEl: HTMLElement;
  private bottomBarEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private shipListEl: HTMLElement;
  private fleetBuildingEl: HTMLElement;
  private readonly mobileQuery: MediaQueryList;
  private isMobile: boolean;
  private layoutSyncFrame: number | null = null;

  private readonly fleetBuildingView: FleetBuildingView;
  readonly log: GameLogView;
  private readonly hudChromeView: HUDChromeView;
  private readonly shipListView: ShipListView;
  private readonly lobbyView: LobbyView;
  readonly overlay: OverlayView;

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
    this.fleetBuildingView = createFleetBuildingView({
      onFleetReady: (purchases) => {
        this.emit({ type: 'fleetReady', purchases });
      },
    });
    this.log = createGameLogView({
      onChat: (text) => {
        this.emit({ type: 'chat', text });
      },
    });
    this.lobbyView = createLobbyView({
      emit: (event) => this.emit(event),
      showMenu: () => this.showMenu(),
      showScenarioSelect: () => this.showScenarioSelect(),
    });
    this.shipListView = createShipListView({
      onSelectShip: (shipId) => {
        this.emit({ type: 'selectShip', shipId });
      },
    });
    this.overlay = createOverlayView();
    this.hudChromeView = createHUDChromeView({
      queueLayoutSync: () => this.queueLayoutSync(),
      showPhaseAlert: (phase, isMyTurn) => {
        this.overlay.showPhaseAlert(phase, isMyTurn);
      },
      onStatusText: (text) => {
        this.log.setStatusText(text);
      },
    });
    this.scope.add(() => {
      this.fleetBuildingView.dispose();
      this.log.dispose();
      this.hudChromeView.dispose();
      this.lobbyView.dispose();
      this.overlay.dispose();
      this.shipListView.dispose();
    });

    this.mobileQuery = window.matchMedia('(max-width: 760px)');
    this.isMobile = this.mobileQuery.matches;
    this.hudChromeView.setMobile(this.isMobile);
    this.log.setMobile(this.isMobile, this.hudEl.style.display !== 'none');

    withScope(this.scope, () => {
      listen(this.mobileQuery, 'change', (e) => {
        const matches = (e as MediaQueryListEvent).matches;
        this.isMobile = matches;
        this.hudChromeView.setMobile(matches);
        this.log.setMobile(matches, this.hudEl.style.display !== 'none');
      });

      listen(window, 'resize', this.handleViewportResize);

      if (window.visualViewport) {
        listen(window.visualViewport, 'resize', this.handleViewportResize);
      }

      for (const binding of STATIC_BUTTON_BINDINGS) {
        listen(byId(binding.id), 'click', () => {
          this.emit(binding.event);
        });
      }
    });
  }

  private emit(event: UIEvent) {
    this.onEvent?.(event);
  }

  private applyScreenVisibility(mode: UIScreenMode) {
    const v = buildScreenVisibility(mode);

    visible(this.menuEl, v.menu !== 'none', v.menu);
    visible(this.scenarioEl, v.scenario !== 'none', v.scenario);
    visible(this.waitingEl, v.waiting !== 'none', v.waiting);
    visible(this.hudEl, v.hud !== 'none', v.hud);
    visible(this.gameOverEl, v.gameOver !== 'none', v.gameOver);
    visible(this.shipListEl, v.shipList !== 'none', v.shipList);
    visible(this.fleetBuildingEl, v.fleetBuilding !== 'none', v.fleetBuilding);
    this.log.applyScreenVisibility(mode);

    visible(byId('helpBtn'), v.helpBtn !== 'none', v.helpBtn);
    visible(byId('soundBtn'), v.soundBtn !== 'none', v.soundBtn);
    visible(byId('helpOverlay'), v.helpOverlay !== 'none', v.helpOverlay);
  }

  hideAll() {
    this.applyScreenVisibility('hidden');
    this.log.resetVisibilityState();
    this.resetLayoutMetrics();
  }

  setPlayerId(id: number) {
    this.log.setPlayerId(id);
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
    this.log.showHUD();
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

  updateShipList(
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ) {
    this.shipListView.update(ships, selectedId, burns);
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

  showAttackButton(isVisible: boolean) {
    this.hudChromeView.showAttackButton(isVisible);
  }

  showFireButton(isVisible: boolean, count: number) {
    this.hudChromeView.showFireButton(isVisible, count);
  }

  showMovementStatus() {
    this.hudChromeView.showMovementStatus();
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

  dispose() {
    this.resetLayoutMetrics();
    this.scope.dispose();
  }
}
