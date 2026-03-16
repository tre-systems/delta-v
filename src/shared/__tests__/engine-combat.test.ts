import { describe, it, expect } from 'vitest';
import {
  beginCombatPhase,
  processCombat,
  skipCombat,
  shouldEnterCombatPhase,
} from '../engine-combat';
import { createGame } from '../game-engine';
import { buildSolarSystemMap, SCENARIOS, findBaseHex } from '../map-data';
import { hexKey } from '../hex';
import type { GameState, SolarSystemMap, Ship, Ordnance } from '../types';

function makeShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: 'ship0',
    type: 'corvette',
    owner: 0,
    position: { q: 0, r: 0 },
    velocity: { dq: 0, dr: 0 },
    fuel: 20,
    cargoUsed: 0,
    resuppliedThisTurn: false,
    landed: false,
    destroyed: false,
    detected: true,
    damage: { disabledTurns: 0 },
    ...overrides,
  };
}

function makeOrdnance(overrides: Partial<Ordnance> = {}): Ordnance {
  return {
    id: 'ord0',
    type: 'nuke',
    owner: 1,
    position: { q: 1, r: 0 },
    velocity: { dq: 0, dr: 0 },
    turnsRemaining: 5,
    destroyed: false,
    ...overrides,
  };
}

const openMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -50, maxQ: 50, minR: -50, maxR: 50 },
};

function makeCombatState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'TEST',
    scenario: 'Bi-Planetary',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'combat',
    activePlayer: 0,
    ships: [
      makeShip({ id: 'a0', owner: 0, position: { q: 0, r: 0 }, lastMovementPath: [{ q: 0, r: 0 }] }),
      makeShip({ id: 'e0', owner: 1, position: { q: 2, r: 0 }, lastMovementPath: [{ q: 2, r: 0 }] }),
    ],
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: [
      { connected: true, ready: true, targetBody: 'Mars', homeBody: 'Venus', bases: [], escapeWins: false },
      { connected: true, ready: true, targetBody: 'Venus', homeBody: 'Mars', bases: [], escapeWins: false },
    ],
    winner: null,
    winReason: null,
    ...overrides,
  };
}

describe('beginCombatPhase', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = beginCombatPhase(state, 0);
    expect('error' in result && result.error).toContain('Not in combat phase');
  });

  it('rejects when not active player', () => {
    const state = makeCombatState({ activePlayer: 1 });
    const result = beginCombatPhase(state, 0);
    expect('error' in result && result.error).toContain('Not your turn');
  });

  it('returns state when winner exists after asteroid hazards', () => {
    const state = makeCombatState({ winner: null });
    // Manually set winner to simulate post-hazard win
    state.winner = 0;
    state.winReason = 'All enemy ships destroyed';
    const result = beginCombatPhase(state, 0);
    expect('error' in result).toBe(false);
    expect('state' in result).toBe(true);
  });

  it('advances turn when combat should not remain', () => {
    // Attacker disabled → no manual combat targets → advances
    const state = makeCombatState();
    state.ships[0].damage.disabledTurns = 3;
    const result = beginCombatPhase(state, 0, openMap);
    expect('error' in result).toBe(false);
    expect('state' in result).toBe(true);
    if ('state' in result) {
      expect(result.state.phase).toBe('astrogation');
    }
  });

  it('stays in combat when there are targets', () => {
    const state = makeCombatState();
    const result = beginCombatPhase(state, 0, openMap);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.phase).toBe('combat');
    }
  });
});

