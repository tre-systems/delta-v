import { beforeEach, describe, expect, it } from 'vitest';
import { SHIP_STATS } from '../constants';
import { hexKey } from '../hex';
import { asGameId } from '../ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { GameState, ScenarioDefinition, SolarSystemMap } from '../types';
import { createGame } from './game-creation';

let map: SolarSystemMap;
let initialState: GameState;
beforeEach(() => {
  map = buildSolarSystemMap();
  const result = createGame(
    SCENARIOS.biplanetary,
    map,
    asGameId('TEST1'),
    findBaseHex,
  );

  if (!result.ok) throw new Error(result.error.message);
  initialState = result.value;
});

describe('createGame', () => {
  it('creates game with correct scenario key', () => {
    expect(initialState.scenario).toBe('biplanetary');
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
    const result = createGame(
      SCENARIOS.duel,
      map,
      asGameId('DUEL1'),
      findBaseHex,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.players[0].bases).toEqual(['2,3']);
    expect(result.value.players[1].bases).toEqual(['0,3']);
  });
  it('copies logistics and turn-rule scenario settings into runtime state', () => {
    const result = createGame(
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
      asGameId('RULES1'),
      findBaseHex,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.value;
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
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADPLY'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(
        'Scenario must define exactly 2 players',
      );
    }
  });
  it('returns error when a landed ship has no valid starting hex', () => {
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
              position: { q: 0, r: 0 },
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
              position: { q: 1, r: 1 },
              velocity: { dq: 0, dr: 0 },
            },
          ],
          targetBody: '',
          homeBody: '',
          escapeWins: true,
        },
      ],
    };
    const result = createGame(
      invalidScenario,
      barrenMap,
      asGameId('BADHEX'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('No valid landed starting hex');
    }
  });
  it('rejects scenarios whose targetBody is not on the map', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.biplanetary,
      players: [
        {
          ...SCENARIOS.biplanetary.players[0],
          targetBody: 'NotARealBody',
        },
        SCENARIOS.biplanetary.players[1],
      ],
    };
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADTGT'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('targetBody');
      expect(result.error.message).toContain('NotARealBody');
    }
  });
  it('rejects scenarios whose sharedBases body has no matching base hexes', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.biplanetary,
      rules: {
        sharedBases: ['Jupiter'],
      },
    };
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADSHR'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('shares bases on "Jupiter"');
    }
  });
  it('rejects scenarios that require passengers without passenger rescue enabled', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.convoy,
      rules: {
        targetWinRequiresPassengers: true,
      },
    };
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADPSG'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('targetWinRequiresPassengers');
    }
  });
  it('rejects scenarios that enable hidden-identity inspection without hidden ships', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.biplanetary,
      rules: {
        hiddenIdentityInspection: true,
      },
    };
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADHID'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('hiddenIdentityInspection');
    }
  });
  it('rejects explicit player bases that are not actual base hexes', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.biplanetary,
      players: [
        {
          ...SCENARIOS.biplanetary.players[0],
          bases: [{ q: 0, r: 0 }],
        },
        SCENARIOS.biplanetary.players[1],
      ],
    };
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADBSE'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('non-base hex');
    }
  });
  it('rejects active ship spawns outside map bounds', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.biplanetary,
      players: [
        {
          ...SCENARIOS.biplanetary.players[0],
          ships: [
            {
              ...SCENARIOS.biplanetary.players[0].ships[0],
              position: { q: 99, r: 99 },
              startLanded: false,
            },
          ],
        },
        SCENARIOS.biplanetary.players[1],
      ],
    };
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADPOS'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('outside map bounds');
    }
  });
  it('rejects active ship spawns on body surfaces', () => {
    const invalidScenario: ScenarioDefinition = {
      ...SCENARIOS.biplanetary,
      players: [
        {
          ...SCENARIOS.biplanetary.players[0],
          ships: [
            {
              ...SCENARIOS.biplanetary.players[0].ships[0],
              position: { ...map.bodies[0].center },
              startLanded: false,
            },
          ],
        },
        SCENARIOS.biplanetary.players[1],
      ],
    };
    const result = createGame(
      invalidScenario,
      map,
      asGameId('BADSUR'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('body surface');
    }
  });
  it('rejects custom maps with overlapping body definitions', () => {
    const overlappingMap: SolarSystemMap = {
      ...map,
      bodies: [
        ...map.bodies,
        {
          ...map.bodies[1],
          name: 'Twin Mercury',
          center: { ...map.bodies[0].center },
        },
      ],
    };
    const result = createGame(
      SCENARIOS.biplanetary,
      overlappingMap,
      asGameId('BADMAP'),
      findBaseHex,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('overlap');
    }
  });
});
