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
import type { CombatResult, GameState } from '../../shared/types/domain';
import {
  deriveCombatEvents,
  deriveMovementEvents,
  derivePhaseChangeEvents,
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

    expect(resolveMovementBroadcast({ state })).toBeUndefined();

    expect(resolveMovementBroadcast({ state }, 'stateUpdate')).toEqual(
      toStateUpdateMessage(state),
    );
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

describe('event log derivation', () => {
  const makeState = (overrides: Partial<GameState> = {}): GameState => {
    const map = buildSolarSystemMap();
    const base = createGame(SCENARIOS.duel, map, 'EVT1', findBaseHex);
    return { ...base, ...overrides };
  };

  describe('deriveMovementEvents', () => {
    it('produces movementResolved + phaseChanged', () => {
      const state = makeState({
        phase: 'ordnance',
        turnNumber: 5,
      });
      const result: MovementResult = {
        movements: [
          {
            shipId: 's1',
            from: { q: 0, r: 0 },
            to: { q: 1, r: 0 },
            path: [
              { q: 0, r: 0 },
              { q: 1, r: 0 },
            ],
            newVelocity: { dq: 1, dr: 0 },
            fuelSpent: 1,
            gravityEffects: [],
            crashed: false,
            landedAt: null,
          },
        ],
        ordnanceMovements: [],
        events: [],
        state,
      };

      const events = deriveMovementEvents(result);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('movementResolved');
      expect(events[1].type).toBe('phaseChanged');

      if (events[0].type === 'movementResolved') {
        expect(events[0].turn).toBe(5);
        expect(events[0].movements).toHaveLength(1);
      }
    });

    it('produces only phaseChanged for StateUpdateResult', () => {
      const state = makeState({ phase: 'combat' });
      const events = deriveMovementEvents({ state });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('phaseChanged');
    });

    it('includes gameOver when game ends', () => {
      const state = makeState({
        phase: 'gameOver',
        winner: 1,
        winReason: 'Fleet eliminated!',
      });

      const events = deriveMovementEvents({ state });

      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        type: 'gameOver',
        winner: 1,
        reason: 'Fleet eliminated!',
      });
    });
  });

  describe('deriveCombatEvents', () => {
    it('produces combatResolved + phaseChanged', () => {
      const state = makeState({
        phase: 'combat',
        turnNumber: 3,
      });
      const combatResult: CombatResult = {
        attackerIds: ['s1'],
        targetId: 's2',
        targetType: 'ship',
        attackType: 'gun',
        odds: '2:1',
        attackStrength: 4,
        defendStrength: 2,
        rangeMod: 0,
        velocityMod: 0,
        dieRoll: 5,
        modifiedRoll: 5,
        damageType: 'disabled',
        disabledTurns: 2,
        counterattack: null,
      };

      const events = deriveCombatEvents({
        results: [combatResult],
        state,
      });

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('combatResolved');
      expect(events[1].type).toBe('phaseChanged');

      if (events[0].type === 'combatResolved') {
        expect(events[0].turn).toBe(3);
        expect(events[0].results).toHaveLength(1);
      }
    });

    it('skips combatResolved for empty results', () => {
      const state = makeState({ phase: 'astrogation' });

      const events = deriveCombatEvents({
        results: [],
        state,
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('phaseChanged');
    });

    it('skips combatResolved for StateUpdateResult', () => {
      const state = makeState({ phase: 'logistics' });

      const events = deriveCombatEvents({ state });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('phaseChanged');
    });
  });

  describe('derivePhaseChangeEvents', () => {
    it('produces a single phaseChanged event', () => {
      const state = makeState({
        phase: 'combat',
        activePlayer: 1,
        turnNumber: 7,
      });

      const events = derivePhaseChangeEvents(state);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'phaseChanged',
        turn: 7,
        phase: 'combat',
        activePlayer: 1,
      });
    });

    it('appends gameOver when game ended', () => {
      const state = makeState({
        phase: 'gameOver',
        winner: 0,
        winReason: 'Escaped!',
      });

      const events = derivePhaseChangeEvents(state);

      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        type: 'gameOver',
        winner: 0,
        reason: 'Escaped!',
      });
    });
  });
});
