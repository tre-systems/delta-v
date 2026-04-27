import { playAmbientDrone, stopAmbientDrone } from '../audio';
import { byId, visible } from '../dom';
import { buildScreenVisibility, type UIScreenMode } from './screens';

type UIVisibilityElements = {
  menuEl: HTMLElement;
  scenarioEl: HTMLElement;
  waitingEl: HTMLElement;
  hudEl: HTMLElement;
  gameOverEl: HTMLElement;
  shipListEl: HTMLElement;
  fleetBuildingEl: HTMLElement;
};

const OVERLAY_CHROME_MODES = new Set<UIScreenMode>([
  'menu',
  'scenario',
  'waiting',
  'fleetBuilding',
]);

export const applyUIVisibility = (
  elements: UIVisibilityElements,
  mode: UIScreenMode,
): void => {
  const v = buildScreenVisibility(mode);

  document.body.classList.toggle('ui-mode-menu', mode === 'menu');
  document.body.classList.toggle(
    'ui-mode-overlay',
    OVERLAY_CHROME_MODES.has(mode),
  );
  if (mode === 'menu') {
    playAmbientDrone();
  } else {
    stopAmbientDrone();
  }

  visible(elements.menuEl, v.menu !== 'none', v.menu);
  visible(elements.scenarioEl, v.scenario !== 'none', v.scenario);
  visible(elements.waitingEl, v.waiting !== 'none', v.waiting);
  visible(elements.hudEl, v.hud !== 'none', v.hud);
  visible(elements.gameOverEl, v.gameOver !== 'none', v.gameOver);
  visible(elements.shipListEl, v.shipList !== 'none', v.shipList);
  visible(
    elements.fleetBuildingEl,
    v.fleetBuilding !== 'none',
    v.fleetBuilding,
  );

  visible(byId('helpBtn'), v.helpBtn !== 'none', v.helpBtn);
  visible(byId('soundBtn'), v.soundBtn !== 'none', v.soundBtn);
  visible(byId('exitGameBtn'), v.exitGameBtn !== 'none', v.exitGameBtn);
  visible(byId('helpOverlay'), v.helpOverlay !== 'none', v.helpOverlay);
};
