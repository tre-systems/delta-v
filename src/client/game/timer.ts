import { TURN_TIMEOUT_MS } from '../../shared/constants';
import { type ReadonlySignal, signal } from '../reactive';

export interface TurnTimerViewModel {
  text: string;
  className: string;
  shouldWarn: boolean;
}

// Hide the timer for the first N seconds so new
// players can orient without pressure
const GRACE_PERIOD_S = 15;

export const deriveTurnTimer = (
  elapsedSeconds: number,
  timeoutSeconds: number,
): TurnTimerViewModel => {
  const remaining = timeoutSeconds - elapsedSeconds;
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  return {
    text:
      elapsedSeconds < GRACE_PERIOD_S
        ? ''
        : mins > 0
          ? `${mins}:${secs.toString().padStart(2, '0')}`
          : `${secs}s`,
    className:
      'turn-timer' +
      (elapsedSeconds >= 90
        ? ' turn-timer-urgent'
        : elapsedSeconds >= 30
          ? ' turn-timer-slow'
          : ' turn-timer-active'),
    shouldWarn: remaining <= 30,
  };
};

export interface TurnTimerDeps {
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  playWarning: () => void;
}

export interface TurnTimerManager {
  readonly viewSignal: ReadonlySignal<Pick<
    TurnTimerViewModel,
    'text' | 'className'
  > | null>;
  start: () => void;
  stop: () => void;
}

export const createTurnTimerManager = (
  deps: TurnTimerDeps,
): TurnTimerManager => {
  let turnStartTime = 0;
  let turnTimerInterval: number | null = null;
  let timerWarningPlayed = false;
  const viewSignal = signal<Pick<
    TurnTimerViewModel,
    'text' | 'className'
  > | null>(null);

  const stop = () => {
    if (turnTimerInterval !== null) {
      clearInterval(turnTimerInterval);
      turnTimerInterval = null;
    }
    viewSignal.value = null;
  };

  const start = () => {
    stop();
    turnStartTime = Date.now();
    timerWarningPlayed = false;
    turnTimerInterval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - turnStartTime) / 1000);
      const timer = deriveTurnTimer(
        elapsed,
        Math.floor(TURN_TIMEOUT_MS / 1000),
      );
      viewSignal.value = {
        text: timer.text,
        className: timer.className,
      };
      // Warning at 30s remaining
      if (timer.shouldWarn && !timerWarningPlayed) {
        timerWarningPlayed = true;
        deps.playWarning();
        deps.showToast('30 seconds remaining!', 'error');
      }
    }, 1000);
  };

  return {
    viewSignal,
    start,
    stop,
  };
};
