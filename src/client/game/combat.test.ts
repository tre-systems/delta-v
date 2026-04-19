import { describe, expect, it } from 'vitest';
import { hexKey } from '../../shared/hex';
import { asGameId, asOrdnanceId, asShipId } from '../../shared/ids';
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
  cycleCombatAttackerPlan,
  cycleCombatTargetPlan,
  findPreferredTarget,
  getAttackStrengthForSelection,
  getCombatAttackerIdAtHex,
  getCombatTargetAtHex,
  getLegalCombatAttackers,
  getReusableCombatGroup,
  hasSplitFireOptions,
  hasVisibleCombatTargets,
  listCycleableCombatTargets,
  toggleCombatAttackerSelection,
} from './combat';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'corsair',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
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
  type: 'nuke',
  owner: 1,
  sourceShipId: null,
  position: { q: 1, r: 0 },
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
    createShip({ id: asShipId('a'), owner: 0, type: 'corsair' }),
    createShip({
      id: asShipId('b'),
      owner: 0,
      type: 'corvette',
      position: { q: 0, r: 1 },
    }),
    createShip({
      id: asShipId('x'),
      owner: 1,
      type: 'frigate',
      position: { q: 1, r: 0 },
    }),
    createShip({
      id: asShipId('y'),
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
  outcome: null,
  ...overrides,
});

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
        attackerIds: [asShipId('a'), asShipId('b')],
        targetId: asShipId('x'),
        targetType: 'ship',
        attackStrength: 3,
      },
    ];

    expect(getReusableCombatGroup(state, 0, queuedAttacks, 'y')).toEqual({
      attackerIds: [asShipId('a'), asShipId('b')],
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
      attackerIds: [asShipId('a')],
      targetId: asShipId('x'),
      targetType: 'ship',
      attackStrength: 4,
    });
  });

  it('uses the selected ship as the ship-attack fallback before auto-drafting all legal attackers', () => {
    const state = createState();

    expect(
      buildCurrentAttack(
        state,
        0,
        {
          combatTargetId: 'x',
          combatTargetType: 'ship',
          combatAttackerIds: [],
          combatAttackStrength: null,
          queuedAttacks: [],
        },
        map,
        'b',
      ),
    ).toEqual({
      attackerIds: [asShipId('b')],
      targetId: asShipId('x'),
      targetType: 'ship',
      attackStrength: 2,
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
      attackerIds: [asShipId('a'), asShipId('b')],
      targetId: asOrdnanceId('ord-0'),
      targetType: 'ordnance',
      attackStrength: null,
    });
  });

  it('counts only uncommitted attackers and computes selected strength', () => {
    const state = createState();
    const queuedAttacks: CombatAttack[] = [
      {
        attackerIds: [asShipId('a')],
        targetId: asShipId('x'),
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
        attackerIds: [asShipId('a')],
        targetId: asShipId('x'),
        targetType: 'ship',
        attackStrength: 4,
      },
    ];

    expect(getCombatAttackerIdAtHex(state, 0, { q: 0, r: 1 })).toBe('b');

    expect(
      getCombatTargetAtHex(state, 0, { q: 2, r: 0 }, map, queuedAttacks),
    ).toEqual({
      targetId: asOrdnanceId('ord-0'),
      targetType: 'ordnance',
    });

    expect(getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, map, [])).toEqual({
      targetId: asShipId('x'),
      targetType: 'ship',
    });

    expect(
      getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, map, queuedAttacks),
    ).not.toEqual({
      targetId: asShipId('x'),
      targetType: 'ship',
    });
  });

  it('ignores undetected ships and non-nuke ordnance when choosing combat targets', () => {
    const state = createState({
      ships: [
        createShip({ id: asShipId('a'), owner: 0 }),
        createShip({
          id: asShipId('b'),
          owner: 0,
          position: { q: 0, r: 1 },
        }),
        createShip({
          id: asShipId('x'),
          owner: 1,
          position: { q: 1, r: 0 },
          detected: false,
        }),
      ],
      ordnance: [
        createOrdnance({
          id: asOrdnanceId('mine-0'),
          type: 'mine',
          position: { q: 2, r: 0 },
        }),
      ],
    });

    expect(getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, map, [])).toBeNull();
    expect(getCombatTargetAtHex(state, 0, { q: 2, r: 0 }, map, [])).toBeNull();
    expect(hasVisibleCombatTargets(state, 0, map)).toBe(false);
  });

  it('does not select blocked combat targets that no attacker can shoot', () => {
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
        createShip({ id: asShipId('a'), owner: 0, position: { q: 0, r: 0 } }),
        createShip({
          id: asShipId('x'),
          owner: 1,
          position: { q: 2, r: 0 },
        }),
      ],
      ordnance: [
        createOrdnance({
          id: asOrdnanceId('ord-blocked'),
          position: { q: 2, r: 0 },
        }),
      ],
    });

    expect(
      getCombatTargetAtHex(state, 0, { q: 2, r: 0 }, blockedMap, []),
    ).toBeNull();
  });

  it('cycles through stacked combat attackers on repeated clicks', () => {
    const hex = { q: 0, r: 0 };
    const state = createState({
      ships: [
        createShip({
          id: asShipId('a'),
          owner: 0,
          type: 'corsair',
          position: hex,
        }),
        createShip({
          id: asShipId('b'),
          owner: 0,
          type: 'corvette',
          position: hex,
        }),
        createShip({
          id: asShipId('x'),
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
        attackerIds: [asShipId('a'), asShipId('b')],
        targetId: asShipId('x'),
        targetType: 'ship',
        attackStrength: 3,
      },
    ];

    expect(
      createCombatTargetPlan(
        state,
        0,
        {
          selectedShipId: null,
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

    expect(
      toggleCombatAttackerSelection(state, 0, planning, map, asShipId('b')),
    ).toEqual({
      consumed: true,
      combatAttackerIds: ['a'],
      combatAttackStrength: 4,
    });

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
        asShipId('a'),
      ),
    ).toEqual({
      consumed: true,
      combatAttackerIds: ['a'],
      combatAttackStrength: 4,
    });
  });

  it('cycles keyboard combat targets in stable order', () => {
    const state = createState();
    const targets = listCycleableCombatTargets(state, 0, [], map);
    expect(targets.map((entry) => entry.targetId)).toEqual([
      asShipId('x'),
      asShipId('y'),
    ]);

    const basePlanning = {
      selectedShipId: asShipId('a'),
      combatTargetId: null as string | null,
      combatTargetType: null as 'ship' | 'ordnance' | null,
      combatAttackerIds: [] as string[],
      combatAttackStrength: null as number | null,
      queuedAttacks: [] as CombatAttack[],
    };

    const first = cycleCombatTargetPlan(state, 0, basePlanning, map, 1);
    expect(first?.combatTargetId).toBe(asShipId('x'));
    if (!first) {
      throw new Error('expected combat plan');
    }

    const second = cycleCombatTargetPlan(
      state,
      0,
      { ...basePlanning, ...first },
      map,
      1,
    );
    expect(second?.combatTargetId).toBe(asShipId('y'));
    if (!second) {
      throw new Error('expected combat plan');
    }

    const wrap = cycleCombatTargetPlan(
      state,
      0,
      { ...basePlanning, ...second },
      map,
      1,
    );
    expect(wrap?.combatTargetId).toBe(asShipId('x'));
  });

  it('cycles legal combat attackers for the selected target in both directions', () => {
    const state = createState({
      ships: [
        createShip({
          id: asShipId('a'),
          owner: 0,
          type: 'corsair',
          position: { q: 0, r: 0 },
        }),
        createShip({
          id: asShipId('b'),
          owner: 0,
          type: 'corvette',
          position: { q: 0, r: 0 },
        }),
        createShip({
          id: asShipId('x'),
          owner: 1,
          type: 'frigate',
          position: { q: 1, r: 0 },
        }),
      ],
    });

    const planning = {
      selectedShipId: asShipId('a'),
      combatTargetId: asShipId('x'),
      combatTargetType: 'ship' as const,
      combatAttackerIds: [asShipId('a')],
      combatAttackStrength: 4,
      queuedAttacks: [] as CombatAttack[],
    };

    const next = cycleCombatAttackerPlan(state, 0, planning, map, 1);
    expect(next?.selectedShipId).toBe(asShipId('b'));
    expect(next?.plan.combatAttackerIds).toEqual([asShipId('b')]);
    expect(next?.selectedHex).toEqual({ q: 0, r: 0 });

    const back = cycleCombatAttackerPlan(state, 0, planning, map, -1);
    expect(back?.selectedShipId).toBe(asShipId('b'));
    expect(back?.plan.combatAttackerIds).toEqual([asShipId('b')]);
  });

  it('shares target visibility logic for preferred-target and combat-visible checks', () => {
    const state = createState();

    expect(hasVisibleCombatTargets(state, 0, map)).toBe(true);
    expect(findPreferredTarget(state, 0, 'b', [], map)).toEqual({
      targetId: asShipId('y'),
      targetType: 'ship',
    });

    const stateWithNuke = createState({
      ordnance: [createOrdnance({ position: { q: 0, r: 2 } })],
    });
    const queuedAttacks: CombatAttack[] = [
      {
        attackerIds: [asShipId('b')],
        targetId: asShipId('x'),
        targetType: 'ship',
        attackStrength: 2,
      },
      {
        attackerIds: [asShipId('a')],
        targetId: asShipId('y'),
        targetType: 'ship',
        attackStrength: 4,
      },
    ];

    expect(
      findPreferredTarget(stateWithNuke, 0, 'b', queuedAttacks, map),
    ).toEqual({
      targetId: asOrdnanceId('ord-0'),
      targetType: 'ordnance',
    });
  });

  it('prefers the most hittable target over the nearest one', () => {
    const state = createState({
      ships: [
        createShip({
          id: asShipId('a'),
          owner: 0,
          type: 'frigate',
          position: { q: 0, r: 0 },
          velocity: { dq: 0, dr: 0 },
        }),
        createShip({
          id: asShipId('x'),
          owner: 1,
          type: 'corvette',
          position: { q: 1, r: 0 },
          velocity: { dq: 8, dr: 0 },
        }),
        createShip({
          id: asShipId('y'),
          owner: 1,
          type: 'corvette',
          position: { q: 2, r: 0 },
          velocity: { dq: 0, dr: 0 },
        }),
      ],
      ordnance: [],
    });

    expect(findPreferredTarget(state, 0, 'a', [], map)).toEqual({
      targetId: asShipId('y'),
      targetType: 'ship',
    });
  });
});

describe('getCombatTargetAtHex — stacked cycling', () => {
  it('cycles through multiple enemy ships on same hex', () => {
    const state = createState();

    // Default state has enemy 'x' and 'y' at (1,0)
    const first = getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, map, []);
    expect(first?.targetId).toBe('x');

    const second = getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, map, [], 'x');
    expect(second?.targetId).toBe('y');

    const wrap = getCombatTargetAtHex(state, 0, { q: 1, r: 0 }, map, [], 'y');
    expect(wrap?.targetId).toBe('x');
  });
});

describe('createCombatTargetPlan — explicit attacker selection', () => {
  it('defaults to the selected legal attacker instead of drafting everyone', () => {
    const state = createState();

    const plan = createCombatTargetPlan(
      state,
      0,
      {
        selectedShipId: 'b',
        combatTargetId: null,
        combatTargetType: null,
        combatAttackerIds: [],
        combatAttackStrength: null,
        queuedAttacks: [],
      },
      'x',
      'ship',
      map,
    );

    expect(plan.combatAttackerIds).toEqual(['b']);
    expect(plan.combatAttackStrength).toBe(2);
  });
});
