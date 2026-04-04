import { describe, expect, it } from 'vitest';

import { asHexKey } from '../../shared/hex';
import { asGameId, asOrdnanceId, asShipId } from '../../shared/ids';
import type {
  GameState,
  Ordnance,
  PlayerState,
  Ship,
} from '../../shared/types/domain';
import { buildAstrogationOrders } from './astrogation-orders';
import { deriveHudViewModel } from './hud-view-model';
import {
  getGameOverStats,
  getScenarioBriefingLines,
  getSelectedShip,
} from './selection';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'transport',
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

const createOrdnance = (overrides: Partial<Ordnance> = {}): Ordnance => ({
  id: asOrdnanceId('ord-0'),
  type: 'mine',
  owner: 0,
  sourceShipId: null,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  turnsRemaining: 5,
  lifecycle: 'active' as const,
  ...overrides,
});

const createPlayers = (): [PlayerState, PlayerState] => [
  {
    connected: true,
    ready: true,
    targetBody: '',
    homeBody: 'Terra',
    bases: [asHexKey('0,0')],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: 'Mars',
    homeBody: 'Mars',
    bases: [asHexKey('1,1')],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('TEST'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 3,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip({
      id: asShipId('p0s0'),
      type: 'packet',
      cargoUsed: 10,
    }),
    createShip({
      id: asShipId('p0s1'),
      type: 'transport',
      owner: 0,
      position: { q: 1, r: 0 },
    }),
    createShip({
      id: asShipId('p1s0'),
      type: 'corsair',
      owner: 1,
      position: { q: 5, r: 0 },
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

describe('getSelectedShip', () => {
  it('returns the ship matching selectedId', () => {
    const state = createState();

    expect(getSelectedShip(state, 0, 'p0s0')?.id).toBe('p0s0');
    expect(getSelectedShip(state, 0, 'p0s1')?.id).toBe('p0s1');
  });

  it('auto-selects when exactly one alive ship and selectedId is null', () => {
    const state = createState({
      ships: [
        createShip({ id: asShipId('sole'), owner: 0 }),
        createShip({ id: asShipId('enemy'), owner: 1 }),
      ],
    });

    expect(getSelectedShip(state, 0, null)?.id).toBe('sole');
  });

  it('returns null when multiple alive ships and selectedId is null', () => {
    const state = createState();

    expect(getSelectedShip(state, 0, null)).toBeNull();
  });

  it('returns null when selectedId is stale and multiple alive ships exist', () => {
    const state = createState();

    expect(getSelectedShip(state, 0, 'nonexistent')).toBeNull();
  });

  it('auto-selects when selectedId is stale and exactly one alive ship', () => {
    const state = createState({
      ships: [
        createShip({ id: asShipId('alive'), owner: 0 }),
        createShip({
          id: asShipId('dead'),
          owner: 0,
          lifecycle: 'destroyed',
        }),
        createShip({ id: asShipId('enemy'), owner: 1 }),
      ],
    });

    expect(getSelectedShip(state, 0, 'nonexistent')?.id).toBe('alive');
  });

  it('lets spectators resolve a selected ship across both fleets', () => {
    const state = createState();

    expect(getSelectedShip(state, -1, 'p1s0')?.id).toBe('p1s0');
  });
});

describe('game client helpers', () => {
  it('builds astrogation orders for the active player only', () => {
    const state = createState();
    const planning = {
      selectedShipId: 'p0s0',
      burns: new Map([
        ['p0s0', 2],
        ['p0s1', null],
        ['p1s0', 5],
      ]),
      overloads: new Map([['p0s0', 4]]),
      weakGravityChoices: new Map([['p0s0', { '2,1': true }]]),
      landingShips: new Set<string>(),
      acknowledgedShips: new Set<string>(),
      acknowledgedOrdnanceShips: new Set<string>(),
      queuedOrdnanceLaunches: [],
    };

    expect(buildAstrogationOrders(state, 0, planning)).toEqual([
      {
        shipId: asShipId('p0s0'),
        burn: 2,
        overload: 4,
        weakGravityChoices: { '2,1': true },
      },
      {
        shipId: asShipId('p0s1'),
        burn: null,
        overload: null,
      },
    ]);
  });

  it('derives HUD state for hidden-identity escape play', () => {
    const state = createState({
      phase: 'ordnance',
      ships: [
        createShip({
          id: asShipId('p0s0'),
          type: 'frigate',
          fuel: 14,
          cargoUsed: 20,
          baseStatus: 'carryingBase',
          identity: { hasFugitives: true, revealed: false },
        }),
        createShip({
          id: asShipId('p0s1'),
          type: 'packet',
          owner: 0,
          lifecycle: 'destroyed',
        }),
        createShip({
          id: asShipId('p1s0'),
          type: 'corsair',
          owner: 1,
          lifecycle: 'destroyed',
        }),
      ],
      ordnance: [
        createOrdnance({ type: 'mine' }),
        createOrdnance({
          id: asOrdnanceId('ord-1'),
          type: 'nuke',
          owner: 1,
        }),
      ],
      players: [
        {
          ...createPlayers()[0],
          escapeWins: true,
        },
        createPlayers()[1],
      ],
      pendingAstrogationOrders: [
        { shipId: asShipId('p0s0'), burn: 1, overload: null },
      ],
    });

    const planning = {
      selectedShipId: 'p0s0',
      burns: new Map([['p0s0', 1]]),
      overloads: new Map(),
      weakGravityChoices: new Map(),
      landingShips: new Set<string>(),
      acknowledgedShips: new Set<string>(),
      acknowledgedOrdnanceShips: new Set<string>(),
      queuedOrdnanceLaunches: [],
    };

    expect(deriveHudViewModel(state, 0, planning)).toMatchObject({
      turn: 3,
      phase: 'ordnance',
      isMyTurn: true,
      selectedId: 'p0s0',
      fuel: 14,
      maxFuel: 20,
      hasBurns: true,
      cargoFree: 20,
      cargoMax: 40,
      objective: '⬡ Fly ★ ship off the map edge',
      canOverload: true,
      canEmplaceBase: true,
      fleetStatus: '⚔ 1 vs 0 1M/1N',
      launchMineState: {
        visible: true,
        disabled: false,
        title: '',
      },
      launchTorpedoState: {
        visible: true,
        disabled: false,
        title: '',
      },
      launchNukeState: {
        visible: true,
        disabled: false,
        title: '',
      },
    });
  });

  it('hides disallowed ordnance buttons and disables illegal launches', () => {
    const state = createState({
      phase: 'ordnance',
      scenarioRules: {
        allowedOrdnanceTypes: ['nuke'],
      },
      ships: [
        createShip({
          id: asShipId('p0s0'),
          type: 'corsair',
          cargoUsed: 0,
        }),
        createShip({
          id: asShipId('p1s0'),
          type: 'corsair',
          owner: 1,
          lifecycle: 'destroyed',
        }),
      ],
    });

    const planning = {
      selectedShipId: 'p0s0',
      burns: new Map(),
      overloads: new Map(),
      weakGravityChoices: new Map(),
      landingShips: new Set<string>(),
      acknowledgedShips: new Set<string>(),
      acknowledgedOrdnanceShips: new Set<string>(),
      queuedOrdnanceLaunches: [],
    };

    expect(deriveHudViewModel(state, 0, planning)).toMatchObject({
      launchMineState: {
        visible: false,
        disabled: true,
        title: '',
      },
      launchTorpedoState: {
        visible: false,
        disabled: true,
        title: '',
      },
      launchNukeState: {
        visible: true,
        disabled: true,
        title: 'Not enough cargo (need 20, have 10)',
      },
    });
  });

  it('computes game-over ship counts from the final state', () => {
    const state = createState({
      phase: 'gameOver',
      ships: [
        createShip({
          id: asShipId('p0s0'),
          owner: 0,
        }),
        createShip({
          id: asShipId('p0s1'),
          owner: 0,
          lifecycle: 'destroyed',
        }),
        createShip({
          id: asShipId('p1s0'),
          owner: 1,
          lifecycle: 'destroyed',
        }),
      ],
    });

    expect(getGameOverStats(state, 0)).toEqual({
      playerId: 0,
      scenario: 'biplanetary',
      turns: 3,
      myShipsAlive: 1,
      myShipsTotal: 2,
      enemyShipsAlive: 0,
      enemyShipsTotal: 1,
      myShipsDestroyed: 1,
      enemyShipsDestroyed: 1,
      myFuelSpent: 0,
      enemyFuelSpent: 0,
      basesDestroyed: 0,
      ordnanceInFlight: 0,
      shipFates: [
        {
          id: asShipId('p0s0'),
          name: 'Transport 1',
          type: 'transport',
          status: 'survived',
          owner: 0,
          deathCause: undefined,
          killedBy: undefined,
        },
        {
          id: asShipId('p0s1'),
          name: 'Transport 2',
          type: 'transport',
          status: 'destroyed',
          owner: 0,
          deathCause: undefined,
          killedBy: undefined,
        },
        {
          id: asShipId('p1s0'),
          name: 'Transport',
          type: 'transport',
          status: 'destroyed',
          owner: 1,
          deathCause: undefined,
          killedBy: undefined,
        },
      ],
    });
  });

  it('builds spectator HUD and game-over stats from the global state', () => {
    const state = createState({
      phase: 'gameOver',
      ships: [
        createShip({ id: asShipId('p0s0'), owner: 0, type: 'transport' }),
        createShip({
          id: asShipId('p0s1'),
          owner: 0,
          type: 'packet',
          lifecycle: 'destroyed',
        }),
        createShip({ id: asShipId('p1s0'), owner: 1, type: 'corsair' }),
      ],
      players: [
        { ...createPlayers()[0], totalFuelSpent: 7 },
        { ...createPlayers()[1], totalFuelSpent: 11 },
      ],
    });

    const planning = {
      selectedShipId: 'p1s0',
      burns: new Map(),
      overloads: new Map(),
      weakGravityChoices: new Map(),
      landingShips: new Set<string>(),
      acknowledgedShips: new Set<string>(),
      acknowledgedOrdnanceShips: new Set<string>(),
      queuedOrdnanceLaunches: [],
    };

    expect(deriveHudViewModel(state, -1, planning)).toMatchObject({
      objective: '⬡ Spectating',
      fleetStatus: '👁 Spectating · 1 vs 1',
      myShips: [
        expect.objectContaining({ id: 'p0s0' }),
        expect.objectContaining({ id: 'p0s1' }),
        expect.objectContaining({ id: 'p1s0' }),
      ],
      selectedId: 'p1s0',
    });

    expect(getGameOverStats(state, -1)).toMatchObject({
      playerId: -1,
      myShipsAlive: 1,
      myShipsTotal: 2,
      enemyShipsAlive: 1,
      enemyShipsTotal: 1,
      myFuelSpent: 7,
      enemyFuelSpent: 11,
    });
  });

  it('builds scenario briefing lines from player perspective', () => {
    const state = createState({
      ships: [
        createShip({
          id: asShipId('p0s0'),
          owner: 0,
          type: 'transport',
        }),
        createShip({
          id: asShipId('p0s1'),
          owner: 0,
          type: 'packet',
        }),
        createShip({
          id: asShipId('p1s0'),
          owner: 1,
          type: 'corsair',
        }),
      ],
      players: [
        {
          ...createPlayers()[0],
          targetBody: 'Venus',
        },
        createPlayers()[1],
      ],
    });

    expect(getScenarioBriefingLines(state, 0)).toEqual([
      'Your fleet: Transport, Packet',
    ]);
  });
});
