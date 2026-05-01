// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { applyUIVisibility } from './visibility';

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
    document.body.innerHTML = '';
  });

  it('only shows the sound button in the game HUD', () => {
    const elements = installFixture();
    const soundBtn = document.getElementById('soundBtn') as HTMLElement;

    applyUIVisibility(elements, 'menu');
    expect(soundBtn.hasAttribute('hidden')).toBe(true);
    expect(document.body.classList.contains('ui-mode-menu')).toBe(true);

    applyUIVisibility(elements, 'hud');
    expect(soundBtn.hasAttribute('hidden')).toBe(false);
    expect(soundBtn.style.display).toBe('flex');
    expect(document.body.classList.contains('ui-mode-menu')).toBe(false);
  });
});
