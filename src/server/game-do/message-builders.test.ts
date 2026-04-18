import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  createGameOrThrow,
  type MovementResult,
} from '../../shared/engine/game-engine';
import { asGameId, asOrdnanceId, asShipId } from '../../shared/ids';
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
} from './message-builders';

const transportFixtures = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/transport.json', import.meta.url),
    'utf8',
  ),
) as {
  s2c: Record<string, unknown>;
};

const normalizeStateEnvelope = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeStateEnvelope);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === 'state' ? '__STATE__' : normalizeStateEnvelope(entry),
      ]),
    );
  }

  return value;
};

describe('game-do-message-builders', () => {
  it('formats movement results for broadcast', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('SRV1'),
      findBaseHex,
    );

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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('SRV2'),
      findBaseHex,
    );

    expect(
      resolveMovementBroadcast({ state, engineEvents: [] }),
    ).toBeUndefined();

    expect(
      resolveMovementBroadcast({ state, engineEvents: [] }, 'stateUpdate'),
    ).toEqual(toStateUpdateMessage(state));
  });

  it('formats game start and fallback state-bearing messages', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('SRV2B'),
      findBaseHex,
    );

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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('SRV3'),
      findBaseHex,
    );

    const combatResults: CombatResult[] = [
      {
        attackerIds: [asShipId('p0s0')],
        targetId: asShipId('p1s0'),
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
      const state = createGameOrThrow(
        SCENARIOS.duel,
        map,
        asGameId('SRV4'),
        findBaseHex,
      );

      expect(resolveCombatBroadcast({ state, results: [] })).toBeUndefined();

      expect(
        resolveCombatBroadcast({ state, results: [] }, 'stateUpdate'),
      ).toEqual(toStateUpdateMessage(state));
    },
  );
});

describe('S2C state-bearing payload fixtures', () => {
  const map = buildSolarSystemMap();
  const state = createGameOrThrow(
    SCENARIOS.biplanetary,
    map,
    asGameId('FIX1'),
    findBaseHex,
  );

  it('gameStart payload has exactly { type, state }', () => {
    const msg = toGameStartMessage(state);

    expect(normalizeStateEnvelope(msg)).toEqual(
      transportFixtures.s2c.gameStart,
    );
  });

  it('stateUpdate payload has exactly { type, state }', () => {
    const msg = toStateUpdateMessage(state);

    expect(normalizeStateEnvelope(msg)).toEqual(
      transportFixtures.s2c.stateUpdate,
    );
  });

  it('stateUpdate adds transferEvents when engine events include transfers', () => {
    const msg = toStateUpdateMessage(state, [
      {
        type: 'fuelTransferred',
        fromShipId: asShipId('s0'),
        toShipId: asShipId('s1'),
        amount: 4,
      },
    ]);

    expect(msg.type).toBe('stateUpdate');
    if (msg.type !== 'stateUpdate') throw new Error('expected stateUpdate');
    expect(msg.transferEvents).toEqual([
      {
        type: 'fuelTransferred',
        fromShipId: 's0',
        toShipId: 's1',
        amount: 4,
      },
    ]);

    expect(normalizeStateEnvelope(msg)).toEqual(
      transportFixtures.s2c.stateUpdateWithTransferEvents,
    );
  });

  it('movementResult payload has exactly { type, movements, ordnanceMovements, events, state }', () => {
    const msg = toMovementResultMessage({
      movements: [
        {
          shipId: asShipId('p0s0'),
          from: { q: 5, r: 10 },
          to: { q: 6, r: 9 },
          path: [
            { q: 5, r: 10 },
            { q: 6, r: 9 },
          ],
          newVelocity: { dq: 2, dr: -1 },
          fuelSpent: 1,
          gravityEffects: [],
          outcome: 'normal',
        },
      ],
      ordnanceMovements: [
        {
          ordnanceId: asOrdnanceId('torp-1'),
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
          shipId: asShipId('p0s0'),
          hex: { q: 6, r: 9 },
          dieRoll: 0,
          damageType: 'eliminated',
          disabledTurns: 0,
        },
      ],
      engineEvents: [],
      state,
    });

    expect(normalizeStateEnvelope(msg)).toEqual(
      transportFixtures.s2c.movementResult,
    );
  });

  it('combatResult payload has exactly { type, results, state }', () => {
    const results: CombatResult[] = [
      {
        attackerIds: [asShipId('p0s0')],
        targetId: asShipId('p1s0'),
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
          attackerIds: [asShipId('p1s0')],
          targetId: asShipId('p0s0'),
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

    expect(
      normalizeStateEnvelope(toCombatResultMessage(state, results)),
    ).toEqual(transportFixtures.s2c.combatResult);
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
      'outcome',
    ];

    for (const key of expectedKeys) {
      expect(state).toHaveProperty(key);
    }
  });
});
