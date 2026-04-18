import type { GameState, PlayerId } from '../../shared/types/domain';
import {
  deriveInteractionMode,
  type InteractionMode,
} from '../game/interaction-fsm';
import type { ClientState } from '../game/phase';
import type { PlayerProfileService } from '../game/player-profile-service';
import type { ReadonlySignal } from '../reactive';
import { createDisposalScope, effect, signal, withScope } from '../reactive';
import { MOBILE_BREAKPOINT_PX } from '../ui-breakpoints';
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
import { mapInteractionModeToUIScreenMode } from './screens';
import { createSessionActions } from './session-actions';
import { createShipListView } from './ship-list-view';
import { bindViewportEvents } from './viewport-events';
import { applyUIVisibility } from './visibility';

const HUD_MODES: ReadonlySet<InteractionMode> = new Set<InteractionMode>([
  'astrogation',
  'ordnance',
  'logistics',
  'combat',
  'animating',
  'opponentTurn',
  'gameOver',
]);

const isHudMode = (mode: InteractionMode): boolean => HUD_MODES.has(mode);

export interface UIManagerDeps {
  playerProfile: Pick<PlayerProfileService, 'getProfile' | 'setUsername'>;
}

export const createUIManager = (deps: UIManagerDeps) => {
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
  const mobileQuery = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT_PX}px)`,
  );

  const eventBridge = createUIEventBridge();
  const emit = (event: UIEvent) => eventBridge.emit(event);
  const scenarioActiveSignal = signal(false);
  const clientStateSignal = signal<ReadonlySignal<ClientState> | null>(null);

  const peekInteractionMode = (): InteractionMode | null => {
    const stateSignal = clientStateSignal.peek();
    return stateSignal ? deriveInteractionMode(stateSignal.peek()) : null;
  };

  const { reset: resetLayoutMetrics, queue: queueLayoutSync } =
    createLayoutSync({
      isHudVisible: () => {
        const mode = peekInteractionMode();
        return mode !== null && isHudMode(mode);
      },
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

  const shipListView = createShipListView({
    onSelectShip: (shipId) => {
      emit({ type: 'selectShip', shipId });
    },
  });
  const hudChromeView = createHUDChromeView({
    queueLayoutSync,
    onStatusText: (text) => {
      log.setStatusText(text);
    },
  });

  lobbyView = createLobbyView({
    emit,
    showMenu: () => showMenu(),
    showScenarioSelect: () => showScenarioSelect(),
    showToast: (message, type) => overlay.showToast(message, type),
    toggleHelpOverlay: () => hudChromeView.toggleHelpOverlay(),
    getPlayerName: () => deps.playerProfile.getProfile().username,
    setPlayerName: (name) => deps.playerProfile.setUsername(name).username,
    getPlayerKey: () => deps.playerProfile.getProfile().playerKey,
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
    setShipListMobile: (matches) => shipListView.setMobile(matches),
    setLogMobile: (matches, viewportWidth) => {
      const mode = peekInteractionMode();
      log.setMobile(matches, mode !== null && isHudMode(mode), viewportWidth);
    },
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
      const clientState = clientStateSignal.value?.value;
      const interactionMode = clientState
        ? deriveInteractionMode(clientState)
        : null;
      const scenarioActive = scenarioActiveSignal.value;

      // When the FSM leaves 'menu' (e.g. connecting, waiting), clear
      // the scenario sub-state so returning to 'menu' shows the main
      // menu rather than the stale scenario-select screen.
      if (interactionMode && interactionMode !== 'menu' && scenarioActive) {
        scenarioActiveSignal.value = false;
      }

      const effectiveMode = interactionMode
        ? mapInteractionModeToUIScreenMode(interactionMode, scenarioActive)
        : 'hidden';

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

      if (interactionMode && isHudMode(interactionMode)) {
        queueLayoutSync();
      } else {
        resetLayoutMetrics();
      }
    });
  });

  const showMenu = () => {
    lobbyView.onMenuShown();
    scenarioActiveSignal.value = false;
  };

  const showScenarioSelect = () => {
    scenarioActiveSignal.value = true;
  };

  const showFleetBuilding = (state: GameState, playerId: PlayerId) => {
    fleetBuildingView.show(state, playerId);
  };

  const showFleetWaiting = () => {
    fleetBuildingView.showWaiting();
  };

  const hudActions = createHudActions({
    update: (input) => hudChromeView.update(input),
    updateLatency: (latencyMs) => hudChromeView.updateLatency(latencyMs),
    updateFleetStatus: (status, ariaLabel) =>
      hudChromeView.updateFleetStatus(status, ariaLabel),
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
    setMenuLoading: (loading, kind) => lobbyView.setMenuLoading(loading, kind),
    setWaitingState: (state) => lobbyView.setWaitingState(state),
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
    ...sessionActions,
    showMenu,
    showScenarioSelect,
    showFleetBuilding,
    showFleetWaiting,
    selectCodeInput: () => lobbyView.selectCodeInput(),
    bindTurnTimerSignal: (
      timerSignal: Parameters<typeof hudChromeView.bindTurnTimerSignal>[0],
    ) => hudChromeView.bindTurnTimerSignal(timerSignal),
    bindClientStateSignal: (signal: ReadonlySignal<ClientState>) => {
      clientStateSignal.value = signal;
    },
    ...hudActions,
    dispose() {
      resetLayoutMetrics();
      scope.dispose();
    },
  };
};

export type UIManager = ReturnType<typeof createUIManager>;
