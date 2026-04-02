import type { GameState, PlayerId } from '../../shared/types/domain';
import type { InteractionState } from '../game/interaction-fsm';
import type { ReadonlySignal } from '../reactive';
import { createDisposalScope, effect, signal, withScope } from '../reactive';
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
import { createOverlayStateStore } from './overlay-state';
import { createOverlayView } from './overlay-view';
import { mapInteractionModeToUIScreenMode, type UIScreenMode } from './screens';
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
  const screenModeSignal = signal<UIScreenMode>('hidden');
  const interactionSignal = signal<ReadonlySignal<InteractionState> | null>(
    null,
  );

  const { reset: resetLayoutMetrics, queue: queueLayoutSync } =
    createLayoutSync({
      isHudVisible: () => screenModeSignal.peek() === 'hud',
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

  const overlayState = createOverlayStateStore();
  const overlay = Object.assign(overlayState, createOverlayView(overlayState));

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
      log.setMobile(matches, screenModeSignal.peek() === 'hud'),
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

  withScope(scope, () => {
    effect(() => {
      const mode = screenModeSignal.value;
      const interaction = interactionSignal.value?.value;

      const effectiveMode = interaction
        ? mapInteractionModeToUIScreenMode(interaction.mode, mode)
        : mode;

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
        effectiveMode,
      );
      log.setScreenMode(effectiveMode);

      if (mode === 'hud') {
        queueLayoutSync();
      } else {
        resetLayoutMetrics();
      }
    });
  });

  const hideAll = () => {
    screenModeSignal.value = 'hidden';
  };

  const showMenu = () => {
    lobbyView.onMenuShown();
    screenModeSignal.value = 'menu';
  };

  const showScenarioSelect = () => {
    screenModeSignal.value = 'scenario';
  };

  const showWaiting = () => {
    screenModeSignal.value = 'waiting';
  };

  const showConnecting = () => {
    screenModeSignal.value = 'waiting';
  };

  const showHUD = () => {
    screenModeSignal.value = 'hud';
  };

  const showFleetBuilding = (state: GameState, playerId: PlayerId) => {
    fleetBuildingView.show(state, playerId);
    screenModeSignal.value = 'fleetBuilding';
  };

  const showFleetWaiting = () => {
    fleetBuildingView.showWaiting();
  };

  const hudActions = createHudActions({
    update: (input) => hudChromeView.update(input),
    updateLatency: (latencyMs) => hudChromeView.updateLatency(latencyMs),
    updateFleetStatus: (status) => hudChromeView.updateFleetStatus(status),
    updateShipList: (ships, selectedId, burns) =>
      shipListView.update(ships, selectedId, burns),
    toggleHelpOverlay: () => hudChromeView.toggleHelpOverlay(),
    updateSoundButton: (muted) => hudChromeView.updateSoundButton(muted),
    showAttackButton: (isVisible) => hudChromeView.showAttackButton(isVisible),
    showFireButton: (isVisible, count) =>
      hudChromeView.showFireButton(isVisible, count),
  });
  const sessionActions = createSessionActions({
    setPlayerId: (id) => log.setPlayerId(id),
    setMenuLoading: (loading) => lobbyView.setMenuLoading(loading),
    setWaitingState: (code, connecting) =>
      lobbyView.setWaitingState(code, connecting),
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
    bindTurnTimerSignal: (
      timerSignal: Parameters<typeof hudChromeView.bindTurnTimerSignal>[0],
    ) => hudChromeView.bindTurnTimerSignal(timerSignal),
    bindInteractionSignal: (signal: ReadonlySignal<InteractionState>) => {
      interactionSignal.value = signal;
    },
    ...hudActions,
    dispose() {
      resetLayoutMetrics();
      scope.dispose();
    },
  };
};

export type UIManager = ReturnType<typeof createUIManager>;
