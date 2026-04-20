import { beforeEach, describe, expect, it } from 'vitest';

import { createTutorial } from './tutorial';

const renderTutorialDom = () => {
  document.body.innerHTML = `
    <div id="tutorialTip" style="display:none">
      <div id="tutorialTipText"></div>
      <div id="tutorialProgress"></div>
      <button id="tutorialOpenHelpBtn" type="button">Help</button>
      <button id="tutorialNextBtn" type="button">Next</button>
      <button id="tutorialSkipBtn" type="button">Skip</button>
    </div>
  `;
};

describe('tutorial', () => {
  beforeEach(() => {
    renderTutorialDom();
  });

  it('uses scenario-neutral welcome copy for the first astrogation tip', () => {
    const tutorial = createTutorial();

    tutorial.onPhaseChange('astrogation', 1);

    expect(document.getElementById('tutorialTipText')?.textContent).toBe(
      'Welcome! Astrogation is about burns and drift — pick a ship and choose a burn direction so it does not coast the wrong way. (You keep velocity between turns; details live in Help.)',
    );

    tutorial.dispose();
  });
});
