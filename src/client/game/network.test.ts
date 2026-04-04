import { describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  deriveDisconnectHandling,
  deriveGameStartClientState,
  deriveReconnectAttemptPlan,
  deriveWelcomeHandling,
  getReconnectDelayMs,
  shouldAttemptReconnect,
  shouldTransitionAfterStateUpdate,
} from './network';

describe('game-client-network', () => {
  it('derives fleet-building and turn-based game start states', () => {
    const map = buildSolarSystemMap();

    const fleetState = createGameOrThrow(
      SCENARIOS.interplanetaryWar,
      map,
      asGameId('NET1'),
      findBaseHex,
    );

    const duelState = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('NET2'),
      findBaseHex,
    );

    expect(deriveGameStartClientState(fleetState, 0)).toBe(
      'playing_fleetBuilding',
    );

    expect(deriveGameStartClientState(duelState, duelState.activePlayer)).toBe(
      'playing_astrogation',
    );

    expect(
      deriveGameStartClientState(duelState, 1 - duelState.activePlayer),
    ).toBe('playing_opponentTurn');

    expect(deriveGameStartClientState(fleetState, -1)).toBe(
      'playing_fleetBuilding',
    );
    expect(deriveGameStartClientState(duelState, -1)).toBe(
      'playing_opponentTurn',
    );
  });

  it('derives welcome handling for reconnects and guests', () => {
    expect(deriveWelcomeHandling('connecting', 2)).toEqual({
      showReconnectToast: true,
      nextState: 'waitingForOpponent',
    });

    expect(deriveWelcomeHandling('waitingForOpponent', 0)).toEqual({
      showReconnectToast: false,
      nextState: null,
    });
  });

  it('caps reconnect backoff at eight seconds', () => {
    expect(getReconnectDelayMs(1)).toBe(1000);
    expect(getReconnectDelayMs(2)).toBe(2000);
    expect(getReconnectDelayMs(4)).toBe(8000);
    expect(getReconnectDelayMs(7)).toBe(8000);
  });

  it('only attempts reconnects after a session has connected', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('NET3'),
      findBaseHex,
    );

    expect(shouldAttemptReconnect('menu', 'ABCDE', state)).toBe(false);

    expect(shouldAttemptReconnect('playing_astrogation', null, state)).toBe(
      false,
    );

    expect(shouldAttemptReconnect('playing_astrogation', 'ABCDE', null)).toBe(
      true,
    );

    expect(shouldAttemptReconnect('playing_astrogation', 'ABCDE', state)).toBe(
      true,
    );

    expect(shouldAttemptReconnect('connecting', 'ABCDE', null)).toBe(false);

    expect(shouldAttemptReconnect('waitingForOpponent', 'ABCDE', null)).toBe(
      true,
    );
  });

  it('derives disconnect handling for reconnect, menu fallback, and no-op states', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('NET4'),
      findBaseHex,
    );

    expect(
      deriveDisconnectHandling('playing_astrogation', 'ABCDE', state),
    ).toEqual({
      attemptReconnect: true,
      nextState: null,
    });

    expect(deriveDisconnectHandling('connecting', null, null)).toEqual({
      attemptReconnect: false,
      nextState: 'menu',
    });

    expect(deriveDisconnectHandling('connecting', 'ABCDE', null)).toEqual({
      attemptReconnect: false,
      nextState: 'menu',
    });

    expect(deriveDisconnectHandling('gameOver', 'ABCDE', state)).toEqual({
      attemptReconnect: false,
      nextState: null,
    });
  });

  it('derives reconnect scheduling and terminal failure conditions', () => {
    expect(deriveReconnectAttemptPlan('ABCDE', 0, 5)).toEqual({
      giveUp: false,
      nextAttempt: 1,
      delayMs: 1000,
    });

    expect(deriveReconnectAttemptPlan('ABCDE', 4, 5)).toEqual({
      giveUp: false,
      nextAttempt: 5,
      delayMs: 8000,
    });

    expect(deriveReconnectAttemptPlan('ABCDE', 5, 5)).toEqual({
      giveUp: true,
      nextAttempt: null,
      delayMs: null,
    });

    expect(deriveReconnectAttemptPlan(null, 0, 5)).toEqual({
      giveUp: true,
      nextAttempt: null,
      delayMs: null,
    });
  });

  it('skips phase transitions while movement animation is running', () => {
    expect(shouldTransitionAfterStateUpdate('playing_movementAnim')).toBe(
      false,
    );

    expect(shouldTransitionAfterStateUpdate('playing_combat')).toBe(true);
  });
});
