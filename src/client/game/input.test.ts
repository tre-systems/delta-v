import { describe, expect, it } from 'vitest';

import { HEX_DIRECTIONS, hexAdd, hexKey } from '../../shared/hex';
import { asGameId, asShipId } from '../../shared/ids';
import { buildSolarSystemMap } from '../../shared/map-data';
import type {
  GameState,
  PlayerState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { resolveAstrogationClick, resolveOrdnanceClick } from './input';
import type { PlanningState } from './planning';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'frigate',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createPlayers = (): [PlayerState, PlayerState] => [
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

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('TEST'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip(),
    createShip({
      id: asShipId('ship-1'),
      owner: 1,
      originalOwner: 0,
      position: { q: 2, r: 0 },
    }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  outcome: null,
  ...overrides,
});

const createPlanning = (
  overrides: Partial<PlanningState> = {},
): PlanningState => ({
  selectedShipId: null,
  burns: new Map(),
  overloads: new Map(),
  weakGravityChoices: new Map(),
  landingShips: new Set<string>(),
  torpedoAimingActive: false,
  torpedoAccel: null,
  torpedoAccelSteps: null,
  combatTargetId: null,
  combatTargetType: null,
  combatAttackerIds: [],
  combatAttackStrength: null,
  queuedAttacks: [],
  acknowledgedShips: new Set<string>(),
  queuedOrdnanceLaunches: [],
  acknowledgedOrdnanceShips: new Set<string>(),
  hoverHex: null,
  lastSelectedHex: null,
  ...overrides,
});

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
      shipId: asShipId('ship-0'),
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
      shipId: asShipId('ship-0'),
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
      shipId: asShipId('ship-0'),
      direction: 1,
    });
  });

  it('toggles weak gravity choices before other astrogation interactions', () => {
    const map = buildSolarSystemMap();
    const weakHex = { q: 10, r: -7 };
    const state = createState({
      ships: [
        createShip({
          position: { q: 9, r: -7 },
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
      shipId: asShipId('ship-0'),
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
        createPlanning({
          selectedShipId: 'ship-0',
          torpedoAimingActive: true,
        }),
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
          torpedoAimingActive: true,
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

  it('arms torpedo aim from an adjacent hex click when a torpedo-capable ship is selected', () => {
    const state = createState({ phase: 'ordnance' });
    const clickHex = hexAdd({ q: 0, r: 0 }, HEX_DIRECTIONS[0]);

    // No "aiming mode" gate anymore: clicking an adjacent halo while a
    // corvette/frigate is selected sets the boost direction directly.
    expect(
      resolveOrdnanceClick(
        state,
        0,
        createPlanning({ selectedShipId: 'ship-0' }),
        clickHex,
      ),
    ).toMatchObject({ type: 'torpedoAccel' });
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
      shipId: asShipId('ship-0'),
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
          id: asShipId('ship-a'),
          owner: 0,
          originalOwner: 0,
          position: hex,
        }),
        createShip({
          id: asShipId('ship-b'),
          owner: 0,
          originalOwner: 0,
          position: hex,
        }),
        createShip({
          id: asShipId('enemy'),
          owner: 1,
          originalOwner: 0,
          position: { q: 5, r: 0 },
        }),
      ],
    });

    // First click selects first ship
    expect(
      resolveAstrogationClick(state, simpleMap, 0, createPlanning(), hex),
    ).toEqual({
      type: 'selectShip',
      shipId: asShipId('ship-a'),
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
      shipId: asShipId('ship-b'),
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
      shipId: asShipId('ship-a'),
    });
  });
});

describe('fleet selection and steering', () => {
  // Two own ships: one at the origin, one two hexes east.
  const twoOwnShipsState = () =>
    createState({
      ships: [
        createShip({
          id: asShipId('own-0'),
          owner: 0,
          position: { q: 0, r: 0 },
        }),
        createShip({
          id: asShipId('own-1'),
          owner: 0,
          position: { q: 2, r: 0 },
        }),
      ],
    });

  it('shift-click toggles the clicked hex ships into the group', () => {
    const state = twoOwnShipsState();
    expect(
      resolveAstrogationClick(
        state,
        simpleMap,
        0,
        createPlanning(),
        { q: 0, r: 0 },
        true,
      ),
    ).toEqual({ type: 'toggleHexSelection', shipIds: [asShipId('own-0')] });
  });

  it('shift-click on empty space toggles an empty set', () => {
    const state = twoOwnShipsState();
    expect(
      resolveAstrogationClick(
        state,
        simpleMap,
        0,
        createPlanning(),
        { q: 4, r: 4 },
        true,
      ),
    ).toEqual({ type: 'toggleHexSelection', shipIds: [] });
  });

  it('steers the fleet when a group of 2+ clicks a non-ship hex', () => {
    const state = twoOwnShipsState();
    const planning = createPlanning({
      selectedShipId: 'own-1',
      selectedShipIds: new Set(['own-0', 'own-1']),
    });
    expect(
      resolveAstrogationClick(state, simpleMap, 0, planning, { q: 3, r: 0 }),
    ).toEqual({ type: 'steerFleet', targetHex: { q: 3, r: 0 } });
  });

  it('clicking an own ship in fleet mode collapses to a single select', () => {
    const state = twoOwnShipsState();
    const planning = createPlanning({
      selectedShipId: 'own-1',
      selectedShipIds: new Set(['own-0', 'own-1']),
    });
    expect(
      resolveAstrogationClick(state, simpleMap, 0, planning, { q: 0, r: 0 }),
    ).toEqual({ type: 'selectShip', shipId: asShipId('own-0') });
  });

  it('does not steer with a single-ship group (normal mode)', () => {
    const state = twoOwnShipsState();
    const planning = createPlanning({
      selectedShipId: 'own-0',
      selectedShipIds: new Set(['own-0']),
    });
    // One-ship group is normal selection: an empty-hex click clears.
    expect(
      resolveAstrogationClick(state, simpleMap, 0, planning, { q: 5, r: 5 }),
    ).toEqual({ type: 'clearSelection' });
  });
});
