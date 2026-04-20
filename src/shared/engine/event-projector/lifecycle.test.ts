import { describe, expect, it } from 'vitest';
import { asGameId, asShipId, combatTargetKey } from '../../ids';
import { createTestShip, createTestState } from '../../test-helpers';
import { projectLifecycleEvent } from './lifecycle';

describe('projectLifecycleEvent', () => {
  it('clears per-combat attack tracking when the turn advances', () => {
    const state = createTestState({
      gameId: asGameId('TEST'),
      activePlayer: 1,
      turnNumber: 3,
      combatTargetedThisPhase: [combatTargetKey('ship', asShipId('enemy-1'))],
      ships: [
        createTestShip({
          id: asShipId('attacker'),
          owner: 0,
          firedThisPhase: true,
        }),
        createTestShip({
          id: asShipId('enemy-1'),
          owner: 1,
        }),
      ],
    });

    const result = projectLifecycleEvent(
      state,
      {
        type: 'turnAdvanced',
        turn: 4,
        activePlayer: 1,
      },
      asGameId('TEST'),
      {
        hexes: new Map(),
        bodies: [],
        bounds: { minQ: 0, maxQ: 0, minR: 0, maxR: 0 },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.combatTargetedThisPhase).toBeUndefined();
    expect(
      result.value.ships.find((ship) => ship.id === 'attacker')?.firedThisPhase,
    ).toBeUndefined();
  });
});
