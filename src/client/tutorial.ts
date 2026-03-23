// Interactive tutorial system for new players.
// Shows contextual tips during the first game.
// Tips are shown at specific game phases and dismissed
// by the player. Tutorial state is persisted in
// localStorage so it only shows once.

import { byId, hide, listen, setTrustedHTML, show } from './dom';
import { createDisposalScope } from './reactive';

const STORAGE_KEY = 'deltav_tutorial_done';

interface TutorialStep {
  id: string;
  phase: 'astrogation' | 'ordnance' | 'combat' | 'movement' | 'any';
  text: string;
  // Touch-friendly text shown on mobile
  mobileText?: string;
  // Only show after this turn number
  minTurn?: number;
  // Only show once per game
  once?: boolean;
}

export interface Tutorial {
  onTelemetry: ((event: string) => void) | null;
  isActive: () => boolean;
  onPhaseChange: (phase: string, turn: number) => void;
  hideTip: () => void;
  reset: () => void;
  dispose: () => void;
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
    mobileText:
      'Tap your ship to select it. The dashed arrow shows where your ship will drift. The 6 arrows around that point are your burn options — tap one to accelerate.',
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
    mobileText:
      'Ordnance phase: ships can launch mines or nukes if they have cargo space, and warships can also launch torpedoes. Torpedoes can boost 1 or 2 hexes on launch; tap the same arrow again to switch from x1 to x2. Use the buttons below to launch.',
    once: true,
  },
  {
    id: 'combat-intro',
    phase: 'combat',
    text: 'Combat phase: click an enemy ship or nuke to target it. Gun attacks use combined firepower, while nukes are intercepted at 2:1 with range and relative velocity modifiers. Press Enter to attack or skip.',
    mobileText:
      'Combat phase: tap an enemy ship or nuke to target it. Gun attacks use combined firepower, while nukes are intercepted at 2:1 with range and relative velocity modifiers. Use the Attack or Skip button.',
    once: true,
  },
];

export const createTutorial = (): Tutorial => {
  const scope = createDisposalScope();
  const tipEl = byId('tutorialTip');
  const textEl = byId('tutorialTipText');
  const progressEl = byId('tutorialProgress');

  let completed = localStorage.getItem(STORAGE_KEY) === '1';
  let shownSteps = new Set<string>();
  let activeStepId: string | null = null;
  let telemetryHandler: ((event: string) => void) | null = null;

  const emitTelemetry = (event: string): void => {
    telemetryHandler?.(event);
  };

  const hideTip = (): void => {
    hide(tipEl);
    activeStepId = null;
  };

  const complete = (): void => {
    completed = true;
    localStorage.setItem(STORAGE_KEY, '1');
  };

  const showStep = (step: TutorialStep): void => {
    if (shownSteps.size === 0) {
      emitTelemetry('tutorial_started');
    }

    activeStepId = step.id;

    const isMobile = window.innerWidth <= 760;
    textEl.textContent =
      isMobile && step.mobileText ? step.mobileText : step.text;

    show(tipEl, 'block');

    tipEl.style.animation = 'none';
    void tipEl.offsetHeight;
    tipEl.style.animation = '';

    setTrustedHTML(
      progressEl,
      STEPS.map((candidate) => {
        const cls = shownSteps.has(candidate.id)
          ? 'done'
          : candidate.id === step.id
            ? 'active'
            : '';

        return `<div class="tutorial-dot ${cls}"></div>`;
      }).join(''),
    );
  };

  const advance = (): void => {
    if (activeStepId) {
      shownSteps.add(activeStepId);
    }

    if (shownSteps.size >= STEPS.length) {
      emitTelemetry('tutorial_completed');
      complete();
    }

    hideTip();
  };

  const skip = (): void => {
    emitTelemetry('tutorial_skipped');
    complete();
    hideTip();
  };

  scope.add(listen(byId('tutorialNextBtn'), 'click', () => advance()));
  scope.add(listen(byId('tutorialSkipBtn'), 'click', () => skip()));

  const isActive = (): boolean => {
    return !completed;
  };

  const onPhaseChange = (phase: string, turn: number): void => {
    if (completed) {
      return;
    }

    const step = STEPS.find((candidate) => {
      if (shownSteps.has(candidate.id)) {
        return false;
      }

      if (candidate.phase !== 'any' && candidate.phase !== phase) {
        return false;
      }

      if (candidate.minTurn && turn < candidate.minTurn) {
        return false;
      }

      return true;
    });

    if (step) {
      showStep(step);
      return;
    }

    hideTip();
  };

  const reset = (): void => {
    completed = false;
    shownSteps = new Set<string>();
    activeStepId = null;
    localStorage.removeItem(STORAGE_KEY);
  };

  const dispose = (): void => {
    scope.dispose();
  };

  return {
    get onTelemetry() {
      return telemetryHandler;
    },
    set onTelemetry(nextHandler) {
      telemetryHandler = nextHandler;
    },
    isActive,
    onPhaseChange,
    hideTip,
    reset,
    dispose,
  };
};
