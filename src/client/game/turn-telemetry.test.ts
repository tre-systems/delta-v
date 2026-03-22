import { describe, expect, it, vi } from 'vitest';

import { createTurnTelemetryTracker } from './turn-telemetry';

describe('TurnTelemetryTracker', () => {
  it('tracks player phase durations and emits turn telemetry on rollover', () => {
    let now = 100;
    const trackEvent =
      vi.fn<(event: string, props?: Record<string, unknown>) => void>();
    const telemetry = createTurnTelemetryTracker({
      now: () => now,
      trackEvent,
    });

    telemetry.onTurnLogged(1, {
      scenario: 'biplanetary',
      isLocalGame: false,
    });
    telemetry.onStateChanged('menu', 'playing_astrogation');

    now = 140;
    telemetry.onStateChanged('playing_astrogation', 'playing_opponentTurn');

    now = 165;
    telemetry.onStateChanged('playing_opponentTurn', 'playing_ordnance');

    now = 200;
    telemetry.onStateChanged('playing_ordnance', 'menu');

    now = 240;
    telemetry.onTurnLogged(2, {
      scenario: 'biplanetary',
      isLocalGame: false,
    });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('turn_completed', {
      turn: 1,
      totalMs: 140,
      phases: {
        astrogation: 40,
        ordnance: 35,
      },
      scenario: 'biplanetary',
      mode: 'multiplayer',
    });
    expect(telemetry.getLastLoggedTurn()).toBe(2);
  });

  it('reset clears prior session state before the next turn begins', () => {
    let now = 10;
    const trackEvent =
      vi.fn<(event: string, props?: Record<string, unknown>) => void>();
    const telemetry = createTurnTelemetryTracker({
      now: () => now,
      trackEvent,
    });

    telemetry.onTurnLogged(4, {
      scenario: 'test',
      isLocalGame: true,
    });
    telemetry.onStateChanged('menu', 'playing_combat');

    now = 30;
    telemetry.onStateChanged('playing_combat', 'menu');
    telemetry.reset();

    now = 50;
    telemetry.onTurnLogged(1, {
      scenario: 'test',
      isLocalGame: true,
    });

    expect(trackEvent).not.toHaveBeenCalled();
    expect(telemetry.getLastLoggedTurn()).toBe(1);
  });
});
