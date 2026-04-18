// Interactive tutorial system for new players.
// Shows contextual tips during the first game.
// Tips are shown at specific game phases and dismissed
// by the player. Tutorial state is persisted in
// localStorage so it only shows once.

import { byId, listen, setTrustedHTML, text, visible } from './dom';
import { createDisposalScope, withScope } from './reactive';
import { isMobileViewport } from './ui-breakpoints';
import { getWebLocalStorage } from './web-local-storage';

const STORAGE_KEY = 'deltav_tutorial_done';

interface TutorialStep {
  id: string;
  phase: 'astrogation' | 'ordnance' | 'combat' | 'any';
  text: string;
  // Touch-friendly text shown on mobile
  mobileText?: string;
  // Only show after this turn number
  minTurn?: number;
  // Only show once per game
  once?: boolean;
}

export interface Tutorial {
  onTelemetry:
    | ((event: string, props?: Record<string, unknown>) => void)
    | null;
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
    text: 'Welcome! Your ship is on a planet — pick a burn direction next turn so you do not drift wrong-way. (You keep velocity between turns; details live in Help.)',
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

  const storage = getWebLocalStorage();
  let completed = storage?.getItem(STORAGE_KEY) === '1';
  let shownSteps = new Set<string>();
  let activeStepId: string | null = null;
  // Cache mobile-ness at tutorial construction time. Re-evaluating on every
  // showStep() can flip copy mid-tutorial during device rotation, which is
  // jarring; users who rotate mid-tutorial keep their original variant and
  // get the other on the next session.
  let cachedMobile = isMobileViewport();
  let telemetryHandler:
    | ((event: string, props?: Record<string, unknown>) => void)
    | null = null;
  let tutorialStartTime: number | null = null;

  const emitTelemetry = (
    event: string,
    props?: Record<string, unknown>,
  ): void => {
    telemetryHandler?.(event, props);
  };

  const hideTip = (): void => {
    visible(tipEl, false);
    activeStepId = null;
  };

  const complete = (): void => {
    completed = true;
    try {
      storage?.setItem(STORAGE_KEY, '1');
    } catch {
      /* quota / private mode */
    }
  };

  const showStep = (step: TutorialStep): void => {
    if (shownSteps.size === 0) {
      tutorialStartTime = Date.now();
      emitTelemetry('tutorial_started', { step: step.id });
    }

    activeStepId = step.id;

    text(textEl, cachedMobile && step.mobileText ? step.mobileText : step.text);

    visible(tipEl, true, 'block');

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
      emitTelemetry('tutorial_completed', {
        totalTimeMs:
          tutorialStartTime !== null
            ? Date.now() - tutorialStartTime
            : undefined,
      });
      complete();
    }

    hideTip();
  };

  const skip = (): void => {
    emitTelemetry('tutorial_skipped', { step: activeStepId ?? undefined });
    complete();
    hideTip();
  };

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
    try {
      storage?.removeItem(STORAGE_KEY);
    } catch {
      /* quota / private mode */
    }
  };

  const dispose = (): void => {
    scope.dispose();
  };

  withScope(scope, () => {
    listen(byId('tutorialNextBtn'), 'click', () => advance());
    listen(byId('tutorialSkipBtn'), 'click', () => skip());
    // Only re-read the breakpoint on an explicit viewport change; no
    // re-render of the active step because rotating mid-step should not
    // re-flow the copy the user is currently reading.
    listen(window, 'resize', () => {
      cachedMobile = isMobileViewport();
    });
  });

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
