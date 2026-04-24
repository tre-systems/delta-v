import { beforeAll, describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';

import {
  buildActionAccepted,
  buildActionRejected,
  checkActionGuards,
  IdempotencyKeyCache,
} from './action-guards';

let state: GameState;

beforeAll(() => {
  state = createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    asGameId('GUARDS'),
    findBaseHex,
  );
});

describe('checkActionGuards', () => {
  it('returns an inSync acceptance when guards are omitted', () => {
    expect(checkActionGuards(undefined, state, 0)).toEqual({
      guardStatus: 'inSync',
      rejection: null,
    });
  });

  it('returns inSync for empty guards when caller is the active player', () => {
    expect(checkActionGuards({}, state, state.activePlayer)).toEqual({
      guardStatus: 'inSync',
      rejection: null,
    });
  });

  it('returns inSync when expectedTurn matches', () => {
    const result = checkActionGuards(
      { expectedTurn: state.turnNumber },
      state,
      state.activePlayer,
    );
    expect(result).toEqual({
      guardStatus: 'inSync',
      rejection: null,
    });
  });

  it('rejects staleTurn when expectedTurn is off', () => {
    const result = checkActionGuards(
      { expectedTurn: state.turnNumber + 1 },
      state,
      0,
    );
    expect(result.rejection?.reason).toBe('staleTurn');
  });

  it('returns inSync when expectedPhase matches', () => {
    const result = checkActionGuards(
      { expectedPhase: state.phase },
      state,
      state.activePlayer,
    );
    expect(result).toEqual({
      guardStatus: 'inSync',
      rejection: null,
    });
  });

  it('rejects stalePhase when expectedPhase differs', () => {
    const other = state.phase === 'astrogation' ? 'combat' : 'astrogation';
    const result = checkActionGuards({ expectedPhase: other }, state, 0);
    expect(result.rejection?.reason).toBe('stalePhase');
  });

  it('forgives stalePhase when the action type is valid for the current phase', () => {
    // Simulates the turn-1 astrogation → ordnance race: client sent an
    // `astrogation` payload while the server was still in astrogation, but
    // the expectedPhase guard claims `combat` for some reason. Without the
    // action-aware check, the server would reject; with it, the guard is
    // skipped because the action type is valid for the real phase anyway.
    const other = state.phase === 'astrogation' ? 'combat' : 'astrogation';
    expect(state.phase).toBe('astrogation');
    const result = checkActionGuards(
      { expectedPhase: other },
      state,
      state.activePlayer,
      {
        type: 'astrogation',
        orders: [],
      },
    );
    expect(result).toEqual({
      guardStatus: 'stalePhaseForgiven',
      rejection: null,
    });
  });

  it('still rejects stalePhase when the action type does not match the real phase', () => {
    // Counterpart to the forgiving case — a combat submission during the
    // astrogation phase should still be rejected so we don't let a truly
    // misrouted action through.
    expect(state.phase).toBe('astrogation');
    const result = checkActionGuards({ expectedPhase: 'combat' }, state, 0, {
      type: 'combat',
      attacks: [],
    });
    expect(result.rejection?.reason).toBe('stalePhase');
  });

  it('rejects wrongActivePlayer during astrogation when caller is not activePlayer', () => {
    const inactive = state.activePlayer === 0 ? 1 : 0;
    const result = checkActionGuards({}, state, inactive);
    expect(result.rejection?.reason).toBe('wrongActivePlayer');
  });

  it('does not reject wrongActivePlayer during fleetBuilding for either seat', () => {
    const fleetState = { ...state, phase: 'fleetBuilding' as const };
    const inactive = fleetState.activePlayer === 0 ? 1 : 0;
    expect(checkActionGuards({}, fleetState, inactive)).toEqual({
      guardStatus: 'inSync',
      rejection: null,
    });
  });
});

describe('IdempotencyKeyCache', () => {
  it('reports has=false for unseen keys, has=true after remember', () => {
    const cache = new IdempotencyKeyCache();
    expect(cache.has(0, 'k1')).toBe(false);
    cache.remember(0, 'k1');
    expect(cache.has(0, 'k1')).toBe(true);
  });

  it('scopes keys per player', () => {
    const cache = new IdempotencyKeyCache();
    cache.remember(0, 'shared');
    expect(cache.has(1, 'shared')).toBe(false);
  });

  it('clear() empties the ring', () => {
    const cache = new IdempotencyKeyCache();
    cache.remember(0, 'k1');
    cache.clear();
    expect(cache.has(0, 'k1')).toBe(false);
  });

  it('keeps keys for same turn and phase, then clears them when the phase advances', () => {
    const cache = new IdempotencyKeyCache();
    cache.remember(0, 'k1');
    const sameScopeWithDifferentActivePlayer: GameState = {
      ...state,
      activePlayer: state.activePlayer === 0 ? 1 : 0,
    };
    cache.clearIfScopeChanged(state, sameScopeWithDifferentActivePlayer);
    expect(cache.has(0, 'k1')).toBe(true);

    cache.clearIfScopeChanged(state, {
      ...state,
      phase: 'ordnance',
    });
    expect(cache.has(0, 'k1')).toBe(false);
  });

  it('caps the ring at 32 keys per player', () => {
    const cache = new IdempotencyKeyCache();
    for (let i = 0; i < 40; i++) cache.remember(0, `k${i}`);
    // The earliest key should be evicted; the most recent should remain.
    expect(cache.has(0, 'k0')).toBe(false);
    expect(cache.has(0, 'k39')).toBe(true);
  });

  it('refreshes a re-remembered key to the newest slot (LRU behavior)', () => {
    const cache = new IdempotencyKeyCache();
    cache.remember(0, 'oldest');
    for (let i = 0; i < 31; i++) cache.remember(0, `k${i}`);
    // Without the refresh, inserting one more key would evict 'oldest'.
    // After re-remembering 'oldest' it should move to the newest position,
    // and a subsequent insertion should evict k0 instead.
    cache.remember(0, 'oldest');
    cache.remember(0, 'newcomer');
    expect(cache.has(0, 'oldest')).toBe(true);
    expect(cache.has(0, 'k0')).toBe(false);
    expect(cache.has(0, 'newcomer')).toBe(true);
  });
});

describe('buildActionRejected', () => {
  it('carries expected/actual and the full state snapshot', () => {
    const msg = buildActionRejected(
      { reason: 'staleTurn', message: 'turn drift' },
      state,
      { expectedTurn: 99, idempotencyKey: 'abc' },
      1,
    );
    expect(msg.type).toBe('actionRejected');
    expect(msg.reason).toBe('staleTurn');
    expect(msg.submitterPlayerId).toBe(1);
    expect(msg.expected.turn).toBe(99);
    expect(msg.actual.turn).toBe(state.turnNumber);
    expect(msg.actual.phase).toBe(state.phase);
    expect(msg.state).toBe(state);
    expect(msg.idempotencyKey).toBe('abc');
  });
});

describe('buildActionAccepted', () => {
  it('carries guard metadata for accepted actions', () => {
    const msg = buildActionAccepted(
      'stalePhaseForgiven',
      state,
      { expectedPhase: 'combat', idempotencyKey: 'abc' },
      1,
    );
    expect(msg.type).toBe('actionAccepted');
    expect(msg.guardStatus).toBe('stalePhaseForgiven');
    expect(msg.submitterPlayerId).toBe(1);
    expect(msg.expected.phase).toBe('combat');
    expect(msg.actual.turn).toBe(state.turnNumber);
    expect(msg.idempotencyKey).toBe('abc');
  });
});
