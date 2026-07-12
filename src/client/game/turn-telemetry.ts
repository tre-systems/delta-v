import { track } from '../telemetry';
import type { ClientState } from './phase';
import type { OnboardingEntry } from './session-model';

export interface TurnTelemetryContext {
  scenario: string;
  isLocalGame: boolean;
  onboardingEntry?: OnboardingEntry | null;
}

interface TurnTelemetryDeps {
  now?: () => number;
  trackEvent?: (event: string, props?: Record<string, unknown>) => void;
}

export interface TurnTelemetryTracker {
  getLastLoggedTurn: () => number;
  onStateChanged: (prevState: ClientState, nextState: ClientState) => void;
  onTurnLogged: (turnNumber: number, context: TurnTelemetryContext) => void;
  reset: () => void;
}

export const createTurnTelemetryTracker = ({
  now = Date.now,
  trackEvent = track,
}: TurnTelemetryDeps = {}): TurnTelemetryTracker => {
  let phaseStartedAt: number | null = null;
  let turnStartedAt: number | null = null;
  let phaseDurations: Record<string, number> = {};
  let lastTurnNumber = -1;
  let lastLoggedTurn = -1;

  const getLastLoggedTurn = (): number => {
    return lastLoggedTurn;
  };

  const recordPhaseDuration = (prevState: ClientState): void => {
    if (phaseStartedAt === null || !prevState.startsWith('playing_')) {
      return;
    }

    const phase = prevState.replace('playing_', '');

    if (phase !== 'opponentTurn' && phase !== 'movementAnim') {
      const elapsed = now() - phaseStartedAt;
      phaseDurations[phase] = (phaseDurations[phase] ?? 0) + elapsed;
    }

    phaseStartedAt = null;
  };

  const emitTurnCompleted = (context: TurnTelemetryContext): void => {
    if (turnStartedAt === null) {
      return;
    }

    const props = {
      turn: lastTurnNumber,
      totalMs: now() - turnStartedAt,
      phases: { ...phaseDurations },
      scenario: context.scenario,
      mode: context.isLocalGame ? 'local' : 'multiplayer',
      ...(context.onboardingEntry ? { entry: context.onboardingEntry } : {}),
    };

    trackEvent('turn_completed', props);

    if (lastTurnNumber === 1) {
      trackEvent('first_turn_completed', props);
    }

    phaseDurations = {};
  };

  const onStateChanged = (
    prevState: ClientState,
    nextState: ClientState,
  ): void => {
    recordPhaseDuration(prevState);

    if (nextState.startsWith('playing_')) {
      phaseStartedAt = now();

      // Game starts enter play via setState without a turn log (the first
      // onTurnLogged can arrive as late as the opponent's astrogation), so
      // anchor the turn window at the first playing state. Otherwise the
      // first turn_completed reports a totalMs smaller than the phase
      // durations accrued before the log.
      if (turnStartedAt === null) {
        turnStartedAt = now();
      }
    }
  };

  const onTurnLogged = (
    turnNumber: number,
    context: TurnTelemetryContext,
  ): void => {
    if (lastTurnNumber > 0) {
      emitTurnCompleted(context);
      turnStartedAt = now();
    } else if (turnStartedAt === null) {
      turnStartedAt = now();
    }

    lastTurnNumber = turnNumber;
    lastLoggedTurn = turnNumber;
  };

  const reset = (): void => {
    phaseStartedAt = null;
    turnStartedAt = null;
    phaseDurations = {};
    lastTurnNumber = -1;
    lastLoggedTurn = -1;
  };

  return {
    getLastLoggedTurn,
    onStateChanged,
    onTurnLogged,
    reset,
  };
};
