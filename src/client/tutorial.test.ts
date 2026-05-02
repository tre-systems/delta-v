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
    localStorage.clear();
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

  it('completes after the core movement tips without requiring ordnance or combat phases', () => {
    const events: Array<[string, Record<string, unknown> | undefined]> = [];
    const tutorial = createTutorial();
    tutorial.onTelemetry = (event, props) => events.push([event, props]);

    tutorial.onPhaseChange('astrogation', 1);
    document.getElementById('tutorialNextBtn')?.click();
    tutorial.onPhaseChange('astrogation', 1);
    document.getElementById('tutorialNextBtn')?.click();
    tutorial.onPhaseChange('astrogation', 2);
    document.getElementById('tutorialNextBtn')?.click();

    expect(events.map(([event]) => event)).not.toContain('tutorial_completed');

    tutorial.onPhaseChange('astrogation', 3);
    document.getElementById('tutorialNextBtn')?.click();

    expect(events.map(([event]) => event)).toContain('tutorial_completed');
    expect(localStorage.getItem('deltav_tutorial_done')).toBe('1');
    expect(tutorial.isActive()).toBe(false);

    tutorial.dispose();
  });

  it('still shows phase-specific ordnance and combat tips when those phases are reached', () => {
    const tutorial = createTutorial();

    tutorial.onPhaseChange('astrogation', 1);
    document.getElementById('tutorialNextBtn')?.click();
    tutorial.onPhaseChange('astrogation', 1);
    document.getElementById('tutorialNextBtn')?.click();

    tutorial.onPhaseChange('ordnance', 1);
    expect(document.getElementById('tutorialTipText')?.textContent).toContain(
      'Ordnance phase:',
    );
    document.getElementById('tutorialNextBtn')?.click();

    tutorial.onPhaseChange('combat', 1);
    expect(document.getElementById('tutorialTipText')?.textContent).toContain(
      'Combat phase:',
    );
    document.getElementById('tutorialNextBtn')?.click();

    expect(localStorage.getItem('deltav_tutorial_done')).toBeNull();

    tutorial.dispose();
  });
});
