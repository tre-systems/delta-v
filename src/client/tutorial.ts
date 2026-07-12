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
const PROGRESS_STORAGE_KEY = 'deltav_tutorial_progress';

export interface TutorialCreateDeps {
  openHelpSection?: (sectionElementId: string) => void;
}

const helpSectionForTutorialStep = (step: TutorialStep): string => {
  switch (step.id) {
    case 'welcome':
    case 'select-ship':
    case 'fuel':
      return 'help-group-movement';
    case 'gravity':
      return 'help-group-gravity';
    case 'ordnance-intro':
      return 'help-group-ordnance';
    case 'combat-intro':
      return 'help-group-combat';
    default:
      return 'help-group-phases';
  }
};

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
  // Full-phase tips are useful when reached, but should not block first-run
  // onboarding completion in Beginner routes that never enter those phases.
  completionOptional?: boolean;
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
    text: 'Welcome! Your ship will coast to the end of the dashed drift arrow. Choose one of the 6 numbered burn circles around that point, then Confirm. Burns cost 1 fuel and velocity carries into later turns.',
    mobileText:
      'Welcome! Your ship will coast to the end of the dashed drift arrow. Tap one of the 6 numbered burn circles around that point, then Confirm. Burns cost 1 fuel and velocity carries into later turns.',
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
    text: 'Ordnance is optional. To boost a torpedo, click an adjacent hex first (click it again for ×2), then press TORPEDO. Pressing TORPEDO without choosing a boost launches it straight immediately. Use N=mine, T=torpedo, K=nuke.',
    mobileText:
      'Ordnance is optional. To boost a torpedo, tap an adjacent hex first (tap it again for ×2), then tap TORPEDO. Tapping TORPEDO without choosing a boost launches it straight immediately.',
    once: true,
    completionOptional: true,
  },
  {
    id: 'combat-intro',
    phase: 'combat',
    text: 'Combat is optional. Click an enemy ship or nuke to see the odds plus range and relative-speed penalties. Press ATTACK (or Enter) to fire, or END COMBAT to hold fire.',
    mobileText:
      'Combat is optional. Tap an enemy ship or nuke to see the odds plus range and relative-speed penalties. Tap ATTACK to fire, or END COMBAT to hold fire.',
    once: true,
    completionOptional: true,
  },
];

const COMPLETION_STEPS = STEPS.filter((step) => !step.completionOptional);

export const createTutorial = (deps: TutorialCreateDeps = {}): Tutorial => {
  const scope = createDisposalScope();
  const tipEl = byId('tutorialTip');
  const textEl = byId('tutorialTipText');
  const progressEl = byId('tutorialProgress');
  const openHelpBtnEl = byId<HTMLButtonElement>('tutorialOpenHelpBtn');

  const storage = getWebLocalStorage();
  let completed = storage?.getItem(STORAGE_KEY) === '1';
  let shownSteps = (() => {
    try {
      const saved = JSON.parse(storage?.getItem(PROGRESS_STORAGE_KEY) ?? '[]');
      const validStepIds = new Set(STEPS.map((step) => step.id));
      return new Set<string>(
        Array.isArray(saved)
          ? saved.filter(
              (stepId): stepId is string =>
                typeof stepId === 'string' && validStepIds.has(stepId),
            )
          : [],
      );
    } catch {
      return new Set<string>();
    }
  })();
  // Steps that already emitted `tutorial_step_shown`. Tracked separately
  // from shownSteps (which only grows on "Got it" clicks) so telemetry
  // dedupes per tutorial session while tips keep re-appearing visually.
  let stepShownTelemetry = new Set<string>();
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
  let openHelpTargetSection = 'help-group-phases';

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
      storage?.removeItem(PROGRESS_STORAGE_KEY);
    } catch {
      /* quota / private mode */
    }
  };

  const showStep = (step: TutorialStep): void => {
    // Funnel telemetry dedupes per tutorial session. A passive player who
    // never clicks "Got it" re-enters astrogation every turn with an empty
    // shownSteps set (it only grows in advance()), and hideTip() clears
    // activeStepId on every phase transition — so gating on either would
    // re-fire these events once per turn and inflate the funnel.
    if (tutorialStartTime === null) {
      tutorialStartTime = Date.now();
      emitTelemetry('tutorial_started', { step: step.id });
    }
    // Per-step display telemetry. The 2026-04-27 D1 audit found 116
    // `tutorial_started` events vs 0 `tutorial_completed` — `advance()`
    // (a "Got it" click) was the only completion signal, so a player
    // who reads a tip and just keeps playing produced no funnel data.
    // This event exposes per-step display drop-off so we can see which
    // steps players actually reach without depending on click-through.
    if (!stepShownTelemetry.has(step.id)) {
      stepShownTelemetry.add(step.id);
      emitTelemetry('tutorial_step_shown', { step: step.id });
    }

    activeStepId = step.id;
    openHelpTargetSection = helpSectionForTutorialStep(step);

    text(textEl, cachedMobile && step.mobileText ? step.mobileText : step.text);

    visible(tipEl, true, 'block');
    visible(openHelpBtnEl, Boolean(deps.openHelpSection), 'inline-block');

    tipEl.style.animation = 'none';
    void tipEl.offsetHeight;
    tipEl.style.animation = '';

    setTrustedHTML(
      progressEl,
      COMPLETION_STEPS.map((candidate) => {
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
    if (completed) {
      hideTip();
      return;
    }

    if (activeStepId) {
      shownSteps.add(activeStepId);
      try {
        storage?.setItem(PROGRESS_STORAGE_KEY, JSON.stringify([...shownSteps]));
      } catch {
        /* quota / private mode */
      }
    }

    const completedRequiredSteps = COMPLETION_STEPS.every((step) =>
      shownSteps.has(step.id),
    );

    if (completedRequiredSteps) {
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
    stepShownTelemetry = new Set<string>();
    activeStepId = null;
    tutorialStartTime = null;
    try {
      storage?.removeItem(STORAGE_KEY);
      storage?.removeItem(PROGRESS_STORAGE_KEY);
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
    listen(openHelpBtnEl, 'click', () => {
      if (!deps.openHelpSection) {
        return;
      }
      deps.openHelpSection(openHelpTargetSection);
      emitTelemetry('tutorial_open_help', {
        step: activeStepId,
        section: openHelpTargetSection,
      });
    });
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
