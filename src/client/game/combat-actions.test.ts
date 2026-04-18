import { afterEach, describe, expect, it, vi } from 'vitest';
import { hexKey } from '../../shared/hex';
import { asGameId, asShipId } from '../../shared/ids';
import type {
  GameState,
  PlayerState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  advanceToNextAttacker,
  autoSkipCombatIfNoTargets,
  type CombatActionDeps,
  confirmSingleAttack,
  queueAttack,
} from './combat-actions';
import { createPlanningStore } from './planning';
import type { GameTransport } from './transport';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active',
  control: 'own',
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
  phase: 'combat',
  activePlayer: 0,
  ships: [
    createShip({ id: asShipId('ship-0'), owner: 0, type: 'corvette' }),
    createShip({
      id: asShipId('ship-1'),
      owner: 0,
      type: 'corvette',
      position: { q: 0, r: 1 },
    }),
    createShip({
      id: asShipId('enemy-1'),
      owner: 1,
      originalOwner: 1,
      type: 'transport',
      position: { q: 1, r: 0 },
    }),
    createShip({
      id: asShipId('enemy-2'),
      owner: 1,
      originalOwner: 1,
      type: 'transport',
      position: { q: 1, r: 0 },
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

const map: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 4 },
};

const createDeps = (overrides: Partial<CombatActionDeps> = {}) => {
  const planningState = createPlanningStore();
  const state = createState();
  const showToast = vi.fn<CombatActionDeps['showToast']>();
  const transport: GameTransport = {
    submitAstrogation: vi.fn(),
    submitCombat: vi.fn(),
    submitSingleCombat: vi.fn(),
    endCombat: vi.fn(),
    submitOrdnance: vi.fn(),
    submitEmplacement: vi.fn(),
    submitFleetReady: vi.fn(),
    submitLogistics: vi.fn(),
    submitSurrender: vi.fn(),
    skipOrdnance: vi.fn(),
    skipCombat: vi.fn(),
    skipLogistics: vi.fn(),
    beginCombat: vi.fn(),
    requestRematch: vi.fn(),
    sendChat: vi.fn(),
  };
  const deps = {
    getGameState: () => state,
    getClientState: () => 'playing_combat',
    getPlayerId: () => 0,
    getTransport: () => transport,
    getMap: () => map,
    planningState,
    showToast,
  } satisfies CombatActionDeps;

  return {
    ...deps,
    ...overrides,
    transport,
  };
};

describe('combat action helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-skips combat when no visible targets exist', () => {
    const noTargetsState = createState({
      ships: [
        createShip({ id: asShipId('ship-0'), owner: 0, type: 'corvette' }),
        createShip({
          id: asShipId('ship-1'),
          owner: 0,
          type: 'corvette',
          position: { q: 0, r: 1 },
        }),
        createShip({
          id: asShipId('enemy-1'),
          owner: 1,
          originalOwner: 1,
          type: 'transport',
          position: { q: 4, r: 4 },
          detected: false,
        }),
      ],
    });
    const deps = createDeps({
      getGameState: () => noTargetsState,
    });

    autoSkipCombatIfNoTargets(deps);

    expect(deps.transport.skipCombat).toHaveBeenCalledTimes(1);
  });

  it('does not auto-skip combat when a visible target exists', () => {
    const deps = createDeps();

    autoSkipCombatIfNoTargets(deps);

    expect(deps.transport.skipCombat).not.toHaveBeenCalled();
  });

  it('advances to the next attacker that actually has a visible target', () => {
    vi.useFakeTimers();
    const blockedMap: SolarSystemMap = {
      ...map,
      hexes: new Map([
        [
          hexKey({ q: 1, r: 0 }),
          {
            terrain: 'planetSurface',
            body: {
              name: 'Mars',
              destructive: true,
            },
          },
        ],
      ]),
    };
    const state = createState({
      ships: [
        createShip({
          id: asShipId('ship-0'),
          owner: 0,
          position: { q: 0, r: 0 },
        }),
        createShip({
          id: asShipId('ship-1'),
          owner: 0,
          position: { q: 0, r: 1 },
        }),
        createShip({
          id: asShipId('enemy-1'),
          owner: 1,
          originalOwner: 1,
          position: { q: 2, r: 0 },
        }),
      ],
    });
    const deps = createDeps({
      getGameState: () => state,
      getMap: () => blockedMap,
    });

    advanceToNextAttacker(deps);
    vi.runAllTimers();

    expect(deps.planningState.selectedShipId).toBe('ship-1');
    expect(deps.planningState.combatTargetId).toBe('enemy-1');
  });

  it('does not end combat when confirm is pressed on a blocked target', () => {
    const blockedMap: SolarSystemMap = {
      ...map,
      hexes: new Map([
        [
          hexKey({ q: 1, r: 0 }),
          {
            terrain: 'planetSurface',
            body: {
              name: 'Mars',
              destructive: true,
            },
          },
        ],
      ]),
    };
    const state = createState({
      ships: [
        createShip({
          id: asShipId('ship-0'),
          owner: 0,
          position: { q: 0, r: 0 },
        }),
        createShip({
          id: asShipId('enemy-1'),
          owner: 1,
          originalOwner: 1,
          position: { q: 2, r: 0 },
        }),
      ],
    });
    const deps = createDeps({
      getGameState: () => state,
      getMap: () => blockedMap,
    });
    deps.planningState.selectedShipId = 'ship-0';
    deps.planningState.combatTargetId = 'enemy-1';
    deps.planningState.combatTargetType = 'ship';

    confirmSingleAttack(deps);

    expect(deps.transport.endCombat).not.toHaveBeenCalled();
    expect(deps.transport.submitSingleCombat).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenLastCalledWith(
      'Selected target is blocked or has no legal attackers',
      'error',
    );
  });

  it('queues a selected attack and promotes fire-all once a target exists', () => {
    const deps = createDeps();
    deps.planningState.combatTargetId = 'enemy-1';
    deps.planningState.combatTargetType = 'ship';
    deps.planningState.combatAttackerIds = ['ship-0', 'ship-1'];
    deps.planningState.combatAttackStrength = 1;

    queueAttack(deps);

    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.planningState.queuedAttacks).toHaveLength(1);
    expect(deps.planningState.combatTargetId).toBeNull();
  });
});
