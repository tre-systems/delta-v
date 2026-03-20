/**
 * Interactive tutorial system for new players.
 * Shows contextual tips during the first game.
 * Tips are shown at specific game phases and dismissed
 * by the player. Tutorial state is persisted in
 * localStorage so it only shows once.
 */

import { byId, hide, show } from './dom';

const STORAGE_KEY = 'deltav_tutorial_done';

interface TutorialStep {
  id: string;
  phase: 'astrogation' | 'ordnance' | 'combat' | 'movement' | 'any';
  text: string;
  /** Only show after this turn number */
  minTurn?: number;
  /** Only show once per game */
  once?: boolean;
}

const STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    phase: 'astrogation',
    text: 'Welcome to Delta-V! Your ship starts landed on a planet. Each turn you choose a burn direction to accelerate. Your ship keeps its velocity between turns — this is vector movement.',
  },
  {
    id: 'select-ship',
    phase: 'astrogation',
    text: 'Click your ship or press Tab to select it. The dashed arrow shows where your ship will drift. The 6 arrows around that point are your burn options — click one or press 1-6 to accelerate.',
  },
  {
    id: 'gravity',
    phase: 'astrogation',
    text: 'Planets and the sun have gravity. Entering a gravity hex sets up a deflection on the following turn, which is how you can sling around planets and settle into orbit. The colored rings around bodies show those gravity fields.',
    minTurn: 2,
  },
  {
    id: 'fuel',
    phase: 'astrogation',
    text: 'Each burn costs 1 fuel. You can also drift without burning (free). Your fuel gauge is at the top of the screen. Land at a friendly base to refuel and repair.',
    minTurn: 3,
  },
  {
    id: 'ordnance-intro',
    phase: 'ordnance',
    text: 'Ordnance phase: ships can launch mines or nukes if they have cargo space, and warships can also launch torpedoes. Torpedoes can boost 1 or 2 hexes on launch; click the same arrow again to switch from x1 to x2. Use N=mine, T=torpedo, K=nuke.',
    once: true,
  },
  {
    id: 'combat-intro',
    phase: 'combat',
    text: 'Combat phase: click an enemy ship or nuke to target it. Gun attacks use combined firepower, while nukes are intercepted at 2:1 with range and relative velocity modifiers. Press Enter to attack or skip.',
    once: true,
  },
];

export class Tutorial {
  private completed = false;
  private shownSteps = new Set<string>();
  private tipEl: HTMLElement;
  private textEl: HTMLElement;
  private progressEl: HTMLElement;
  private activeStepId: string | null = null;

  constructor() {
    this.tipEl = byId('tutorialTip');
    this.textEl = byId('tutorialTipText');
    this.progressEl = byId('tutorialProgress');

    // Check if tutorial already completed
    if (localStorage.getItem(STORAGE_KEY) === '1') {
      this.completed = true;
    }

    // Wire buttons
    byId('tutorialNextBtn').addEventListener('click', () => this.advance());
    byId('tutorialSkipBtn').addEventListener('click', () => this.skip());
  }

  /** Check if tutorial is active (not completed) */
  isActive(): boolean {
    return !this.completed;
  }

  /** Called when game phase changes. Shows relevant tip. */
  onPhaseChange(phase: string, turn: number) {
    if (this.completed) return;

    // Find the next step that matches this phase
    const step = STEPS.find((s) => {
      if (this.shownSteps.has(s.id)) return false;
      if (s.phase !== 'any' && s.phase !== phase) {
        return false;
      }
      if (s.minTurn && turn < s.minTurn) return false;

      return true;
    });

    if (step) {
      this.showStep(step);
    } else {
      this.hideTip();
    }
  }

  /** Hide the tutorial tip */
  hideTip() {
    hide(this.tipEl);
    this.activeStepId = null;
  }

  private showStep(step: TutorialStep) {
    this.activeStepId = step.id;
    this.textEl.textContent = step.text;
    show(this.tipEl, 'block');

    // Re-trigger animation
    this.tipEl.style.animation = 'none';
    void this.tipEl.offsetHeight; // force reflow
    this.tipEl.style.animation = '';

    // Update progress dots
    this.progressEl.innerHTML = STEPS.map((s, _i) => {
      const cls = this.shownSteps.has(s.id)
        ? 'done'
        : s.id === step.id
          ? 'active'
          : '';

      return `<div class="tutorial-dot ${cls}"></div>`;
    }).join('');
  }

  private advance() {
    // Mark current step as shown
    if (this.activeStepId) {
      this.shownSteps.add(this.activeStepId);
    }

    // Check if all steps are shown
    if (this.shownSteps.size >= STEPS.length) {
      this.complete();
    }

    this.hideTip();
  }

  private skip() {
    this.complete();
    this.hideTip();
  }

  private complete() {
    this.completed = true;
    localStorage.setItem(STORAGE_KEY, '1');
  }

  /** Reset tutorial (for testing or replay) */
  reset() {
    this.completed = false;
    this.shownSteps.clear();
    this.activeStepId = null;
    localStorage.removeItem(STORAGE_KEY);
  }
}
