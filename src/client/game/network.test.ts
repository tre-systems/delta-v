import { describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import {
  deriveGameStartClientState,
  deriveReconnectAttemptPlan,
  getReconnectDelayMs,
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

  it('caps reconnect backoff at eight seconds', () => {
    expect(getReconnectDelayMs(1)).toBe(1000);
    expect(getReconnectDelayMs(2)).toBe(2000);
    expect(getReconnectDelayMs(4)).toBe(8000);
    expect(getReconnectDelayMs(7)).toBe(8000);
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
});