describe('processCombat', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = processCombat(state, 0, []);
    expect('error' in result && result.error).toContain('Not in combat phase');
  });

  it('rejects when not active player', () => {
    const state = makeCombatState({ activePlayer: 1 });
    const result = processCombat(state, 0, []);
    expect('error' in result && result.error).toContain('Not your turn');
  });

  it('rejects attacks when combatDisabled', () => {
    const state = makeCombatState({ scenarioRules: { combatDisabled: true } });
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'e0' },
    ]);
    expect('error' in result && result.error).toContain('not allowed');
  });

  it('rejects duplicate attacker ids within same attack', () => {
    const state = makeCombatState();
    const result = processCombat(state, 0, [
      { attackerIds: ['a0', 'a0'], targetId: 'e0' },
    ], openMap);
    expect('error' in result && result.error).toContain('at most once');
  });

  it('rejects invalid attacker (wrong owner)', () => {
    const state = makeCombatState();
    const result = processCombat(state, 0, [
      { attackerIds: ['e0'], targetId: 'a0' },
    ], openMap);
    expect('error' in result && result.error).toContain('Invalid attacker');
  });

  it('rejects empty attackers', () => {
    const state = makeCombatState();
    const result = processCombat(state, 0, [
      { attackerIds: [], targetId: 'e0' },
    ], openMap);
    expect('error' in result && result.error).toContain('Invalid attacker');
  });

  it('rejects attacking landed ship', () => {
    const state = makeCombatState();
    state.ships[1].landed = true;
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'e0' },
    ], openMap);
    expect('error' in result && result.error).toContain('Invalid combat target');
  });

  it('rejects split fire across different hexes', () => {
    const state = makeCombatState();
    state.ships = [
      makeShip({ id: 'a0', type: 'frigate', owner: 0, position: { q: 0, r: 0 }, lastMovementPath: [{ q: 0, r: 0 }] }),
      makeShip({ id: 'e0', owner: 1, position: { q: 2, r: 0 }, lastMovementPath: [{ q: 2, r: 0 }] }),
      makeShip({ id: 'e1', owner: 1, position: { q: 3, r: 0 }, lastMovementPath: [{ q: 3, r: 0 }] }),
    ];
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'e0', attackStrength: 2 },
      { attackerIds: ['a0'], targetId: 'e1', attackStrength: 2 },
    ], openMap);
    expect('error' in result && result.error).toContain('same hex');
  });

  it('rejects invalid declared attack strength', () => {
    const state = makeCombatState();
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'e0', attackStrength: 99 },
    ], openMap);
    expect('error' in result && result.error).toContain('Invalid declared attack strength');
  });

  it('rejects when attack group has no strength remaining', () => {
    const state = makeCombatState();
    state.ships = [
      makeShip({ id: 'a0', type: 'corvette', owner: 0, position: { q: 0, r: 0 }, lastMovementPath: [{ q: 0, r: 0 }] }),
      makeShip({ id: 'e0', owner: 1, position: { q: 2, r: 0 }, lastMovementPath: [{ q: 2, r: 0 }] }),
      makeShip({ id: 'e1', owner: 1, position: { q: 2, r: 0 }, lastMovementPath: [{ q: 2, r: 0 }] }),
      makeShip({ id: 'e2', owner: 1, position: { q: 2, r: 0 }, lastMovementPath: [{ q: 2, r: 0 }] }),
    ];
    // Corvette has combat 4, try to split against 3 targets exhausting strength
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'e0', attackStrength: 2 },
      { attackerIds: ['a0'], targetId: 'e1', attackStrength: 2 },
      { attackerIds: ['a0'], targetId: 'e2', attackStrength: 1 },
    ], openMap, () => 0.99);
    expect('error' in result && result.error).toContain('no strength remaining');
  });

  it('rejects attacker group type mismatch (ship vs ordnance)', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', owner: 1, position: { q: 2, r: 0 } })];
    state.ships = [
      makeShip({ id: 'a0', type: 'frigate', owner: 0, position: { q: 0, r: 0 }, lastMovementPath: [{ q: 0, r: 0 }] }),
      makeShip({ id: 'e0', owner: 1, position: { q: 2, r: 0 }, lastMovementPath: [{ q: 2, r: 0 }] }),
    ];
    // First attack on ship, second on ordnance with same group
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'e0', attackStrength: 2 },
      { attackerIds: ['a0'], targetId: 'ord0', targetType: 'ordnance' },
    ], openMap, () => 0.99);
    expect('error' in result && result.error).toContain('cannot split fire between ship and ordnance');
  });

  it('rejects targeting destroyed ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', owner: 1, position: { q: 2, r: 0 }, destroyed: true })];
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'ord0', targetType: 'ordnance' },
    ], openMap);
    expect('error' in result && result.error).toContain('Invalid combat target');
  });

  it('rejects reduced-strength attacks against ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', owner: 1, position: { q: 2, r: 0 } })];
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'ord0', targetType: 'ordnance', attackStrength: 2 },
    ], openMap);
    expect('error' in result && result.error).toContain('Reduced-strength attacks are only supported against ships');
  });

  it('rejects targeting friendly ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', owner: 0, position: { q: 2, r: 0 } })];
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'ord0', targetType: 'ordnance' },
    ], openMap);
    expect('error' in result && result.error).toContain('Invalid combat target');
  });

  it('rejects targeting non-nuke ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', type: 'mine', owner: 1, position: { q: 2, r: 0 } })];
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'ord0', targetType: 'ordnance' },
    ], openMap);
    expect('error' in result && result.error).toContain('Invalid combat target');
  });

  it('resolves anti-nuke attack that misses', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', owner: 1, position: { q: 2, r: 0 } })];
    // Use rng that produces a miss (low roll)
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'ord0', targetType: 'ordnance' },
    ], openMap, () => 0.01);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const antiNuke = result.results.find(r => r.targetType === 'ordnance');
      expect(antiNuke).toBeDefined();
      expect(antiNuke?.damageType).toBe('none');
      expect(state.ordnance[0].destroyed).toBe(false);
    }
  });

  it('resolves anti-nuke attack that hits', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', owner: 1, position: { q: 2, r: 0 } })];
    // Use rng that produces a hit (high roll)
    const result = processCombat(state, 0, [
      { attackerIds: ['a0'], targetId: 'ord0', targetType: 'ordnance' },
    ], openMap, () => 0.99);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const antiNuke = result.results.find(r => r.targetType === 'ordnance');
      expect(antiNuke).toBeDefined();
      expect(antiNuke?.damageType).toBe('eliminated');
    }
  });

  it('returns results when winner found after hazards', () => {
    const state = makeCombatState();
    // All enemies destroyed → winner check will find a winner
    state.ships[1].destroyed = true;
    const result = processCombat(state, 0, [], openMap);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.state.winner).not.toBeNull();
    }
  });
});

