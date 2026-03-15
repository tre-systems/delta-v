/**
 * Interactive tutorial system for new players.
 * Shows contextual tips during the first game.
 * Tips are shown at specific game phases and dismissed by the player.
 * Tutorial state is persisted in localStorage so it only shows once.
 */

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
    text: 'Planets and the sun have gravity. When your course passes through a gravity hex, your path is deflected. The colored rings around bodies show gravity fields. Plan your burns to use gravity to your advantage!',
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
    text: 'Ordnance phase: warships can launch mines, torpedoes, or nukes from their cargo. Mines and nukes drift with their launch vector, while torpedoes steer toward enemies. Use keyboard shortcuts: N=mine, T=torpedo, K=nuke.',
    once: true,
  },
  {
    id: 'combat-intro',
    phase: 'combat',
    text: 'Combat phase: click an enemy ship to target it. Combat odds depend on your combined firepower vs theirs, modified by range and relative velocity. Press Enter to attack or skip.',
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
    this.tipEl = document.getElementById('tutorialTip')!;
    this.textEl = document.getElementById('tutorialTipText')!;
    this.progressEl = document.getElementById('tutorialProgress')!;

    // Check if tutorial already completed
    if (localStorage.getItem(STORAGE_KEY) === '1') {
      this.completed = true;
    }

    // Wire buttons
    document.getElementById('tutorialNextBtn')!.addEventListener('click', () => this.advance());
    document.getElementById('tutorialSkipBtn')!.addEventListener('click', () => this.skip());
  }

  /** Check if tutorial is active (not completed) */
  isActive(): boolean {
    return !this.completed;
  }

  /** Called when game phase changes. Shows relevant tip if applicable. */
  onPhaseChange(phase: string, turn: number) {
    if (this.completed) return;

    // Find the next step that matches this phase
    const step = STEPS.find(s => {
      if (this.shownSteps.has(s.id)) return false;
      if (s.phase !== 'any' && s.phase !== phase) return false;
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
    this.tipEl.style.display = 'none';
    this.activeStepId = null;
  }

  private showStep(step: TutorialStep) {
    this.activeStepId = step.id;
    this.textEl.textContent = step.text;
    this.tipEl.style.display = 'block';
    // Re-trigger animation
    this.tipEl.style.animation = 'none';
    void this.tipEl.offsetHeight; // force reflow
    this.tipEl.style.animation = '';

    // Update progress dots
    this.progressEl.innerHTML = STEPS.map((s, i) => {
      const cls = this.shownSteps.has(s.id) ? 'done' : s.id === step.id ? 'active' : '';
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

  /** Reset tutorial (for testing or when player wants to see it again) */
  reset() {
    this.completed = false;
    this.shownSteps.clear();
    this.activeStepId = null;
    localStorage.removeItem(STORAGE_KEY);
  }
}
