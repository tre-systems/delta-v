import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  GameState,
  PlayerState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  type CombatActionDeps,
  queueAttack,
  startCombatTargetWatch,
} from './combat-actions';
import { createInitialPlanningState } from './planning';
import type { GameTransport } from './transport';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
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
  gameId: 'TEST',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'combat',
  activePlayer: 0,
  ships: [
    createShip({ id: 'ship-0', owner: 0, type: 'corvette' }),
    createShip({
      id: 'ship-1',
      owner: 0,
      type: 'corvette',
      position: { q: 0, r: 1 },
    }),
    createShip({
      id: 'enemy-1',
      owner: 1,
      originalOwner: 1,
      type: 'transport',
      position: { q: 1, r: 0 },
    }),
    createShip({
      id: 'enemy-2',
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
  winner: null,
  winReason: null,
  ...overrides,
});

const map: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 4 },
};

const createDeps = (overrides: Partial<CombatActionDeps> = {}) => {
  const planningState = createInitialPlanningState();
  const state = createState();
  const showToast = vi.fn<CombatActionDeps['showToast']>();
  const showAttackButton = vi.fn<CombatActionDeps['showAttackButton']>();
  const showFireButton = vi.fn<CombatActionDeps['showFireButton']>();
  const transport: GameTransport = {
    submitAstrogation: vi.fn(),
    submitCombat: vi.fn(),
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
    showAttackButton,
    showFireButton,
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
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('shows and hides the attack button as combat selection changes', () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { window: globalThis });
    const deps = createDeps();

    const stopWatching = startCombatTargetWatch(deps);

    vi.advanceTimersByTime(100);
    expect(deps.showAttackButton).toHaveBeenLastCalledWith(false);

    deps.planningState.combatTargetId = 'enemy-1';
    vi.advanceTimersByTime(100);
    expect(deps.showAttackButton).toHaveBeenLastCalledWith(true);

    deps.planningState.combatTargetId = null;
    vi.advanceTimersByTime(100);
    expect(deps.showAttackButton).toHaveBeenLastCalledWith(false);

    stopWatching();
  });

  it('stops the combat target watch after leaving the combat client state', () => {
    vi.useFakeTimers();
    Object.assign(globalThis, { window: globalThis });
    let clientState = 'playing_combat';
    const deps = createDeps({
      getClientState: () => clientState,
    });

    startCombatTargetWatch(deps);
    vi.advanceTimersByTime(100);
    expect(deps.showAttackButton).toHaveBeenCalledTimes(1);

    clientState = 'playing_opponentTurn';
    deps.planningState.combatTargetId = 'enemy-1';
    vi.advanceTimersByTime(300);

    expect(deps.showAttackButton).toHaveBeenCalledTimes(1);
  });

  it('queues a selected attack and promotes fire-all once a target exists', () => {
    const deps = createDeps();
    deps.planningState.combatTargetId = 'enemy-1';
    deps.planningState.combatTargetType = 'ship';
    deps.planningState.combatAttackerIds = ['ship-0', 'ship-1'];
    deps.planningState.combatAttackStrength = 1;

    queueAttack(deps);

    expect(deps.showAttackButton).toHaveBeenLastCalledWith(false);
    expect(deps.showFireButton).toHaveBeenLastCalledWith(true, 1);
    expect(deps.showToast).toHaveBeenLastCalledWith(
      'Attack queued (1). Select next target or press Enter to fire.',
      'info',
    );
    expect(deps.planningState.queuedAttacks).toHaveLength(1);
    expect(deps.planningState.combatTargetId).toBeNull();
  });
});
