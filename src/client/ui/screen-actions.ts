import type { GameState } from '../../shared/types/domain';

type ScreenMode = 'menu' | 'scenario' | 'waiting' | 'hud' | 'fleetBuilding';

type CreateScreenActionsInput = {
  hideAll: () => void;
  applyScreenVisibility: (mode: ScreenMode) => void;
  showMenuChrome: () => void;
  showWaitingLobby: (code: string) => void;
  showConnectingLobby: () => void;
  showHudLog: () => void;
  queueLayoutSync: () => void;
  showFleetBuildingView: (state: GameState, playerId: number) => void;
  showFleetWaitingView: () => void;
};

export const createScreenActions = ({
  hideAll,
  applyScreenVisibility,
  showMenuChrome,
  showWaitingLobby,
  showConnectingLobby,
  showHudLog,
  queueLayoutSync,
  showFleetBuildingView,
  showFleetWaitingView,
}: CreateScreenActionsInput) => {
  const showMenu = () => {
    hideAll();
    applyScreenVisibility('menu');
    showMenuChrome();
  };

  const showScenarioSelect = () => {
    hideAll();
    applyScreenVisibility('scenario');
  };

  const showWaiting = (code: string) => {
    hideAll();
    applyScreenVisibility('waiting');
    showWaitingLobby(code);
  };

  const showConnecting = () => {
    hideAll();
    applyScreenVisibility('waiting');
    showConnectingLobby();
  };

  const showHUD = () => {
    hideAll();
    applyScreenVisibility('hud');
    showHudLog();
    queueLayoutSync();
  };

  const showFleetBuilding = (state: GameState, playerId: number) => {
    hideAll();
    applyScreenVisibility('fleetBuilding');
    showFleetBuildingView(state, playerId);
  };

  const showFleetWaiting = () => {
    showFleetWaitingView();
  };

  return {
    showMenu,
    showScenarioSelect,
    showWaiting,
    showConnecting,
    showHUD,
    showFleetBuilding,
    showFleetWaiting,
  };
};
