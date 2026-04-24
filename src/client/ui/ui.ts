import type { GameState, PlayerId } from '../../shared/types/domain';
import { byId, listen } from '../dom';
import {
  deriveInteractionMode,
  type InteractionMode,
} from '../game/interaction-fsm';
import type { ClientState } from '../game/phase';
import type { PlayerProfileService } from '../game/player-profile-service';
import type { SessionTokenService } from '../game/session-token-service';
import type { ReadonlySignal } from '../reactive';
import { createDisposalScope, effect, signal, withScope } from '../reactive';
import { rotateAnonId } from '../telemetry';
import { MOBILE_BREAKPOINT_PX } from '../ui-breakpoints';
import { bindStaticButtonEvents } from './button-events';
import { composeDisposers } from './dispose-group';
import type { UIEvent } from './events';
import { createFleetBuildingView } from './fleet-building-view';
import { createGameLogView } from './game-log-view';
import { createHUDChromeView } from './hud-chrome-view';
import { applyHudLayoutMetrics, clearHudLayoutMetrics } from './layout-metrics';
import { createLayoutSync } from './layout-sync';
import { createLobbyView, type LobbyView } from './lobby-view';
import { createOverlayStateStore } from './overlay-state';
import { createOverlayView } from './overlay-view';
import { mapInteractionModeToUIScreenMode } from './screens';
import { createShipListView } from './ship-list-view';
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
  playerProfile: Pick<
    PlayerProfileService,
    'getProfile' | 'setUsername' | 'resetProfile'
  >;
  sessionTokens: Pick<SessionTokenService, 'clearAllStoredPlayerTokens'>;
  /** Reactive online/offline signal; when omitted the lobby treats the session as always-online. */
  onlineSignal?: { readonly value: boolean };
}

export const createUIManager = (deps: UIManagerDeps) => {
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
  const mobileQuery = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT_PX}px)`,
  );

  let onEvent: ((event: UIEvent) => void) | null = null;
  const emit = (event: UIEvent) => {
    onEvent?.(event);
  };
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
    resetPlayerIdentity: () => {
      deps.sessionTokens.clearAllStoredPlayerTokens();
      rotateAnonId();
      return deps.playerProfile.resetProfile();
    },
    onlineSignal: deps.onlineSignal,
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

  let isMobile = mobileQuery.matches;

  const peekHudVisible = () => {
    const mode = peekInteractionMode();
    return mode !== null && isHudMode(mode);
  };

  const applyMobileState = (matches: boolean) => {
    isMobile = matches;
    hudChromeView.setMobile(matches);
    shipListView.setMobile(matches);
    log.setMobile(matches, peekHudVisible(), window.innerWidth);
  };

  const onViewportResize = () => {
    queueLayoutSync();
    if (isMobile) {
      log.setMobile(true, peekHudVisible(), window.innerWidth);
    }
  };

  applyMobileState(isMobile);

  withScope(scope, () => {
    listen(mobileQuery, 'change', (event) => {
      applyMobileState((event as MediaQueryListEvent).matches);
    });
    listen(window, 'resize', onViewportResize);
    if (window.visualViewport) {
      listen(window.visualViewport, 'resize', onViewportResize);
    }
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

  return {
    get onEvent() {
      return onEvent;
    },
    set onEvent(handler: ((event: UIEvent) => void) | null) {
      onEvent = handler;
    },
    log,
    overlay,
    setPlayerId: log.setPlayerId,
    setMenuLoading: lobbyView.setMenuLoading,
    setWaitingState: lobbyView.setWaitingState,
    showMenu,
    showScenarioSelect,
    showFleetBuilding,
    showFleetWaiting,
    selectCodeInput: lobbyView.selectCodeInput,
    bindTurnTimerSignal: hudChromeView.bindTurnTimerSignal,
    bindClientStateSignal: (signal: ReadonlySignal<ClientState>) => {
      clientStateSignal.value = signal;
    },
    updateHUD: hudChromeView.update,
    updateLatency: hudChromeView.updateLatency,
    updateFleetStatus: hudChromeView.updateFleetStatus,
    updateShipList: shipListView.update,
    toggleHelpOverlay: hudChromeView.toggleHelpOverlay,
    openHelpSection: hudChromeView.openHelpSection,
    updateSoundButton: hudChromeView.updateSoundButton,
    showAttackButton: hudChromeView.showAttackButton,
    showFireButton: hudChromeView.showFireButton,
    dispose() {
      resetLayoutMetrics();
      scope.dispose();
    },
  };
};

export type UIManager = ReturnType<typeof createUIManager>;
