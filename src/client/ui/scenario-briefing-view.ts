import { isValidScenario, SCENARIOS } from '../../shared/map-data';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { byId, hide, listen, show, text } from '../dom';
import { getObjective } from '../game/hud-view-model';
import { createDisposalScope, effect, signal, withScope } from '../reactive';

export interface ScenarioBriefingView {
  show: (state: GameState, playerId: PlayerId) => void;
  hide: () => void;
  dispose: () => void;
}

export const createScenarioBriefingView = (): ScenarioBriefingView => {
  const scope = createDisposalScope();
  const briefingEl = byId('scenarioBriefing');
  const titleEl = byId('scenarioBriefingTitle');
  const descriptionEl = byId('scenarioBriefingDescription');
  const objectiveEl = byId('scenarioBriefingObjective');
  const startBtn = byId<HTMLButtonElement>('scenarioBriefingStartBtn');
  const visibleSignal = signal(false);
  let returnFocusEl: HTMLElement | null = null;

  const close = (): void => {
    visibleSignal.value = false;
    const restoreTarget = returnFocusEl;
    returnFocusEl = null;
    if (restoreTarget && document.contains(restoreTarget)) {
      queueMicrotask(() => restoreTarget.focus({ preventScroll: true }));
    }
  };

  withScope(scope, () => {
    effect(() => {
      if (visibleSignal.value) {
        show(briefingEl, 'flex');
        document.body.classList.add('scenario-briefing-active');
        queueMicrotask(() => startBtn.focus({ preventScroll: true }));
      } else {
        hide(briefingEl);
        document.body.classList.remove('scenario-briefing-active');
      }
    });

    listen(startBtn, 'click', close);
    listen(briefingEl, 'click', (event) => {
      if (event.target === briefingEl) {
        close();
      }
    });
    listen(briefingEl, 'keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        close();
      }
    });
  });

  return {
    show: (state, playerId) => {
      const scenario = isValidScenario(state.scenario)
        ? SCENARIOS[state.scenario]
        : null;
      text(titleEl, scenario?.name ?? state.scenario);
      text(
        descriptionEl,
        scenario?.description ?? 'Complete the objective before the enemy.',
      );
      text(objectiveEl, getObjective(state, playerId));
      returnFocusEl = document.activeElement as HTMLElement | null;
      visibleSignal.value = true;
    },
    hide: close,
    dispose: () => {
      document.body.classList.remove('scenario-briefing-active');
      scope.dispose();
    },
  };
};
