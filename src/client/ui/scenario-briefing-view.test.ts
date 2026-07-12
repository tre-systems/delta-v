// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestState } from '../../shared/test-helpers';
import { createScenarioBriefingView } from './scenario-briefing-view';

describe('ScenarioBriefingView', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <canvas id="gameCanvas"></canvas>
      <div id="hud"></div>
      <div id="tutorialTip"></div>
      <div id="phaseAlert"></div>
      <div id="scenarioBriefing" hidden>
        <h2 id="scenarioBriefingTitle"></h2>
        <p id="scenarioBriefingDescription"></p>
        <strong id="scenarioBriefingObjective"></strong>
        <button id="scenarioBriefingStartBtn">Start Flight</button>
      </div>
    `;
  });

  it('makes background game guidance inert until flight starts', () => {
    const view = createScenarioBriefingView();

    view.show(createTestState({ scenario: 'duel' }), 0);

    expect(document.getElementById('hud')?.hasAttribute('inert')).toBe(true);
    expect(document.getElementById('tutorialTip')?.hasAttribute('inert')).toBe(
      true,
    );

    document.getElementById('scenarioBriefingStartBtn')?.click();

    expect(document.getElementById('hud')?.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('tutorialTip')?.hasAttribute('inert')).toBe(
      false,
    );

    view.dispose();
  });

  it('can identify a guided mission without changing the scenario state', () => {
    const view = createScenarioBriefingView();

    view.show(createTestState({ scenario: 'biplanetary' }), 0, {
      title: 'Training Flight',
      description: 'Guided Bi-Planetary practice.',
    });

    expect(document.getElementById('scenarioBriefingTitle')?.textContent).toBe(
      'Training Flight',
    );
    expect(
      document.getElementById('scenarioBriefingDescription')?.textContent,
    ).toBe('Guided Bi-Planetary practice.');

    view.dispose();
  });
});
