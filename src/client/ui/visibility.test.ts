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
    <div id="hudBoardSummary" role="status"></div>
    <div id="phaseAlert" class="active" role="status" aria-hidden="false"></div>
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

  it('removes stale HUD announcements outside the game screen', () => {
    const elements = installFixture();
    const summary = document.getElementById('hudBoardSummary') as HTMLElement;
    const phaseAlert = document.getElementById('phaseAlert') as HTMLElement;

    applyUIVisibility(elements, 'scenario');

    expect(summary.getAttribute('aria-hidden')).toBe('true');
    expect(phaseAlert.getAttribute('aria-hidden')).toBe('true');
    expect(phaseAlert.classList.contains('active')).toBe(false);

    applyUIVisibility(elements, 'hud');
    expect(summary.getAttribute('aria-hidden')).toBe('false');
  });
});
