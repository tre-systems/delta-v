import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { deriveScenarioBriefingEntries } from './briefing';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-0',
    type: 'transport',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 10,
    cargoUsed: 0,
    nukesLaunchedSinceResupply: 0,
    resuppliedThisTurn: false,
    landed: false,
    destroyed: false,
    detected: true,
    damage: { disabledTurns: 0 },
    ...overrides,
  };
}

function createPlayers(): [PlayerState, PlayerState] {
  return [
    {
      connected: true,
      ready: true,
      targetBody: 'Venus',
      homeBody: 'Terra',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Terra',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ];
}

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'BRIEF',
    scenario: 'test',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'astrogation',
    activePlayer: 0,
    ships: [
      createShip({ id: 'transport', type: 'transport' }),
      createShip({
        id: 'packet',
        type: 'packet',
        position: { q: 1, r: 0 },
      }),
      createShip({
        id: 'enemy',
        owner: 1,
        type: 'corsair',
        position: { q: 2, r: 0 },
      }),
    ],
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: createPlayers(),
    winner: null,
    winReason: null,
    ...overrides,
  };
}

describe('game-client-briefing', () => {
  it('classifies landing and neutral briefing lines', () => {
    expect(deriveScenarioBriefingEntries(createState(), 0)).toEqual([
      { text: 'Your fleet: Transport, Packet', cssClass: '' },
      { text: 'Objective: Land on Venus', cssClass: 'log-landed' },
      { text: 'Press ? for controls help', cssClass: '' },
    ]);
  });

  it('classifies escape and hidden-identity objective variants', () => {
    expect(
      deriveScenarioBriefingEntries(
        createState({
          ships: [
            createShip({ hasFugitives: true }),
            createShip({ id: 'enemy', owner: 1 }),
          ],
        }),
        0,
      )[1],
    ).toEqual({
      text: 'Objective: Get the ★ ship off the map!',
      cssClass: 'log-landed',
    });

    expect(
      deriveScenarioBriefingEntries(
        createState({
          scenarioRules: { hiddenIdentityInspection: true },
          players: [
            { ...createPlayers()[0], targetBody: '' },
            createPlayers()[1],
          ],
        }),
        0,
      )[1],
    ).toEqual({
      text: 'Objective: Inspect transports, then capture or destroy the fugitives.',
      cssClass: 'log-damage',
    });
  });
});
