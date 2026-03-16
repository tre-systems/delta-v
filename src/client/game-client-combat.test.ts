import { describe, expect, it } from 'vitest';
import type { CombatAttack, GameState, Ordnance, PlayerState, Ship, SolarSystemMap } from '../shared/types';
import {
  buildCurrentAttack,
  countRemainingCombatAttackers,
  getAttackStrengthForSelection,
  getReusableCombatGroup,
  hasSplitFireOptions,
} from './game-client-combat';

function createShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship-0',
    type: 'corsair',
    owner: 0,
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
    { connected: true, ready: true, targetBody: '', homeBody: 'Terra', bases: [], escapeWins: false },
    { connected: true, ready: true, targetBody: '', homeBody: 'Mars', bases: [], escapeWins: false },
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
      createShip({ id: 'b', owner: 0, type: 'corvette', position: { q: 0, r: 1 } }),
      createShip({ id: 'x', owner: 1, type: 'frigate', position: { q: 1, r: 0 } }),
      createShip({ id: 'y', owner: 1, type: 'packet', position: { q: 1, r: 0 } }),
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
      { attackerIds: ['a', 'b'], targetId: 'x', targetType: 'ship', attackStrength: 3 },
    ];

    expect(getReusableCombatGroup(state, 0, queuedAttacks, 'y')).toEqual({
      attackerIds: ['a', 'b'],
      remainingStrength: 3,
    });
    expect(hasSplitFireOptions(state, 0, queuedAttacks)).toBe(true);
  });

  it('builds a ship attack from selected legal attackers and clamps requested strength', () => {
    const state = createState();

    expect(buildCurrentAttack(state, 0, {
      combatTargetId: 'x',
      combatTargetType: 'ship',
      combatAttackerIds: ['a'],
      combatAttackStrength: 99,
      queuedAttacks: [],
    }, map)).toEqual({
      attackerIds: ['a'],
      targetId: 'x',
      targetType: 'ship',
      attackStrength: 4,
    });
  });

  it('builds an ordnance interception attack against an enemy nuke', () => {
    const state = createState({ ordnance: [createOrdnance()] });

    expect(buildCurrentAttack(state, 0, {
      combatTargetId: 'ord-0',
      combatTargetType: 'ordnance',
      combatAttackerIds: [],
      combatAttackStrength: null,
      queuedAttacks: [],
    }, map)).toEqual({
      attackerIds: ['a', 'b'],
      targetId: 'ord-0',
      targetType: 'ordnance',
      attackStrength: null,
    });
  });

  it('counts only uncommitted attackers and computes selected strength', () => {
    const state = createState();
    const queuedAttacks: CombatAttack[] = [
      { attackerIds: ['a'], targetId: 'x', targetType: 'ship', attackStrength: 4 },
    ];

    expect(countRemainingCombatAttackers(state, 0, queuedAttacks)).toBe(1);
    expect(getAttackStrengthForSelection(state, ['a', 'b'])).toBe(6);
  });
});
