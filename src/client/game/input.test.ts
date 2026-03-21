import { describe, expect, it } from 'vitest';

import { HEX_DIRECTIONS, hexAdd, hexKey } from '../../shared/hex';
import { buildSolarSystemMap } from '../../shared/map-data';
import type {
  GameState,
  PlayerState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { resolveAstrogationClick, resolveOrdnanceClick } from './input';
import type { PlanningState } from './planning';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-0',
    type: 'corvette',
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
      targetBody: '',
      homeBody: 'Terra',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ];
}

function createState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'TEST',
    scenario: 'test',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'astrogation',
    activePlayer: 0,
    ships: [
      createShip(),
      createShip({
        id: 'ship-1',
        owner: 1,
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

function createPlanning(overrides: Partial<PlanningState> = {}): PlanningState {
  return {
    selectedShipId: null,
    burns: new Map(),
    overloads: new Map(),
    weakGravityChoices: new Map(),
    torpedoAccel: null,
    torpedoAccelSteps: null,
    combatTargetId: null,
    combatTargetType: null,
    combatAttackerIds: [],
    combatAttackStrength: null,
    queuedAttacks: [],
    hoverHex: null,
    lastSelectedHex: null,
    ...overrides,
  };
}

const simpleMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 4 },
};

describe('game client input helpers', () => {
  it('selects an owned ship during astrogation', () => {
    const state = createState();

    expect(
      resolveAstrogationClick(state, simpleMap, 0, createPlanning(), {
        q: 0,
        r: 0,
      }),
    ).toEqual({
      type: 'selectShip',
      shipId: 'ship-0',
    });
  });

  it('clears astrogation selection when clicking empty space', () => {
    const state = createState();

    expect(
      resolveAstrogationClick(
        state,
        simpleMap,
        0,
        createPlanning({ selectedShipId: 'ship-0' }),
        { q: 9, r: 9 },
      ),
    ).toEqual({ type: 'clearSelection' });
  });

  it('toggles a burn from the selected ship destination ring', () => {
    const state = createState();
    const clickHex = hexAdd({ q: 0, r: 0 }, HEX_DIRECTIONS[0]);

    expect(
      resolveAstrogationClick(
        state,
        simpleMap,
        0,
        createPlanning({ selectedShipId: 'ship-0' }),
        clickHex,
      ),
    ).toEqual({
      type: 'burnToggle',
      shipId: 'ship-0',
      direction: 0,
      clearOverload: true,
    });
  });

  it('toggles overload from the burn destination ring for warships', () => {
    const state = createState();
    const burnDestination = hexAdd({ q: 0, r: 0 }, HEX_DIRECTIONS[0]);
    const clickHex = hexAdd(burnDestination, HEX_DIRECTIONS[1]);

    expect(
      resolveAstrogationClick(
        state,
        simpleMap,
        0,
        createPlanning({
          selectedShipId: 'ship-0',
          burns: new Map([['ship-0', 0]]),
        }),
        clickHex,
      ),
    ).toEqual({
      type: 'overloadToggle',
      shipId: 'ship-0',
      direction: 1,
    });
  });

  it('toggles weak gravity choices before other astrogation interactions', () => {
    const map = buildSolarSystemMap();
    const weakHex = { q: 15, r: -10 };
    const state = createState({
      ships: [
        createShip({
          position: { q: 14, r: -10 },
          velocity: { dq: 1, dr: 0 },
        }),
      ],
    });

    const interaction = resolveAstrogationClick(
      state,
      map,
      0,
      createPlanning({ selectedShipId: 'ship-0' }),
      weakHex,
    );

    expect(interaction).toEqual({
      type: 'weakGravityToggle',
      shipId: 'ship-0',
      choices: { [hexKey(weakHex)]: true },
    });
  });

  it('cycles torpedo acceleration for ordnance clicks around the selected ship', () => {
    const state = createState({ phase: 'ordnance' });
    const clickHex = hexAdd({ q: 0, r: 0 }, HEX_DIRECTIONS[0]);

    expect(
      resolveOrdnanceClick(
        state,
        0,
        createPlanning({ selectedShipId: 'ship-0' }),
        clickHex,
      ),
    ).toEqual({
      type: 'torpedoAccel',
      torpedoAccel: 0,
      torpedoAccelSteps: 1,
    });

    expect(
      resolveOrdnanceClick(
        state,
        0,
        createPlanning({
          selectedShipId: 'ship-0',
          torpedoAccel: 0,
          torpedoAccelSteps: 1,
        }),
        clickHex,
      ),
    ).toEqual({
      type: 'torpedoAccel',
      torpedoAccel: 0,
      torpedoAccelSteps: 2,
    });
  });

  it('selects an operational ship during ordnance and clears pending torpedo accel', () => {
    const state = createState({ phase: 'ordnance' });

    expect(
      resolveOrdnanceClick(
        state,
        0,
        createPlanning({
          torpedoAccel: 2,
          torpedoAccelSteps: 2,
        }),
        { q: 0, r: 0 },
      ),
    ).toEqual({
      type: 'selectShip',
      shipId: 'ship-0',
      clearTorpedoAccel: true,
    });
  });

  it('ignores disabled ships during ordnance reselection', () => {
    const state = createState({
      phase: 'ordnance',
      ships: [createShip({ damage: { disabledTurns: 1 } })],
    });

    expect(
      resolveOrdnanceClick(state, 0, createPlanning(), { q: 0, r: 0 }),
    ).toEqual({ type: 'none' });
  });

  it('cycles through stacked ships on repeated astrogation clicks', () => {
    const hex = { q: 0, r: 0 };
    const state = createState({
      ships: [
        createShip({
          id: 'ship-a',
          owner: 0,
          position: hex,
        }),
        createShip({
          id: 'ship-b',
          owner: 0,
          position: hex,
        }),
        createShip({
          id: 'enemy',
          owner: 1,
          position: { q: 5, r: 0 },
        }),
      ],
    });

    // First click selects first ship
    expect(
      resolveAstrogationClick(state, simpleMap, 0, createPlanning(), hex),
    ).toEqual({
      type: 'selectShip',
      shipId: 'ship-a',
    });

    // Second click with ship-a selected at same hex cycles to ship-b
    expect(
      resolveAstrogationClick(
        state,
        simpleMap,
        0,
        createPlanning({
          selectedShipId: 'ship-a',
          lastSelectedHex: hexKey(hex),
        }),
        hex,
      ),
    ).toEqual({
      type: 'selectShip',
      shipId: 'ship-b',
    });

    // Third click cycles back to ship-a
    expect(
      resolveAstrogationClick(
        state,
        simpleMap,
        0,
        createPlanning({
          selectedShipId: 'ship-b',
          lastSelectedHex: hexKey(hex),
        }),
        hex,
      ),
    ).toEqual({
      type: 'selectShip',
      shipId: 'ship-a',
    });
  });
});
