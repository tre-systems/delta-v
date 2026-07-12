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
    window.localStorage.clear();
    renderTutorialDom();
  });

  it('opens with one immediate, scenario-neutral instruction', () => {
    const tutorial = createTutorial();

    tutorial.onPhaseChange('astrogation', 1);

    expect(document.getElementById('tutorialTipText')?.textContent).toBe(
      'Your ship is selected. Choose a numbered burn circle to change its dashed route.',
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
    expect(window.localStorage.getItem('deltav_tutorial_done')).toBe('1');
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
      'launch ordnance',
    );
    document.getElementById('tutorialNextBtn')?.click();

    tutorial.onPhaseChange('combat', 1);
    expect(document.getElementById('tutorialTipText')?.textContent).toContain(
      'Select an enemy to see the odds.',
    );
    expect(document.getElementById('tutorialTipText')?.textContent).toContain(
      'finish combat',
    );
    document.getElementById('tutorialNextBtn')?.click();

    expect(window.localStorage.getItem('deltav_tutorial_done')).toBeNull();

    tutorial.dispose();
  });

  it('emits tutorial_started and tutorial_step_shown once for a passive player across turns', () => {
    const events: string[] = [];
    const tutorial = createTutorial();
    tutorial.onTelemetry = (event) => events.push(event);

    // A passive player never clicks "Got it": every turn re-enters
    // astrogation, the phase transition hides the tip, and onPhaseChange
    // re-picks the same first step because shownSteps never grows.
    tutorial.onPhaseChange('astrogation', 1);
    tutorial.hideTip();
    tutorial.onPhaseChange('astrogation', 2);
    tutorial.hideTip();
    tutorial.onPhaseChange('astrogation', 3);

    expect(events.filter((event) => event === 'tutorial_started')).toHaveLength(
      1,
    );
    expect(
      events.filter((event) => event === 'tutorial_step_shown'),
    ).toHaveLength(1);

    // The tip itself must still re-appear visually on every turn.
    expect(document.getElementById('tutorialTip')?.style.display).toBe('block');

    tutorial.dispose();
  });

  it('emits tutorial_step_shown once per distinct step even when a step is re-shown', () => {
    const events: Array<[string, Record<string, unknown> | undefined]> = [];
    const tutorial = createTutorial();
    tutorial.onTelemetry = (event, props) => events.push([event, props]);

    tutorial.onPhaseChange('astrogation', 1);
    document.getElementById('tutorialNextBtn')?.click();
    tutorial.onPhaseChange('astrogation', 1);
    tutorial.hideTip();
    tutorial.onPhaseChange('astrogation', 1);

    expect(
      events
        .filter(([event]) => event === 'tutorial_step_shown')
        .map(([, props]) => props?.step),
    ).toEqual(['welcome', 'select-ship']);

    tutorial.dispose();
  });

  it('re-arms funnel telemetry after reset()', () => {
    const events: string[] = [];
    const tutorial = createTutorial();
    tutorial.onTelemetry = (event) => events.push(event);

    tutorial.onPhaseChange('astrogation', 1);
    tutorial.reset();
    tutorial.onPhaseChange('astrogation', 1);

    expect(events.filter((event) => event === 'tutorial_started')).toHaveLength(
      2,
    );
    expect(
      events.filter((event) => event === 'tutorial_step_shown'),
    ).toHaveLength(2);

    tutorial.dispose();
  });

  it('resumes from the last acknowledged step after a reload', () => {
    const firstSession = createTutorial();
    firstSession.onPhaseChange('astrogation', 1);
    document.getElementById('tutorialNextBtn')?.click();
    firstSession.dispose();

    renderTutorialDom();
    const reloadedSession = createTutorial();
    reloadedSession.onPhaseChange('astrogation', 1);

    expect(document.getElementById('tutorialTipText')?.textContent).toContain(
      'The course summary previews fuel, speed, and danger',
    );
    expect(window.localStorage.getItem('deltav_tutorial_progress')).toBe(
      '["welcome"]',
    );

    reloadedSession.dispose();
  });
});
