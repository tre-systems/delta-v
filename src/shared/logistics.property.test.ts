// Property tests for processLogistics: phase gating, empty-transfer
// identity, and transfer rejection when the named ships don't share
// a hex (enforced by validateTransfer).

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createGameOrThrow, processLogistics } from './engine/game-engine';
import { asGameId, asShipId } from './ids';
import { buildSolarSystemMap, findBaseHex } from './map-data';
import { SCENARIOS } from './scenario-definitions';
import type { TransferOrder } from './types/domain';

const buildConvoyState = () => {
  const map = buildSolarSystemMap();
  const gameId = asGameId('PROP2');
  const state = createGameOrThrow(SCENARIOS.convoy, map, gameId, findBaseHex);
  return { state, map };
};

describe('processLogistics invariants', () => {
  it('empty transfers resolve without error in the logistics phase', () => {
    const { state, map } = buildConvoyState();
    const logisticsPhase = { ...state, phase: 'logistics' as const };
    const result = processLogistics(
      logisticsPhase,
      logisticsPhase.activePlayer,
      [],
      map,
    );
    expect('error' in result).toBe(false);
  });

  it('rejects transfers when the phase is not logistics', () => {
    const { state, map } = buildConvoyState();
    // Convoy starts in astrogation.
    expect(state.phase).toBe('astrogation');
    const result = processLogistics(state, state.activePlayer, [], map);
    expect('error' in result).toBe(true);
  });

  it('rejects a transfer whose ship ids are unknown', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.constantFrom('fuel', 'cargo', 'passengers'),
        fc.integer({ min: 1, max: 10 }),
        (srcRaw, dstRaw, type, amount) => {
          fc.pre(srcRaw !== dstRaw);
          const { state, map } = buildConvoyState();
          const logisticsPhase = { ...state, phase: 'logistics' as const };
          const transfer: TransferOrder = {
            sourceShipId: asShipId(srcRaw),
            targetShipId: asShipId(dstRaw),
            transferType: type as TransferOrder['transferType'],
            amount,
          };
          const result = processLogistics(
            logisticsPhase,
            logisticsPhase.activePlayer,
            [transfer],
            map,
          );
          // Unknown ship ids must be rejected — the validator inside
          // processLogistics catches this before any state mutation.
          expect('error' in result).toBe(true);
        },
      ),
    );
  });
});
