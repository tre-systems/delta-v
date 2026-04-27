// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playAmbientDrone, stopAmbientDrone } from '../audio';
import { applyUIVisibility } from './visibility';

vi.mock('../audio', () => ({
  playAmbientDrone: vi.fn(),
  stopAmbientDrone: vi.fn(),
}));

const installFixture = () => {
  document.body.innerHTML = `
    <div id="menu"></div>
    <div id="scenarioSelect"></div>
    <div id="waiting"></div>
    <div id="hud"></div>
    <div id="gameOver"></div>
    <div id="shipList"></div>
    <div id="fleetBuilding"></div>
    <button id="helpBtn"></button>
    <button id="soundBtn"></button>
    <button id="exitGameBtn"></button>
    <div id="helpOverlay"></div>
  `;
  return {
    menuEl: document.getElementById('menu') as HTMLElement,
    scenarioEl: document.getElementById('scenarioSelect') as HTMLElement,
    waitingEl: document.getElementById('waiting') as HTMLElement,
    hudEl: document.getElementById('hud') as HTMLElement,
    gameOverEl: document.getElementById('gameOver') as HTMLElement,
    shipListEl: document.getElementById('shipList') as HTMLElement,
    fleetBuildingEl: document.getElementById('fleetBuilding') as HTMLElement,
  };
};

describe('applyUIVisibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('arms the ambient drone only on the home menu', () => {
    const elements = installFixture();

    applyUIVisibility(elements, 'menu');
    expect(playAmbientDrone).toHaveBeenCalledOnce();
    expect(stopAmbientDrone).not.toHaveBeenCalled();

    applyUIVisibility(elements, 'hud');
    expect(stopAmbientDrone).toHaveBeenCalledOnce();
  });
});
