import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/game-engine';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../shared/map-data';
import {
  deriveGameStartClientState,
  deriveWelcomeHandling,
  getReconnectDelayMs,
  shouldAttemptReconnect,
  shouldTransitionAfterStateUpdate,
} from './game-client-network';

describe('game-client-network', () => {
  it('derives fleet-building and turn-based game start states', () => {
    const map = buildSolarSystemMap();
    const fleetState = createGame(SCENARIOS.interplanetaryWar, map, 'NET1', findBaseHex);
    const duelState = createGame(SCENARIOS.duel, map, 'NET2', findBaseHex);

    expect(deriveGameStartClientState(fleetState, 0)).toBe('playing_fleetBuilding');
    expect(deriveGameStartClientState(duelState, duelState.activePlayer)).toBe('playing_astrogation');
    expect(deriveGameStartClientState(duelState, 1 - duelState.activePlayer)).toBe('playing_opponentTurn');
  });

  it('derives welcome handling for reconnects and guests', () => {
    expect(deriveWelcomeHandling('connecting', 2, 1)).toEqual({
      clearInviteLink: true,
      showReconnectToast: true,
      nextState: 'waitingForOpponent',
    });

    expect(deriveWelcomeHandling('waitingForOpponent', 0, 0)).toEqual({
      clearInviteLink: false,
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

  it('only attempts reconnects for active games', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'NET3', findBaseHex);

    expect(shouldAttemptReconnect('menu', 'ABCDE', state)).toBe(false);
    expect(shouldAttemptReconnect('playing_astrogation', null, state)).toBe(false);
    expect(shouldAttemptReconnect('playing_astrogation', 'ABCDE', null)).toBe(false);
    expect(shouldAttemptReconnect('playing_astrogation', 'ABCDE', state)).toBe(true);
  });

  it('skips phase transitions while movement animation is running', () => {
    expect(shouldTransitionAfterStateUpdate('playing_movementAnim')).toBe(false);
    expect(shouldTransitionAfterStateUpdate('playing_combat')).toBe(true);
  });
});
