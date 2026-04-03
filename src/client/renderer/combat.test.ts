import { describe, expect, it } from 'vitest';

import type {
  CombatAttack,
  CombatResult,
  GameState,
  Ordnance,
  PlayerState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  type CombatOverlayPlanningState,
  formatCombatResult,
  getCombatOverlayHighlights,
  getCombatPreview,
  getCombatTargetEntity,
  getQueuedCombatOverlayAttacks,
} from './combat';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
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
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createOrdnance = (overrides: Partial<Ordnance> = {}): Ordnance => ({
  id: 'ord-0',
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
  gameId: 'TEST',
  scenario: 'biplanetary',
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
      position: { q: 1, r: 1 },
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
  overrides: Partial<CombatOverlayPlanningState> = {},
): CombatOverlayPlanningState => ({
  combatTargetId: null,
  combatTargetType: null,
  combatAttackerIds: [],
  combatAttackStrength: null,
  queuedAttacks: [],
  ...overrides,
});

const map: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 4 },
};

describe('renderer combat helpers', () => {
  it('resolves queued attack overlays for ship and ordnance targets', () => {
    const state = createState({
      ordnance: [createOrdnance()],
    });

    const queuedAttacks: CombatAttack[] = [
      {
        attackerIds: ['a', 'missing'],
        targetId: 'x',
        targetType: 'ship',
        attackStrength: 4,
      },
      {
        attackerIds: ['b'],
        targetId: 'ord-0',
        targetType: 'ordnance',
        attackStrength: null,
      },
    ];

    expect(getQueuedCombatOverlayAttacks(state, queuedAttacks)).toEqual([
      {
        targetPosition: { q: 1, r: 0 },
        attackerPositions: [{ q: 0, r: 0 }],
      },
      {
        targetPosition: { q: 1, r: 0 },
        attackerPositions: [{ q: 0, r: 1 }],
      },
    ]);
  });

  it('builds highlight targets from unqueued enemies and visible nukes', () => {
    const state = createState({
      ordnance: [createOrdnance()],
    });

    const planning = createPlanning({
      combatTargetId: 'ord-0',
      combatTargetType: 'ordnance',
      queuedAttacks: [
        {
          attackerIds: ['a'],
          targetId: 'x',
          targetType: 'ship',
          attackStrength: 4,
        },
      ],
    });

    expect(getCombatOverlayHighlights(state, 0, planning, map)).toEqual({
      shipTargets: [{ position: { q: 1, r: 1 }, isSelected: false }],
      ordnanceTargets: [{ position: { q: 1, r: 0 }, isSelected: true }],
    });
  });

  it('builds a ship combat preview with counterattack information', () => {
    const state = createState();

    const planning = createPlanning({
      combatTargetId: 'x',
      combatTargetType: 'ship',
      combatAttackerIds: ['a', 'b'],
    });

    expect(getCombatPreview(state, 0, planning, map)).toEqual({
      targetPosition: { q: 1, r: 0 },
      attackerPositions: [
        { q: 0, r: 0 },
        { q: 0, r: 1 },
      ],
      label: '1:2  ATK 6/6',
      modLabel: '-1',
      modColor: '#ffcc00',
      totalMod: -1,
      canCounter: true,
    });
  });

  it('builds an ordnance interception preview without a counterattack label', () => {
    const state = createState({
      ordnance: [createOrdnance()],
    });

    const planning = createPlanning({
      combatTargetId: 'ord-0',
      combatTargetType: 'ordnance',
    });

    expect(getCombatPreview(state, 0, planning, map)).toEqual({
      targetPosition: { q: 1, r: 0 },
      attackerPositions: [
        { q: 0, r: 0 },
        { q: 0, r: 1 },
      ],
      label: '2:1',
      modLabel: '-1',
      modColor: '#ffcc00',
      totalMod: -1,
      canCounter: false,
    });
  });

  it('formats combat results and falls back to the previous state for target lookup', () => {
    const state = createState({
      ships: [
        createShip({ id: 'a', owner: 0 }),
        createShip({ id: 'b', owner: 0, position: { q: 0, r: 1 } }),
      ],
      ordnance: [createOrdnance()],
    });

    const previousState = createState();

    const asteroidResult: CombatResult = {
      attackerIds: [],
      targetId: 'x',
      targetType: 'ship',
      attackType: 'asteroidHazard',
      odds: '1:1',
      attackStrength: 0,
      defendStrength: 0,
      rangeMod: 0,
      velocityMod: 0,
      dieRoll: 5,
      modifiedRoll: 5,
      damageType: 'disabled',
      disabledTurns: 2,
      counterattack: null,
    };

    const antiNukeResult: CombatResult = {
      attackerIds: ['a'],
      targetId: 'ord-0',
      targetType: 'ordnance',
      attackType: 'antiNuke',
      odds: '2:1',
      attackStrength: 4,
      defendStrength: 1,
      rangeMod: 1,
      velocityMod: 0,
      dieRoll: 4,
      modifiedRoll: 3,
      damageType: 'eliminated',
      disabledTurns: 0,
      counterattack: null,
    };

    expect(formatCombatResult(asteroidResult, previousState)).toBe(
      'frigate: asteroid [5] DISABLED 2T',
    );

    expect(formatCombatResult(antiNukeResult, state)).toBe(
      '2:1 [4→3] nuke: ELIMINATED',
    );

    expect(
      getCombatTargetEntity(asteroidResult, state, previousState)?.position,
    ).toEqual({ q: 1, r: 0 });
  });
});
