import { describe, expect, it } from 'vitest';

import type { GameState, PlayerState, Ship } from '../../shared/types';
import { getTooltipShip } from './hover';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-0',
    type: 'packet',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 5,
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
      targetBody: 'Mars',
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

function createState(ships: Ship[]): GameState {
  return {
    gameId: 'HOVER',
    scenario: 'test',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'astrogation',
    activePlayer: 0,
    ships,
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: createPlayers(),
    winner: null,
    winReason: null,
  };
}

describe('game-client-hover', () => {
  it('hides tooltips when no state is available or the client state suppresses hover', () => {
    expect(
      getTooltipShip(null, 'playing_astrogation', 0, { q: 0, r: 0 }),
    ).toBeNull();

    expect(
      getTooltipShip(createState([createShip()]), 'menu', 0, { q: 0, r: 0 }),
    ).toBeNull();

    expect(
      getTooltipShip(createState([createShip()]), 'playing_movementAnim', 0, {
        q: 0,
        r: 0,
      }),
    ).toBeNull();
  });

  it('returns visible friendly and detected enemy ships at the hover hex', () => {
    const friendly = createShip();
    const enemy = createShip({
      id: 'enemy',
      owner: 1,
      position: { q: 1, r: 0 },
    });
    const state = createState([friendly, enemy]);

    expect(
      getTooltipShip(state, 'playing_astrogation', 0, { q: 0, r: 0 })?.id,
    ).toBe('ship-0');

    expect(getTooltipShip(state, 'playing_combat', 0, { q: 1, r: 0 })?.id).toBe(
      'enemy',
    );
  });

  it('ignores destroyed and undetected enemy ships', () => {
    const destroyed = createShip({ destroyed: true });
    const hiddenEnemy = createShip({
      id: 'enemy',
      owner: 1,
      detected: false,
      position: { q: 1, r: 0 },
    });
    const state = createState([destroyed, hiddenEnemy]);

    expect(
      getTooltipShip(state, 'playing_astrogation', 0, { q: 0, r: 0 }),
    ).toBeNull();

    expect(
      getTooltipShip(state, 'playing_astrogation', 0, { q: 1, r: 0 }),
    ).toBeNull();
  });
});
