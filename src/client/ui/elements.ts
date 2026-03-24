import { byId } from '../dom';

export type UIElements = {
  menuEl: HTMLElement;
  scenarioEl: HTMLElement;
  waitingEl: HTMLElement;
  hudEl: HTMLElement;
  topBarEl: HTMLElement;
  bottomBarEl: HTMLElement;
  gameOverEl: HTMLElement;
  shipListEl: HTMLElement;
  fleetBuildingEl: HTMLElement;
};

export const getUIElements = (): UIElements => {
  return {
    menuEl: byId('menu'),
    scenarioEl: byId('scenarioSelect'),
    waitingEl: byId('waiting'),
    hudEl: byId('hud'),
    topBarEl: byId('topBar'),
    bottomBarEl: byId('bottomBar'),
    gameOverEl: byId('gameOver'),
    shipListEl: byId('shipList'),
    fleetBuildingEl: byId('fleetBuilding'),
  };
};
