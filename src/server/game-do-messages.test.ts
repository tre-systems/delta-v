import { describe, expect, it } from 'vitest';
import { createGame, type MovementResult } from '../shared/game-engine';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../shared/map-data';
import type { CombatResult } from '../shared/types';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  toCombatResultMessage,
  toMovementResultMessage,
  toStateUpdateMessage,
} from './game-do-messages';

describe('game-do-messages', () => {
  it('formats movement results for broadcast', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.biplanetary, map, 'SRV1', findBaseHex);
    const movementResult: MovementResult = {
      state,
      movements: [],
      ordnanceMovements: [],
      events: [],
    };

    expect(toMovementResultMessage(movementResult)).toEqual({
      type: 'movementResult',
      movements: [],
      ordnanceMovements: [],
      events: [],
      state,
    });
    expect(resolveMovementBroadcast(movementResult)).toEqual(toMovementResultMessage(movementResult));
  });

  it('emits optional state updates for non-movement resolutions', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'SRV2', findBaseHex);

    expect(resolveMovementBroadcast({ state })).toBeUndefined();
    expect(resolveMovementBroadcast({ state }, 'stateUpdate')).toEqual(toStateUpdateMessage(state));
  });

  it('formats combat results for broadcast', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'SRV3', findBaseHex);
    const combatResults: CombatResult[] = [
      {
        attackerIds: ['p0s0'],
        targetId: 'p1s0',
        targetType: 'ship',
        attackType: 'gun',
        odds: '1:1',
        attackStrength: 2,
        defendStrength: 2,
        rangeMod: 0,
        velocityMod: 0,
        dieRoll: 4,
        modifiedRoll: 4,
        damageType: 'disabled',
        disabledTurns: 2,
        counterattack: null,
      },
    ];

    expect(toCombatResultMessage(state, combatResults)).toEqual({
      type: 'combatResult',
      results: combatResults,
      state,
    });
    expect(resolveCombatBroadcast({ state, results: combatResults })).toEqual(
      toCombatResultMessage(state, combatResults),
    );
  });

  it('falls back to state updates or silence for empty combat results', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'SRV4', findBaseHex);

    expect(resolveCombatBroadcast({ state, results: [] })).toBeUndefined();
    expect(resolveCombatBroadcast({ state, results: [] }, 'stateUpdate')).toEqual(toStateUpdateMessage(state));
  });
});
