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

    expect(trackEvent).toHaveBeenCalledTimes(2);
    expect(trackEvent).toHaveBeenNthCalledWith(1, 'turn_completed', {
      turn: 1,
      totalMs: 140,
      phases: {
        astrogation: 40,
        ordnance: 35,
      },
      scenario: 'biplanetary',
      mode: 'multiplayer',
    });
    expect(trackEvent).toHaveBeenNthCalledWith(2, 'first_turn_completed', {
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
      scenario: 'biplanetary',
      isLocalGame: true,
    });
    telemetry.onStateChanged('menu', 'playing_combat');

    now = 30;
    telemetry.onStateChanged('playing_combat', 'menu');
    telemetry.reset();

    now = 50;
    telemetry.onTurnLogged(1, {
      scenario: 'biplanetary',
      isLocalGame: true,
    });

    expect(trackEvent).not.toHaveBeenCalled();
    expect(telemetry.getLastLoggedTurn()).toBe(1);
  });

  it('anchors the turn window at the first playing state when the turn log arrives late', () => {
    // Production local-duel shape: the opening astrogation is entered via
    // setState with no turn log; the first onTurnLogged only fires at the
    // opponent's astrogation of the same turn. The turn-1 emit must span
    // the whole turn instead of just the post-log slice.
    let now = 0;
    const trackEvent =
      vi.fn<(event: string, props?: Record<string, unknown>) => void>();
    const telemetry = createTurnTelemetryTracker({
      now: () => now,
      trackEvent,
    });

    telemetry.onStateChanged('menu', 'playing_astrogation');

    now = 44_537;
    telemetry.onStateChanged('playing_astrogation', 'playing_ordnance');

    now = 51_214;
    telemetry.onStateChanged('playing_ordnance', 'playing_opponentTurn');

    now = 53_200;
    telemetry.onTurnLogged(1, { scenario: 'duel', isLocalGame: true });

    now = 55_718;
    telemetry.onTurnLogged(2, { scenario: 'duel', isLocalGame: true });

    expect(trackEvent).toHaveBeenNthCalledWith(1, 'turn_completed', {
      turn: 1,
      totalMs: 55_718,
      phases: { astrogation: 44_537, ordnance: 6_677 },
      scenario: 'duel',
      mode: 'local',
    });
  });

  it('covers pre-turn fleet building in the first-turn window', () => {
    let now = 0;
    const trackEvent =
      vi.fn<(event: string, props?: Record<string, unknown>) => void>();
    const telemetry = createTurnTelemetryTracker({
      now: () => now,
      trackEvent,
    });

    telemetry.onStateChanged('menu', 'playing_fleetBuilding');

    now = 51_280;
    telemetry.onStateChanged('playing_fleetBuilding', 'playing_astrogation');
    telemetry.onTurnLogged(1, {
      scenario: 'interplanetaryWar',
      isLocalGame: true,
    });

    now = 94_239;
    telemetry.onStateChanged('playing_astrogation', 'playing_opponentTurn');

    now = 103_237;
    telemetry.onTurnLogged(2, {
      scenario: 'interplanetaryWar',
      isLocalGame: true,
    });

    expect(trackEvent).toHaveBeenNthCalledWith(1, 'turn_completed', {
      turn: 1,
      totalMs: 103_237,
      phases: { fleetBuilding: 51_280, astrogation: 42_959 },
      scenario: 'interplanetaryWar',
      mode: 'local',
    });
  });

  it('emits a dedicated first-turn milestone exactly once', () => {
    let now = 0;
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

    now = 30;
    telemetry.onStateChanged('playing_astrogation', 'menu');

    now = 60;
    telemetry.onTurnLogged(2, {
      scenario: 'biplanetary',
      isLocalGame: false,
    });

    expect(trackEvent).toHaveBeenNthCalledWith(1, 'turn_completed', {
      turn: 1,
      totalMs: 60,
      phases: { astrogation: 30 },
      scenario: 'biplanetary',
      mode: 'multiplayer',
    });
    expect(trackEvent).toHaveBeenNthCalledWith(2, 'first_turn_completed', {
      turn: 1,
      totalMs: 60,
      phases: { astrogation: 30 },
      scenario: 'biplanetary',
      mode: 'multiplayer',
    });
  });
});
