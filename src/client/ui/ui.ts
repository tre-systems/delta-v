import { createDisposalScope, withScope } from '../reactive';
import { bindStaticButtonEvents } from './button-events';
import { composeDisposers } from './dispose-group';
import { getUIElements } from './elements';
import { createUIEventBridge } from './event-bridge';
import type { UIEvent } from './events';
import { createFleetBuildingView } from './fleet-building-view';
import { createGameLogView } from './game-log-view';
import { createHudActions } from './hud-actions';
import { createHUDChromeView } from './hud-chrome-view';
import { applyHudLayoutMetrics, clearHudLayoutMetrics } from './layout-metrics';
import { createLayoutSync } from './layout-sync';
import { createLobbyView, type LobbyView } from './lobby-view';
import { bindMobileSync } from './mobile-sync';
import { createOverlayView } from './overlay-view';
import { createScreenActions } from './screen-actions';
import type { UIScreenMode } from './screens';
import { createSessionActions } from './session-actions';
import { createShipListView } from './ship-list-view';
import { bindViewportEvents } from './viewport-events';
import { applyUIVisibility } from './visibility';

export const createUIManager = () => {
  const scope = createDisposalScope();
  const {
    menuEl,
    scenarioEl,
    waitingEl,
    hudEl,
    topBarEl,
    bottomBarEl,
    gameOverEl,
    shipListEl,
    fleetBuildingEl,
  } = getUIElements();
  const mobileQuery = window.matchMedia('(max-width: 760px)');

  const eventBridge = createUIEventBridge();
  const emit = (event: UIEvent) => eventBridge.emit(event);

  const { reset: resetLayoutMetrics, queue: queueLayoutSync } =
    createLayoutSync({
      isHudVisible: () => hudEl.style.display !== 'none',
      applyMetrics: () =>
        applyHudLayoutMetrics(
          window.innerHeight,
          topBarEl.getBoundingClientRect(),
          bottomBarEl.getBoundingClientRect(),
        ),
      clearMetrics: () => clearHudLayoutMetrics(),
    });

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

  const overlay = createOverlayView();

  let lobbyView: LobbyView;

  lobbyView = createLobbyView({
    emit,
    showMenu: () => showMenu(),
    showScenarioSelect: () => showScenarioSelect(),
    showToast: (message, type) => overlay.showToast(message, type),
  });

  const shipListView = createShipListView({
    onSelectShip: (shipId) => {
      emit({ type: 'selectShip', shipId });
    },
  });
  const hudChromeView = createHUDChromeView({
    queueLayoutSync,
    showPhaseAlert: (phase, isMyTurn) => {
      overlay.showPhaseAlert(phase, isMyTurn);
    },
    onStatusText: (text) => {
      log.setStatusText(text);
    },
  });

  scope.add(
    composeDisposers(
      () => fleetBuildingView.dispose(),
      () => log.dispose(),
      () => hudChromeView.dispose(),
      () => lobbyView.dispose(),
      () => overlay.dispose(),
      () => shipListView.dispose(),
    ),
  );

  bindMobileSync({
    initialMatches: mobileQuery.matches,
    setHudMobile: (matches) => hudChromeView.setMobile(matches),
    setLogMobile: (matches) =>
      log.setMobile(matches, hudEl.style.display !== 'none'),
    bindViewport: (onMobileChange, onResize) => {
      withScope(scope, () => {
        bindViewportEvents({
          mobileQuery,
          onMobileChange,
          onViewportResize: () => {
            queueLayoutSync();
            onResize();
          },
          trackDispose: (dispose) => scope.add(dispose),
        });
      });
    },
  });

  withScope(scope, () => {
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

  const hudActions = createHudActions({
    update: (input) => hudChromeView.update(input),
    updateLatency: (latencyMs) => hudChromeView.updateLatency(latencyMs),
    updateFleetStatus: (status) => hudChromeView.updateFleetStatus(status),
    updateShipList: (ships, selectedId, burns) =>
      shipListView.update(ships, selectedId, burns),
    toggleHelpOverlay: () => hudChromeView.toggleHelpOverlay(),
    updateSoundButton: (muted) => hudChromeView.updateSoundButton(muted),
    setTurnTimer: (text, className) =>
      hudChromeView.setTurnTimer(text, className),
    clearTurnTimer: () => hudChromeView.clearTurnTimer(),
    showAttackButton: (isVisible) => hudChromeView.showAttackButton(isVisible),
    showFireButton: (isVisible, count) =>
      hudChromeView.showFireButton(isVisible, count),
    showMovementStatus: () => hudChromeView.showMovementStatus(),
  });
  const sessionActions = createSessionActions({
    setPlayerId: (id) => log.setPlayerId(id),
    setMenuLoading: (loading) => lobbyView.setMenuLoading(loading),
  });

  return {
    get onEvent() {
      return eventBridge.getOnEvent();
    },
    set onEvent(handler: ((event: UIEvent) => void) | null) {
      eventBridge.setOnEvent(handler);
    },
    log,
    overlay,
    hideAll,
    ...sessionActions,
    showMenu,
    showScenarioSelect,
    showWaiting,
    showConnecting,
    showHUD,
    showFleetBuilding,
    showFleetWaiting,
    ...hudActions,
    dispose() {
      resetLayoutMetrics();
      scope.dispose();
    },
  };
};

export type UIManager = ReturnType<typeof createUIManager>;
