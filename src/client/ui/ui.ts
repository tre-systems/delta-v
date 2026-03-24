import type { Ship } from '../../shared/types/domain';
import { byId } from '../dom';
import { createDisposalScope, withScope } from '../reactive';
import { bindStaticButtonEvents } from './button-events';
import type { UIEvent } from './events';
import { createFleetBuildingView } from './fleet-building-view';
import { createGameLogView } from './game-log-view';
import type { HUDInput } from './hud';
import { createHUDChromeView } from './hud-chrome-view';
import { applyHudLayoutMetrics, clearHudLayoutMetrics } from './layout-metrics';
import { createLobbyView, type LobbyView } from './lobby-view';
import { createOverlayView } from './overlay-view';
import { createScreenActions } from './screen-actions';
import type { UIScreenMode } from './screens';
import { createShipListView } from './ship-list-view';
import { bindViewportEvents } from './viewport-events';
import { applyUIVisibility } from './visibility';

export const createUIManager = () => {
  const scope = createDisposalScope();
  const menuEl = byId('menu');
  const scenarioEl = byId('scenarioSelect');
  const waitingEl = byId('waiting');
  const hudEl = byId('hud');
  const topBarEl = byId('topBar');
  const bottomBarEl = byId('bottomBar');
  const gameOverEl = byId('gameOver');
  const shipListEl = byId('shipList');
  const fleetBuildingEl = byId('fleetBuilding');
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  let isMobile = mobileQuery.matches;
  let layoutSyncFrame: number | null = null;

  let onEvent: ((event: UIEvent) => void) | null = null;

  const emit = (event: UIEvent) => {
    onEvent?.(event);
  };

  const resetLayoutMetrics = () => {
    if (layoutSyncFrame !== null) {
      window.cancelAnimationFrame(layoutSyncFrame);
      layoutSyncFrame = null;
    }

    clearHudLayoutMetrics();
  };

  const syncLayoutMetrics = () => {
    if (hudEl.style.display === 'none') {
      resetLayoutMetrics();

      return;
    }

    applyHudLayoutMetrics(
      window.innerHeight,
      topBarEl.getBoundingClientRect(),
      bottomBarEl.getBoundingClientRect(),
    );
  };

  const queueLayoutSync = () => {
    if (layoutSyncFrame !== null) return;

    layoutSyncFrame = window.requestAnimationFrame(() => {
      layoutSyncFrame = null;
      syncLayoutMetrics();
    });
  };

  const handleViewportResize = () => {
    queueLayoutSync();
  };

  const fleetBuildingView = createFleetBuildingView({
    onFleetReady: (purchases) => {
      emit({ type: 'fleetReady', purchases });
    },
  });
  const log = createGameLogView({
    onChat: (text) => {
      emit({ type: 'chat', text });
    },
  });

  const applyScreenVisibility = (mode: UIScreenMode) => {
    applyUIVisibility(
      {
        menuEl,
        scenarioEl,
        waitingEl,
        hudEl,
        gameOverEl,
        shipListEl,
        fleetBuildingEl,
      },
      mode,
    );
    log.applyScreenVisibility(mode);
  };

  const hideAll = () => {
    applyScreenVisibility('hidden');
    log.resetVisibilityState();
    resetLayoutMetrics();
  };

  let lobbyView: LobbyView;

  lobbyView = createLobbyView({
    emit,
    showMenu: () => showMenu(),
    showScenarioSelect: () => showScenarioSelect(),
  });

  const shipListView = createShipListView({
    onSelectShip: (shipId) => {
      emit({ type: 'selectShip', shipId });
    },
  });
  const overlay = createOverlayView();
  const hudChromeView = createHUDChromeView({
    queueLayoutSync,
    showPhaseAlert: (phase, isMyTurn) => {
      overlay.showPhaseAlert(phase, isMyTurn);
    },
    onStatusText: (text) => {
      log.setStatusText(text);
    },
  });

  scope.add(() => {
    fleetBuildingView.dispose();
    log.dispose();
    hudChromeView.dispose();
    lobbyView.dispose();
    overlay.dispose();
    shipListView.dispose();
  });

  hudChromeView.setMobile(isMobile);
  log.setMobile(isMobile, hudEl.style.display !== 'none');

  withScope(scope, () => {
    bindViewportEvents({
      mobileQuery,
      onMobileChange: (matches) => {
        isMobile = matches;
        hudChromeView.setMobile(matches);
        log.setMobile(matches, hudEl.style.display !== 'none');
      },
      onViewportResize: handleViewportResize,
      trackDispose: (dispose) => scope.add(dispose),
    });

    bindStaticButtonEvents(emit, (dispose) => scope.add(dispose));
  });

  const {
    showMenu,
    showScenarioSelect,
    showWaiting,
    showConnecting,
    showHUD,
    showFleetBuilding,
    showFleetWaiting,
  } = createScreenActions({
    hideAll,
    applyScreenVisibility,
    showMenuChrome: () => lobbyView.onMenuShown(),
    showWaitingLobby: (code) => lobbyView.showWaiting(code),
    showConnectingLobby: () => lobbyView.showConnecting(),
    showHudLog: () => log.showHUD(),
    queueLayoutSync,
    showFleetBuildingView: (state, playerId) =>
      fleetBuildingView.show(state, playerId),
    showFleetWaitingView: () => fleetBuildingView.showWaiting(),
  });

  return {
    get onEvent() {
      return onEvent;
    },
    set onEvent(handler: ((event: UIEvent) => void) | null) {
      onEvent = handler;
    },
    log,
    overlay,
    hideAll,
    setPlayerId(id: number) {
      log.setPlayerId(id);
    },
    showMenu,
    setMenuLoading(loading: boolean) {
      lobbyView.setMenuLoading(loading);
    },
    showScenarioSelect,
    showWaiting,
    showConnecting,
    showHUD,
    showFleetBuilding,
    showFleetWaiting,
    updateHUD(input: Omit<HUDInput, 'isMobile'>) {
      hudChromeView.update(input);
    },
    updateLatency(latencyMs: number | null) {
      hudChromeView.updateLatency(latencyMs);
    },
    updateFleetStatus(status: string) {
      hudChromeView.updateFleetStatus(status);
    },
    updateShipList(
      ships: Ship[],
      selectedId: string | null,
      burns: Map<string, number | null>,
    ) {
      shipListView.update(ships, selectedId, burns);
    },
    toggleHelpOverlay() {
      hudChromeView.toggleHelpOverlay();
    },
    updateSoundButton(muted: boolean) {
      hudChromeView.updateSoundButton(muted);
    },
    setTurnTimer(text: string, className: string) {
      hudChromeView.setTurnTimer(text, className);
    },
    clearTurnTimer() {
      hudChromeView.clearTurnTimer();
    },
    showAttackButton(isVisible: boolean) {
      hudChromeView.showAttackButton(isVisible);
    },
    showFireButton(isVisible: boolean, count: number) {
      hudChromeView.showFireButton(isVisible, count);
    },
    showMovementStatus() {
      hudChromeView.showMovementStatus();
    },
    dispose() {
      resetLayoutMetrics();
      scope.dispose();
    },
  };
};

export type UIManager = ReturnType<typeof createUIManager>;
