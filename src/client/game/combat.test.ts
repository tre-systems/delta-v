import { describe, expect, it } from 'vitest';

import type {
  CombatAttack,
  GameState,
  Ordnance,
  PlayerState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  buildCurrentAttack,
  countRemainingCombatAttackers,
  createClearedCombatPlan,
  createCombatTargetPlan,
  getAttackStrengthForSelection,
  getCombatAttackerIdAtHex,
  getCombatTargetAtHex,
  getLegalCombatAttackers,
  getReusableCombatGroup,
  hasSplitFireOptions,
  toggleCombatAttackerSelection,
} from './combat';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-0',
    type: 'corsair',
    owner: 0,
    originalOwner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 20,
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

function createOrdnance(overrides: Partial<Ordnance> = {}): Ordnance {
  return {
    id: 'ord-0',
    type: 'nuke',
    owner: 1,
    sourceShipId: null,
    position: { q: 1, r: 0 },
    velocity: { dq: 0, dr: 0 },
    turnsRemaining: 5,
    destroyed: false,
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
    phase: 'combat',
    activePlayer: 0,
    ships: [
      createShip({ id: 'a', owner: 0, type: 'corsair' }),
      createShip({
        id: 'b',
        owner: 0,
        type: 'corvette',
        position: { q: 0, r: 1 },
      }),
      createShip({
        id: 'x',
        owner: 1,
        type: 'frigate',
        position: { q: 1, r: 0 },
      }),
      createShip({
        id: 'y',
        owner: 1,
        type: 'packet',
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
  };
}

const map: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -1, maxQ: 3, minR: -1, maxR: 3 },
};

describe('game client combat helpers', () => {
  it('reuses a split-fire group against another target in the same hex', () => {
    const state = createState();
    const queuedAttacks: CombatAttack[] = [
      {
        attackerIds: ['a', 'b'],
        targetId: 'x',
        targetType: 'ship',
        attackStrength: 3,
      },
    ];

    expect(getReusableCombatGroup(state, 0, queuedAttacks, 'y')).toEqual({
      attackerIds: ['a', 'b'],
      remainingStrength: 3,
    });

    expect(hasSplitFireOptions(state, 0, queuedAttacks)).toBe(true);
  });

  it('builds a ship attack from selected legal attackers and clamps requested strength', () => {
    const state = createState();

    expect(
      buildCurrentAttack(
        state,
        0,
        {
          combatTargetId: 'x',
          combatTargetType: 'ship',
          combatAttackerIds: ['a'],
          combatAttackStrength: 99,
          queuedAttacks: [],
        },
        map,
      ),
    ).toEqual({
      attackerIds: ['a'],
      targetId: 'x',
      targetType: 'ship',
      attackStrength: 4,
    });
  });

  it('builds an ordnance interception attack against an enemy nuke', () => {
    const state = createState({
      ordnance: [createOrdnance()],
    });

    expect(
      buildCurrentAttack(
        state,
        0,
        {
          combatTargetId: 'ord-0',
          combatTargetType: 'ordnance',
          combatAttackerIds: [],
          combatAttackStrength: null,
          queuedAttacks: [],
        },
        map,
      ),
    ).toEqual({
      attackerIds: ['a', 'b'],
      targetId: 'ord-0',
      targetType: 'ordnance',
      attackStrength: null,
    });
  });

  it('counts only uncommitted attackers and computes selected strength', () => {
    const state = createState();
    const queuedAttacks: CombatAttack[] = [
      {
        attackerIds: ['a'],
        targetId: 'x',
        targetType: 'ship',
        attackStrength: 4,
      },
    ];

    expect(countRemainingCombatAttackers(state, 0, queuedAttacks)).toBe(1);

    expect(getAttackStrengthForSelection(state, ['a', 'b'])).toBe(6);
  });

  it('finds clickable attackers and targets while ignoring queued ships', () => {
    const state = createState({
      ordnance: [createOrdnance({ position: { q: 2, r: 0 } })],
    });
    const queuedAttacks: CombatAttack[] = [
      {
        attackerIds: ['a'],
        targetId: 'x',
        targetType: 'ship',
        attackStrength: 4,
      },
    ];

    expect(getCombatAttackerIdAtHex(state, 0, { q: 0, r: 1 })).toBe('b');

    expect(
      getCombatTargetAtHex(state, 0, { q: 2, r: 0 }, queuedAttacks),
    ).toEqual({
      targetId: 'ord-0',
      targetType: 'ordnance',
    });

    expect(getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, [])).toEqual({
      targetId: 'x',
      targetType: 'ship',
    });

    expect(
      getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, queuedAttacks),
    ).not.toEqual({
      targetId: 'x',
      targetType: 'ship',
    });
  });

  it('cycles through stacked combat attackers on repeated clicks', () => {
    const hex = { q: 0, r: 0 };
    const state = createState({
      ships: [
        createShip({
          id: 'a',
          owner: 0,
          type: 'corsair',
          position: hex,
        }),
        createShip({
          id: 'b',
          owner: 0,
          type: 'corvette',
          position: hex,
        }),
        createShip({
          id: 'x',
          owner: 1,
          type: 'frigate',
          position: { q: 1, r: 0 },
        }),
      ],
    });

    // First click (no selection) picks first
    expect(getCombatAttackerIdAtHex(state, 0, hex)).toBe('a');

    // With 'a' selected, cycles to 'b'
    expect(getCombatAttackerIdAtHex(state, 0, hex, 'a')).toBe('b');

    // With 'b' selected, cycles back to 'a'
    expect(getCombatAttackerIdAtHex(state, 0, hex, 'b')).toBe('a');
  });

  it('creates and clears combat target plans from reusable or legal groups', () => {
    const state = createState();
    const queuedAttacks: CombatAttack[] = [
      {
        attackerIds: ['a', 'b'],
        targetId: 'x',
        targetType: 'ship',
        attackStrength: 3,
      },
    ];

    expect(
      createCombatTargetPlan(
        state,
        0,
        {
          combatTargetId: null,
          combatTargetType: null,
          combatAttackerIds: [],
          combatAttackStrength: null,
          queuedAttacks,
        },
        'y',
        'ship',
        map,
      ),
    ).toEqual({
      combatTargetId: 'y',
      combatTargetType: 'ship',
      combatAttackerIds: ['a', 'b'],
      combatAttackStrength: 3,
    });

    expect(createClearedCombatPlan()).toEqual({
      combatTargetId: null,
      combatTargetType: null,
      combatAttackerIds: [],
      combatAttackStrength: null,
    });
  });

  it('returns legal combat attackers and toggles attacker selection without clearing all', () => {
    const state = createState();
    const planning = {
      combatTargetId: 'x',
      combatTargetType: 'ship' as const,
      combatAttackerIds: ['a', 'b'],
      combatAttackStrength: 6,
      queuedAttacks: [],
    };

    expect(
      getLegalCombatAttackers(
        state,
        0,
        planning.queuedAttacks,
        'x',
        'ship',
        map,
      ).map((ship) => ship.id),
    ).toEqual(['a', 'b']);

    expect(toggleCombatAttackerSelection(state, 0, planning, map, 'b')).toEqual(
      {
        consumed: true,
        combatAttackerIds: ['a'],
        combatAttackStrength: 4,
      },
    );

    expect(
      toggleCombatAttackerSelection(
        state,
        0,
        {
          ...planning,
          combatAttackerIds: ['a'],
          combatAttackStrength: 4,
        },
        map,
        'a',
      ),
    ).toEqual({
      consumed: true,
      combatAttackerIds: ['a'],
      combatAttackStrength: 4,
    });
  });
});

describe('getCombatTargetAtHex — stacked cycling', () => {
  it('cycles through multiple enemy ships on same hex', () => {
    const state = createState();

    // Default state has enemy 'x' and 'y' at (1,0)
    const first = getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, []);
    expect(first?.targetId).toBe('x');

    const second = getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, [], 'x');
    expect(second?.targetId).toBe('y');

    const wrap = getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, [], 'y');
    expect(wrap?.targetId).toBe('x');
  });
});

describe('createCombatTargetPlan — explicit attacker selection', () => {
  it('starts with empty attackers instead of auto-drafting', () => {
    const state = createState();

    const plan = createCombatTargetPlan(
      state,
      0,
      {
        combatTargetId: null,
        combatTargetType: null,
        combatAttackerIds: [],
        combatAttackStrength: null,
        queuedAttacks: [],
      },
      'x',
      'ship',
      null,
    );

    expect(plan.combatAttackerIds).toEqual([]);
    expect(plan.combatAttackStrength).toBeNull();
  });
});
