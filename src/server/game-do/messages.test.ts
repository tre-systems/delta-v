import { describe, expect, it } from 'vitest';

import {
  createGame,
  type MovementResult,
} from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { CombatResult } from '../../shared/types/domain';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  resolveStateBearingMessage,
  toCombatResultMessage,
  toGameStartMessage,
  toMovementResultMessage,
  toStateUpdateMessage,
} from './messages';

describe('game-do-messages', () => {
  it('formats movement results for broadcast', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.biplanetary, map, 'SRV1', findBaseHex);

    const movementResult: MovementResult = {
      state,
      movements: [],
      ordnanceMovements: [],
      events: [],
      engineEvents: [],
    };

    expect(toMovementResultMessage(movementResult)).toEqual({
      type: 'movementResult',
      movements: [],
      ordnanceMovements: [],
      events: [],
      state,
    });

    expect(resolveMovementBroadcast(movementResult)).toEqual(
      toMovementResultMessage(movementResult),
    );
  });

  it('emits optional state updates for non-movement resolutions', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.duel, map, 'SRV2', findBaseHex);

    expect(
      resolveMovementBroadcast({ state, engineEvents: [] }),
    ).toBeUndefined();

    expect(
      resolveMovementBroadcast({ state, engineEvents: [] }, 'stateUpdate'),
    ).toEqual(toStateUpdateMessage(state));
  });

  it('formats game start and fallback state-bearing messages', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.biplanetary, map, 'SRV2B', findBaseHex);

    expect(toGameStartMessage(state)).toEqual({
      type: 'gameStart',
      state,
    });

    expect(resolveStateBearingMessage(state)).toEqual(
      toStateUpdateMessage(state),
    );

    expect(
      resolveStateBearingMessage(state, toStateUpdateMessage(state)),
    ).toEqual(toStateUpdateMessage(state));
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

  it(
    'falls back to state updates or silence' + ' for empty combat results',
    () => {
      const map = buildSolarSystemMap();
      const state = createGame(SCENARIOS.duel, map, 'SRV4', findBaseHex);

      expect(resolveCombatBroadcast({ state, results: [] })).toBeUndefined();

      expect(
        resolveCombatBroadcast({ state, results: [] }, 'stateUpdate'),
      ).toEqual(toStateUpdateMessage(state));
    },
  );
});

// Event derivation tests removed — engine now
// emits EngineEvent[] directly (Layer 3).

describe('S2C state-bearing payload fixtures', () => {
  const map = buildSolarSystemMap();
  const state = createGame(SCENARIOS.biplanetary, map, 'FIX1', findBaseHex);

  it('gameStart payload has exactly { type, state }', () => {
    const msg = toGameStartMessage(state);

    expect(Object.keys(msg).sort()).toEqual(['state', 'type'].sort());
    expect(msg.type).toBe('gameStart');
    expect(msg.state).toBe(state);
  });

  it('stateUpdate payload has exactly { type, state }', () => {
    const msg = toStateUpdateMessage(state);

    expect(Object.keys(msg).sort()).toEqual(['state', 'type'].sort());
    expect(msg.type).toBe('stateUpdate');
  });

  it('movementResult payload has exactly { type, movements, ordnanceMovements, events, state }', () => {
    const msg = toMovementResultMessage({
      movements: [
        {
          shipId: 'p0s0',
          from: { q: 5, r: 10 },
          to: { q: 6, r: 9 },
          path: [
            { q: 5, r: 10 },
            { q: 6, r: 9 },
          ],
          newVelocity: { dq: 2, dr: -1 },
          fuelSpent: 1,
          gravityEffects: [],
          crashed: false,
          landedAt: null,
        },
      ],
      ordnanceMovements: [
        {
          ordnanceId: 'torp-1',
          from: { q: 10, r: 15 },
          to: { q: 12, r: 14 },
          path: [
            { q: 10, r: 15 },
            { q: 11, r: 14 },
            { q: 12, r: 14 },
          ],
          detonated: false,
        },
      ],
      events: [
        {
          type: 'crash',
          shipId: 'p0s0',
          hex: { q: 6, r: 9 },
          dieRoll: 0,
          damageType: 'eliminated',
          disabledTurns: 0,
        },
      ],
      engineEvents: [],
      state,
    });

    expect(Object.keys(msg).sort()).toEqual(
      ['events', 'movements', 'ordnanceMovements', 'state', 'type'].sort(),
    );
    expect(msg.type).toBe('movementResult');

    const m = msg as {
      movements: unknown[];
      ordnanceMovements: unknown[];
      events: unknown[];
    };
    expect(m.movements).toHaveLength(1);
    expect(m.ordnanceMovements).toHaveLength(1);
    expect(m.events).toHaveLength(1);
  });

  it('combatResult payload has exactly { type, results, state }', () => {
    const results: CombatResult[] = [
      {
        attackerIds: ['p0s0'],
        targetId: 'p1s0',
        targetType: 'ship',
        attackType: 'gun',
        odds: '2-1',
        attackStrength: 2,
        defendStrength: 1,
        rangeMod: 0,
        velocityMod: 0,
        dieRoll: 4,
        modifiedRoll: 4,
        damageType: 'eliminated',
        disabledTurns: 0,
        counterattack: {
          attackerIds: ['p1s0'],
          targetId: 'p0s0',
          targetType: 'ship',
          attackType: 'gun',
          odds: '1-2',
          attackStrength: 1,
          defendStrength: 2,
          rangeMod: 0,
          velocityMod: 0,
          dieRoll: 6,
          modifiedRoll: 6,
          damageType: 'none',
          disabledTurns: 0,
          counterattack: null,
        },
      },
    ];

    const msg = toCombatResultMessage(state, results);

    expect(Object.keys(msg).sort()).toEqual(
      ['results', 'state', 'type'].sort(),
    );
    expect(msg.type).toBe('combatResult');
    expect(
      (msg as { results: CombatResult[] }).results[0].counterattack,
    ).not.toBeNull();
  });

  it('GameState fixture includes all expected top-level fields', () => {
    const expectedKeys = [
      'gameId',
      'scenario',
      'scenarioRules',
      'escapeMoralVictoryAchieved',
      'turnNumber',
      'phase',
      'activePlayer',
      'ships',
      'ordnance',
      'pendingAstrogationOrders',
      'pendingAsteroidHazards',
      'destroyedAsteroids',
      'destroyedBases',
      'players',
      'winner',
      'winReason',
    ];

    for (const key of expectedKeys) {
      expect(state).toHaveProperty(key);
    }
  });
});
