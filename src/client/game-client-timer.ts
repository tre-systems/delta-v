export interface TurnTimerViewModel {
  text: string;
  className: string;
  shouldWarn: boolean;
}

export function deriveTurnTimer(elapsedSeconds: number, timeoutSeconds: number): TurnTimerViewModel {
  const remaining = timeoutSeconds - elapsedSeconds;
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  return {
    text: mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`,
    className: 'turn-timer' + (
      elapsedSeconds >= 90 ? ' turn-timer-urgent' :
      elapsedSeconds >= 30 ? ' turn-timer-slow' : ' turn-timer-active'
    ),
    shouldWarn: remaining <= 30,
  };
}