describe('skipCombat', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = skipCombat(state, 0);
    expect('error' in result && result.error).toContain('Not in combat phase');
  });

  it('rejects when not active player', () => {
    const state = makeCombatState({ activePlayer: 1 });
    const result = skipCombat(state, 0);
    expect('error' in result && result.error).toContain('Not your turn');
  });

  it('advances turn when no base defense', () => {
    const state = makeCombatState();
    state.ships[1].position = { q: 100, r: 100 };
    const result = skipCombat(state, 0, openMap);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.activePlayer).toBe(1);
    }
  });

  it('returns results when winner found during hazards', () => {
    const state = makeCombatState();
    state.ships[1].destroyed = true;
    const result = skipCombat(state, 0, openMap);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.winner).not.toBeNull();
    }
  });
});

describe('shouldEnterCombatPhase', () => {
  it('returns true when active player has pending asteroid hazards', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    state.pendingAsteroidHazards = [{ shipId: 'a0', hex: { q: 5, r: 5 } }];
    expect(shouldEnterCombatPhase(state, openMap)).toBe(true);
  });

  it('returns false when combatDisabled even with targets', () => {
    const state = makeCombatState({ scenarioRules: { combatDisabled: true } });
    expect(shouldEnterCombatPhase(state, openMap)).toBe(false);
  });

  it('returns true when there are attackable enemy ships', () => {
    const state = makeCombatState();
    expect(shouldEnterCombatPhase(state, openMap)).toBe(true);
  });

  it('returns false when no attackable enemy ships (all destroyed)', () => {
    const state = makeCombatState();
    state.ships[1].destroyed = true;
    expect(shouldEnterCombatPhase(state, openMap)).toBe(false);
  });

  it('returns false when all own ships are disabled', () => {
    const state = makeCombatState();
    state.ships[0].damage.disabledTurns = 3;
    expect(shouldEnterCombatPhase(state, openMap)).toBe(false);
  });

  it('enters combat for base defense targets', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.biplanetary, map, 'BD01', findBaseHex);
    state.phase = 'combat';
    state.activePlayer = 0;

    // Position an enemy ship adjacent to a player base in a gravity hex
    const p0Bases = state.players[0].bases;
    if (p0Bases.length > 0) {
      const [bq, br] = p0Bases[0].split(',').map(Number);
      const baseHex = map.hexes.get(p0Bases[0]);
      const bodyName = baseHex?.base?.bodyName;
      if (bodyName) {
        // Find a gravity hex of same body adjacent to the base
        const enemy = state.ships.find(s => s.owner === 1)!;
        enemy.landed = false;
        enemy.destroyed = false;
        enemy.position = { q: bq + 1, r: br };
        enemy.lastMovementPath = [enemy.position];
        // Ensure the hex exists and has gravity for this body
        const adjKey = hexKey(enemy.position);
        const adjHex = map.hexes.get(adjKey);
        if (adjHex?.gravity?.bodyName === bodyName) {
          expect(shouldEnterCombatPhase(state, map)).toBe(true);
        }
      }
    }
  });

  it('enters combat when enemy nuke is attackable', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ id: 'ord0', owner: 1, position: { q: 2, r: 0 } })];
    // Remove enemy ships so only ordnance is target
    state.ships = [state.ships[0]];
    expect(shouldEnterCombatPhase(state, openMap)).toBe(true);
  });
});

describe('base defense with skipCombat', () => {
  it('resolves planetary defense during skip when enabled', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.biplanetary, map, 'BD02', findBaseHex);
    state.phase = 'combat';
    state.activePlayer = 0;

    // Position enemy adjacent to owned base in gravity
    const p0Bases = state.players[0].bases;
    if (p0Bases.length > 0) {
      const [bq, br] = p0Bases[0].split(',').map(Number);
      const baseHex = map.hexes.get(p0Bases[0]);
      const bodyName = baseHex?.base?.bodyName;
      if (bodyName) {
        const enemy = state.ships.find(s => s.owner === 1)!;
        enemy.landed = false;
        enemy.destroyed = false;
        enemy.position = { q: bq + 1, r: br };
        enemy.lastMovementPath = [enemy.position];
        const adjKey = hexKey(enemy.position);
        const adjHex = map.hexes.get(adjKey);
        if (adjHex?.gravity?.bodyName === bodyName) {
          const result = skipCombat(state, 0, map, () => 0.99);
          expect('error' in result).toBe(false);
          if ('results' in result && result.results) {
            const baseDef = result.results.find(r => r.attackType === 'baseDefense');
            expect(baseDef).toBeDefined();
          }
        }
      }
    }
  });
});
