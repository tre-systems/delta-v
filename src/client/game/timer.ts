import { TURN_TIMEOUT_MS } from '../../shared/constants';

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
  setTurnTimer: (text: string, className: string) => void;
  clearTurnTimer: () => void;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  playWarning: () => void;
}

export interface TurnTimerManager {
  start: () => void;
  stop: () => void;
}

export const createTurnTimerManager = (
  deps: TurnTimerDeps,
): TurnTimerManager => {
  let turnStartTime = 0;
  let turnTimerInterval: number | null = null;
  let timerWarningPlayed = false;

  const stop = () => {
    if (turnTimerInterval !== null) {
      clearInterval(turnTimerInterval);
      turnTimerInterval = null;
    }
    deps.clearTurnTimer();
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
      deps.setTurnTimer(timer.text, timer.className);
      // Warning at 30s remaining
      if (timer.shouldWarn && !timerWarningPlayed) {
        timerWarningPlayed = true;
        deps.playWarning();
        deps.showToast('30 seconds remaining!', 'error');
      }
    }, 1000);
  };

  return { start, stop };
};
