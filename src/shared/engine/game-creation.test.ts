import { beforeEach, describe, expect, it } from 'vitest';
import { SHIP_STATS } from '../constants';
import { hexKey } from '../hex';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { GameState, ScenarioDefinition, SolarSystemMap } from '../types';
import { createGame } from './game-creation';

let map: SolarSystemMap;
let initialState: GameState;
beforeEach(() => {
  map = buildSolarSystemMap();
  initialState = createGame(SCENARIOS.biplanetary, map, 'TEST1', findBaseHex);
});

describe('createGame', () => {
  it('creates game with correct scenario name', () => {
    expect(initialState.scenario).toBe('Bi-Planetary');
  });
  it('creates 2 ships for Bi-Planetary', () => {
    expect(initialState.ships).toHaveLength(2);
    expect(initialState.ships[0].owner).toBe(0);
    expect(initialState.ships[1].owner).toBe(1);
  });
  it('ships start landed at their home bases', () => {
    expect(initialState.ships[0].lifecycle).toBe('landed');
    expect(initialState.ships[1].lifecycle).toBe('landed');
  });
  it('ships start with full fuel', () => {
    const stats = SHIP_STATS.corvette;
    expect(initialState.ships[0].fuel).toBe(stats.fuel);
    expect(initialState.ships[1].fuel).toBe(stats.fuel);
  });
  it('ships start with zero damage', () => {
    expect(initialState.ships[0].damage.disabledTurns).toBe(0);
    expect(initialState.ships[1].damage.disabledTurns).toBe(0);
  });
  it('player 0 targets Venus, player 1 targets Mars', () => {
    expect(initialState.players[0].targetBody).toBe('Venus');
    expect(initialState.players[1].targetBody).toBe('Mars');
  });
  it('starts on turn 1 in astrogation phase', () => {
    expect(initialState.turnNumber).toBe(1);
    expect(initialState.phase).toBe('astrogation');
    expect(initialState.activePlayer).toBe(0);
  });
  it('ships are placed at actual base hexes', () => {
    const marsHex = map.hexes.get(hexKey(initialState.ships[0].position));
    const venusHex = map.hexes.get(hexKey(initialState.ships[1].position));
    expect(marsHex?.base?.bodyName).toBe('Mars');
    expect(venusHex?.base?.bodyName).toBe('Venus');
  });
  it('supports explicit split base ownership for shared worlds', () => {
    const duelState = createGame(SCENARIOS.duel, map, 'DUEL1', findBaseHex);
    expect(duelState.players[0].bases).toEqual(['2,3']);
    expect(duelState.players[1].bases).toEqual(['0,3']);
  });
  it('copies logistics and turn-rule scenario settings into runtime state', () => {
    const state = createGame(
      {
        ...SCENARIOS.convoy,
        rules: {
          logisticsEnabled: true,
          reinforcements: [
            {
              turn: 4,
              playerId: 1,
              ships: [
                {
                  type: 'corvette',
                  position: { q: 1, r: 2 },
                  velocity: { dq: 0, dr: 1 },
                  startLanded: false,
                },
              ],
            },
          ],
          fleetConversion: {
            turn: 6,
            fromPlayer: 0,
            toPlayer: 1,
            shipTypes: ['transport'],
          },
        },
      },
      map,
      'RULES1',
      findBaseHex,
    );

    expect(state.scenarioRules.logisticsEnabled).toBe(true);
    expect(state.scenarioRules.reinforcements).toEqual([
      {
        turn: 4,
        playerId: 1,
        ships: [
          {
            type: 'corvette',
            position: { q: 1, r: 2 },
            velocity: { dq: 0, dr: 1 },
            startLanded: false,
            startInOrbit: undefined,
          },
        ],
      },
    ]);
    expect(state.scenarioRules.fleetConversion).toEqual({
      turn: 6,
      fromPlayer: 0,
      toPlayer: 1,
      shipTypes: ['transport'],
    });
  });
  it('rejects scenarios that do not define exactly two players', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.duel,
      players: [SCENARIOS.duel.players[0]],
    };
    expect(() =>
      createGame(invalidScenario, map, 'BADPLY', findBaseHex),
    ).toThrow('Scenario must define exactly 2 players');
  });
  it('throws when a landed ship has no valid starting hex', () => {
    const barrenMap: SolarSystemMap = {
      hexes: new Map(),
      bodies: [],
      bounds: {
        minQ: -10,
        maxQ: 10,
        minR: -10,
        maxR: 10,
      },
    };
    const invalidScenario: ScenarioDefinition = {
      name: 'Broken',
      description: 'Invalid landed placement',
      players: [
        {
          ships: [
            {
              type: 'corvette',
              position: { q: 99, r: 99 },
              velocity: { dq: 0, dr: 0 },
            },
          ],
          targetBody: '',
          homeBody: '',
          escapeWins: false,
        },
        {
          ships: [
            {
              type: 'corvette',
              position: { q: -99, r: -99 },
              velocity: { dq: 0, dr: 0 },
            },
          ],
          targetBody: '',
          homeBody: '',
          escapeWins: true,
        },
      ],
    };
    expect(() =>
      createGame(invalidScenario, barrenMap, 'BADHEX', findBaseHex),
    ).toThrow('No valid landed starting hex');
  });
});
