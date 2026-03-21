import { track } from '../telemetry';
import type { ClientState } from './phase';

export interface TurnTelemetryContext {
  scenario: string;
  isLocalGame: boolean;
}

interface TurnTelemetryDeps {
  now?: () => number;
  trackEvent?: (event: string, props?: Record<string, unknown>) => void;
}

export class TurnTelemetryTracker {
  private phaseStartedAt: number | null = null;
  private turnStartedAt: number | null = null;
  private phaseDurations: Record<string, number> = {};
  private lastTurnNumber = -1;
  private lastLoggedTurn = -1;

  private readonly now: () => number;
  private readonly trackEvent: (
    event: string,
    props?: Record<string, unknown>,
  ) => void;

  constructor({ now = Date.now, trackEvent = track }: TurnTelemetryDeps = {}) {
    this.now = now;
    this.trackEvent = trackEvent;
  }

  getLastLoggedTurn(): number {
    return this.lastLoggedTurn;
  }

  onStateChanged(prevState: ClientState, nextState: ClientState): void {
    this.recordPhaseDuration(prevState);
    if (nextState.startsWith('playing_')) {
      this.phaseStartedAt = this.now();
    }
  }

  onTurnLogged(turnNumber: number, context: TurnTelemetryContext): void {
    if (this.lastTurnNumber > 0) {
      this.emitTurnCompleted(context);
    }
    this.turnStartedAt = this.now();
    this.lastTurnNumber = turnNumber;
    this.lastLoggedTurn = turnNumber;
  }

  reset(): void {
    this.phaseStartedAt = null;
    this.turnStartedAt = null;
    this.phaseDurations = {};
    this.lastTurnNumber = -1;
    this.lastLoggedTurn = -1;
  }

  private recordPhaseDuration(prevState: ClientState): void {
    if (this.phaseStartedAt === null || !prevState.startsWith('playing_')) {
      return;
    }

    const phase = prevState.replace('playing_', '');
    if (phase !== 'opponentTurn' && phase !== 'movementAnim') {
      const elapsed = this.now() - this.phaseStartedAt;
      this.phaseDurations[phase] = (this.phaseDurations[phase] ?? 0) + elapsed;
    }

    this.phaseStartedAt = null;
  }

  private emitTurnCompleted(context: TurnTelemetryContext): void {
    if (this.turnStartedAt === null) {
      return;
    }

    this.trackEvent('turn_completed', {
      turn: this.lastTurnNumber,
      totalMs: this.now() - this.turnStartedAt,
      phases: { ...this.phaseDurations },
      scenario: context.scenario,
      mode: context.isLocalGame ? 'local' : 'multiplayer',
    });

    this.phaseDurations = {};
  }
}
