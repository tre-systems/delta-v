// Property tests for processOrdnance: launch duplication, phase gating,
// and empty-launch identity. Keeps the invariants enforceable without
// having to hand-craft a specific scenario each time.

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGameOrThrow, processOrdnance } from './engine/game-engine';
import { asGameId, asShipId } from './ids';
import { buildSolarSystemMap, findBaseHex } from './map-data';
import { SCENARIOS } from './scenario-definitions';
import type { OrdnanceLaunch } from './types/domain';

const buildDuelState = () => {
  const map = buildSolarSystemMap();
  const gameId = asGameId('PROP1');
  const state = createGameOrThrow(SCENARIOS.duel, map, gameId, findBaseHex);
  return { state, map };
};

describe('processOrdnance invariants', () => {
  it('empty launches resolve without error when in the ordnance phase', () => {
    const { state, map } = buildDuelState();
    const ordnancePhase = { ...state, phase: 'ordnance' as const };
    const result = processOrdnance(
      ordnancePhase,
      ordnancePhase.activePlayer,
      [],
      map,
      () => 0,
    );
    // Empty launches produce a MovementResult (no error).
    expect('error' in result).toBe(false);
  });

  it('rejects launches when the phase is not ordnance', () => {
    const { state, map } = buildDuelState();
    // Duel starts in astrogation, not ordnance.
    expect(state.phase).toBe('astrogation');
    const result = processOrdnance(state, state.activePlayer, [], map, () => 0);
    expect('error' in result).toBe(true);
  });

  it('rejects multiple launches that name the same ship', () => {
    fc.assert(
      fc.property(
        // Any two-entry launch list that reuses the same shipId must be
        // rejected regardless of ordnance type — the one-per-ship rule is
        // a hard invariant of the ordnance phase.
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.constantFrom('torpedo', 'mine', 'nuke'),
        fc.constantFrom('torpedo', 'mine', 'nuke'),
        (shipIdRaw, first, second) => {
          const { state, map } = buildDuelState();
          // Force the phase so we past the phase gate and hit the
          // duplicate-launch branch specifically.
          const mutatedState = { ...state, phase: 'ordnance' as const };
          const launches: OrdnanceLaunch[] = [
            {
              shipId: asShipId(shipIdRaw),
              ordnanceType: first as OrdnanceLaunch['ordnanceType'],
              torpedoAccel: null,
              torpedoAccelSteps: null,
            },
            {
              shipId: asShipId(shipIdRaw),
              ordnanceType: second as OrdnanceLaunch['ordnanceType'],
              torpedoAccel: null,
              torpedoAccelSteps: null,
            },
          ];
          const result = processOrdnance(
            mutatedState,
            mutatedState.activePlayer,
            launches,
            map,
            () => 0,
          );
          expect('error' in result).toBe(true);
        },
      ),
    );
  });
});
