import { describe, expect, it } from 'vitest';
import { must } from '../assert';
import { asHexKey, hexKey } from '../hex';
import { asGameId, asOrdnanceId, asShipId } from '../ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type {
  EngineError,
  GameState,
  Ordnance,
  Ship,
  SolarSystemMap,
} from '../types';
import {
  beginCombatPhase,
  endCombat,
  processCombat,
  processSingleCombat,
  shouldEnterCombatPhase,
  skipCombat,
} from './combat';
import { createGameOrThrow } from './game-engine';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship0'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  nukesLaunchedSinceResupply: 0,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});
const makeOrdnance = (overrides: Partial<Ordnance> = {}): Ordnance => ({
  id: asOrdnanceId('ord0'),
  type: 'nuke',
  owner: 1,
  sourceShipId: null,
  position: { q: 1, r: 0 },
  velocity: { dq: 0, dr: 0 },
  turnsRemaining: 5,
  lifecycle: 'active' as const,
  ...overrides,
});
const openMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -50, maxQ: 50, minR: -50, maxR: 50 },
};
const makeCombatState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('TEST'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'combat',
  activePlayer: 0,
  ships: [
    makeShip({
      id: asShipId('a0'),
      owner: 0,
      position: { q: 0, r: 0 },
      lastMovementPath: [{ q: 0, r: 0 }],
    }),
    makeShip({
      id: asShipId('e0'),
      owner: 1,
      position: { q: 2, r: 0 },
      lastMovementPath: [{ q: 2, r: 0 }],
    }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: true,
      targetBody: 'Mars',
      homeBody: 'Venus',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Venus',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ],
  outcome: null,
  ...overrides,
});
const getErrorMessage = (error: EngineError): string => error.message;
describe('beginCombatPhase', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = beginCombatPhase(state, 0, openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Not in combat phase',
    );
  });
  it('rejects when not active player', () => {
    const state = makeCombatState({ activePlayer: 1 });
    const result = beginCombatPhase(state, 0, openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Not your turn',
    );
  });
  it('returns state when winner exists after asteroid hazards', () => {
    const state = makeCombatState({ outcome: null });
    state.outcome = { winner: 0, reason: 'All enemy ships destroyed' };
    const result = beginCombatPhase(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    expect('state' in result).toBe(true);
  });
  it('advances turn when combat should not remain', () => {
    const state = makeCombatState();
    state.ships[0].damage.disabledTurns = 3;
    const result = beginCombatPhase(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    expect('state' in result).toBe(true);
    if ('state' in result) {
      expect(result.state.phase).toBe('astrogation');
    }
  });
  it('stays in combat when there are targets', () => {
    const state = makeCombatState();
    const result = beginCombatPhase(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.phase).toBe('combat');
    }
  });
});
describe('processCombat', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = processCombat(state, 0, [], openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Not in combat phase',
    );
  });
  it('rejects when not active player', () => {
    const state = makeCombatState({ activePlayer: 1 });
    const result = processCombat(state, 0, [], openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Not your turn',
    );
  });
  it('rejects attacks when combatDisabled', () => {
    const state = makeCombatState({
      scenarioRules: { combatDisabled: true },
    });
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'not allowed',
    );
  });
  it('rejects duplicate attacker ids within same attack', () => {
    const state = makeCombatState();
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0'), asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'at most once',
    );
  });
  it('rejects invalid attacker (wrong owner)', () => {
    const state = makeCombatState();
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('e0')],
          targetId: asShipId('a0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Invalid attacker',
    );
  });
  it('rejects empty attackers', () => {
    const state = makeCombatState();
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Invalid attacker',
    );
  });
  it('rejects attacking landed ship', () => {
    const state = makeCombatState();
    state.ships[1].lifecycle = 'landed';
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Target not active',
    );
  });
  it('rejects split fire across different hexes', () => {
    const state = makeCombatState();
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        type: 'frigate',
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('e0'),
        owner: 1,
        position: { q: 2, r: 0 },
        lastMovementPath: [{ q: 2, r: 0 }],
      }),
      makeShip({
        id: asShipId('e1'),
        owner: 1,
        position: { q: 3, r: 0 },
        lastMovementPath: [{ q: 3, r: 0 }],
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: 2,
        },
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e1'),
          targetType: 'ship',
          attackStrength: 2,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'same hex',
    );
  });
  it('rejects invalid declared attack strength', () => {
    const state = makeCombatState();
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: 99,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Invalid declared attack strength',
    );
  });
  it('rejects when attack group has no strength remaining', () => {
    const state = makeCombatState();
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        type: 'corvette',
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('e0'),
        owner: 1,
        position: { q: 2, r: 0 },
        lastMovementPath: [{ q: 2, r: 0 }],
      }),
      makeShip({
        id: asShipId('e1'),
        owner: 1,
        position: { q: 2, r: 0 },
        lastMovementPath: [{ q: 2, r: 0 }],
      }),
      makeShip({
        id: asShipId('e2'),
        owner: 1,
        position: { q: 2, r: 0 },
        lastMovementPath: [{ q: 2, r: 0 }],
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: 2,
        },
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e1'),
          targetType: 'ship',
          attackStrength: 2,
        },
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e2'),
          targetType: 'ship',
          attackStrength: 1,
        },
      ],
      openMap,
      () => 0.99,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'no strength remaining',
    );
  });
  it('rejects attacker group type mismatch (ship vs ordnance)', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        type: 'frigate',
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('e0'),
        owner: 1,
        position: { q: 2, r: 0 },
        lastMovementPath: [{ q: 2, r: 0 }],
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: 2,
        },
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('ord0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.99,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'cannot split fire between ship and ordnance',
    );
  });
  it('rejects targeting destroyed ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        owner: 1,
        position: { q: 2, r: 0 },
        lifecycle: 'destroyed',
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('ord0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Invalid combat target',
    );
  });
  it('rejects reduced-strength attacks against ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('ord0'),
          targetType: 'ordnance',
          attackStrength: 2,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Reduced-strength attacks are only supported against ships',
    );
  });
  it('rejects targeting friendly ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        owner: 0,
        position: { q: 2, r: 0 },
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('ord0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Invalid combat target',
    );
  });
  it('rejects targeting non-nuke ordnance', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        type: 'mine',
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('ord0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Invalid combat target',
    );
  });
  it('resolves anti-nuke attack that misses', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('ord0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.01,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const antiNuke = result.results.find((r) => r.targetType === 'ordnance');
      expect(antiNuke).toBeDefined();
      expect(antiNuke?.damageType).toBe('none');
      expect(state.ordnance[0].lifecycle).toBe('active');
    }
  });
  it('resolves anti-nuke attack that hits', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('ord0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.99,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const antiNuke = result.results.find((r) => r.targetType === 'ordnance');
      expect(antiNuke).toBeDefined();
      expect(antiNuke?.damageType).toBe('eliminated');
      expect(result.engineEvents).toContainEqual({
        type: 'combatAttack',
        attackerIds: [asShipId('a0')],
        targetId: asOrdnanceId('ord0'),
        targetType: 'ordnance',
        attackType: 'antiNuke',
        odds: antiNuke?.odds,
        attackStrength: antiNuke?.attackStrength,
        defendStrength: antiNuke?.defendStrength,
        rangeMod: antiNuke?.rangeMod,
        velocityMod: antiNuke?.velocityMod,
        roll: antiNuke?.dieRoll,
        modifiedRoll: antiNuke?.modifiedRoll,
        damageType: antiNuke?.damageType,
        disabledTurns: antiNuke?.disabledTurns,
      });
      expect(result.engineEvents).toContainEqual({
        type: 'ordnanceDestroyed',
        ordnanceId: 'ord0',
        cause: 'antiNuke',
      });
    }
  });
  it('emits explicit counterattack events', () => {
    const state = makeCombatState({
      ships: [
        makeShip({
          id: asShipId('a0'),
          owner: 0,
          position: { q: 0, r: 0 },
          lastMovementPath: [{ q: 0, r: 0 }],
        }),
        makeShip({
          id: asShipId('e0'),
          owner: 1,
          position: { q: 1, r: 0 },
          lastMovementPath: [{ q: 1, r: 0 }],
        }),
      ],
    });
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.7,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }
    const attack = result.results[0];
    const counterattack = attack?.counterattack;

    expect(
      result.engineEvents.filter((event) => event.type === 'combatAttack'),
    ).toContainEqual({
      type: 'combatAttack',
      attackerIds: [asShipId('a0')],
      targetId: asShipId('e0'),
      targetType: 'ship',
      attackType: 'gun',
      odds: attack?.odds,
      attackStrength: attack?.attackStrength,
      defendStrength: attack?.defendStrength,
      rangeMod: attack?.rangeMod,
      velocityMod: attack?.velocityMod,
      roll: attack?.dieRoll,
      modifiedRoll: attack?.modifiedRoll,
      damageType: attack?.damageType,
      disabledTurns: attack?.disabledTurns,
    });
    expect(
      result.engineEvents.filter((event) => event.type === 'combatAttack'),
    ).toContainEqual({
      type: 'combatAttack',
      attackerIds: [asShipId('e0')],
      targetId: asShipId('a0'),
      targetType: 'ship',
      attackType: 'gun',
      odds: counterattack?.odds,
      attackStrength: counterattack?.attackStrength,
      defendStrength: counterattack?.defendStrength,
      rangeMod: counterattack?.rangeMod,
      velocityMod: counterattack?.velocityMod,
      roll: counterattack?.dieRoll,
      modifiedRoll: counterattack?.modifiedRoll,
      damageType: counterattack?.damageType,
      disabledTurns: counterattack?.disabledTurns,
    });
  });
  it('returns results when winner found after hazards', () => {
    const state = makeCombatState();
    state.ships[1].lifecycle = 'destroyed';
    const result = processCombat(state, 0, [], openMap, Math.random);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.state.outcome).not.toBeNull();
    }
  });
});
describe('skipCombat', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = skipCombat(state, 0, openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Not in combat phase',
    );
  });
  it('rejects when not active player', () => {
    const state = makeCombatState({ activePlayer: 1 });
    const result = skipCombat(state, 0, openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'Not your turn',
    );
  });
  it('advances turn when no base defense', () => {
    const state = makeCombatState();
    state.ships[1].position = { q: 100, r: 100 };
    const result = skipCombat(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.activePlayer).toBe(1);
    }
  });
  it('returns results when winner found during hazards', () => {
    const state = makeCombatState();
    state.ships[1].lifecycle = 'destroyed';
    const result = skipCombat(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.outcome).not.toBeNull();
    }
  });
});
describe('shouldEnterCombatPhase', () => {
  it('returns true when active player has pending asteroid hazards', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    state.pendingAsteroidHazards = [
      { shipId: asShipId('a0'), hex: { q: 5, r: 5 } },
    ];
    expect(shouldEnterCombatPhase(state, openMap)).toBe(true);
  });
  it('returns false when combatDisabled even with targets', () => {
    const state = makeCombatState({
      scenarioRules: { combatDisabled: true },
    });
    expect(shouldEnterCombatPhase(state, openMap)).toBe(false);
  });
  it('returns true when there are attackable enemy ships', () => {
    const state = makeCombatState();
    expect(shouldEnterCombatPhase(state, openMap)).toBe(true);
  });
  it('returns false when no attackable enemy ships (all destroyed)', () => {
    const state = makeCombatState();
    state.ships[1].lifecycle = 'destroyed';
    expect(shouldEnterCombatPhase(state, openMap)).toBe(false);
  });
  it('returns false when all own ships are disabled', () => {
    const state = makeCombatState();
    state.ships[0].damage.disabledTurns = 3;
    expect(shouldEnterCombatPhase(state, openMap)).toBe(false);
  });
  it('enters combat for base defense targets', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BD01'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const p0Bases = state.players[0].bases;
    if (p0Bases.length > 0) {
      const [bq, br] = p0Bases[0].split(',').map(Number);
      const baseHex = map.hexes.get(p0Bases[0]);
      const bodyName = baseHex?.base?.bodyName;
      if (bodyName) {
        const enemy = must(state.ships.find((s) => s.owner === 1));
        enemy.lifecycle = 'active';
        enemy.position = { q: bq + 1, r: br };
        enemy.lastMovementPath = [enemy.position];
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
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('ord0'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    state.ships = [state.ships[0]];
    expect(shouldEnterCombatPhase(state, openMap)).toBe(true);
  });
});
describe('processCombat -- additional edge cases', () => {
  it('rejects duplicate target in separate attacks', () => {
    const state = makeCombatState();
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        type: 'frigate',
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('a1'),
        type: 'corvette',
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('e0'),
        owner: 1,
        position: { q: 2, r: 0 },
        lastMovementPath: [{ q: 2, r: 0 }],
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
        {
          attackerIds: [asShipId('a1')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.99,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'attacked only once',
    );
  });
  it('rejects ordnance attack when group has no remaining strength', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('nuke0'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
      makeOrdnance({
        id: asOrdnanceId('nuke1'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        type: 'frigate',
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('e0'),
        owner: 1,
        position: { q: 10, r: 0 },
        lastMovementPath: [{ q: 10, r: 0 }],
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('nuke0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('nuke1'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.99,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'no strength remaining',
    );
  });
  it('rejects anti-nuke attack when attacker lacks LOS through body', () => {
    const bodyMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'planetSurface',
            body: { name: 'Blocker', destructive: false },
          },
        ],
      ]),
      bodies: [
        {
          name: 'Blocker',
          center: { q: 1, r: 0 },
          surfaceRadius: 0,
          color: '#888',
          renderRadius: 1,
        },
      ],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('nuke0'),
        owner: 1,
        position: { q: 2, r: 0 },
      }),
    ];
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('e0'),
        owner: 1,
        position: { q: 10, r: 0 },
        lastMovementPath: [{ q: 10, r: 0 }],
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asOrdnanceId('nuke0'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      bodyMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'line of sight',
    );
  });
  it('rejects ship attack when attacker lacks LOS through body', () => {
    const bodyMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'planetSurface',
            body: { name: 'Blocker', destructive: false },
          },
        ],
      ]),
      bodies: [
        {
          name: 'Blocker',
          center: { q: 1, r: 0 },
          surfaceRadius: 0,
          color: '#888',
          renderRadius: 1,
        },
      ],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };
    const state = makeCombatState();
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        owner: 0,
        position: { q: 0, r: 0 },
        lastMovementPath: [{ q: 0, r: 0 }],
      }),
      makeShip({
        id: asShipId('e0'),
        owner: 1,
        position: { q: 2, r: 0 },
        lastMovementPath: [{ q: 2, r: 0 }],
      }),
    ];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      bodyMap,
      Math.random,
    );
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'line of sight',
    );
  });
  it('resolves successful ship combat with results', () => {
    const state = makeCombatState();
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [asShipId('a0')],
          targetId: asShipId('e0'),
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.99,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      const shipCombat = result.results.find((r) => r.targetType === 'ship');
      expect(shipCombat).toBeDefined();
      expect(shipCombat?.attackType).toBe('gun');
    }
  });
});
describe('shouldRemainInCombatPhase edge cases', () => {
  it('resolves pending asteroid hazards and returns results', () => {
    const state = makeCombatState();
    state.ships = [
      makeShip({
        id: asShipId('a0'),
        owner: 0,
        position: { q: 0, r: 0 },
      }),
    ];
    state.pendingAsteroidHazards = [
      { shipId: asShipId('a0'), hex: { q: 0, r: 0 } },
    ];
    const result = beginCombatPhase(state, 0, openMap, () => 0.99);
    expect('error' in result).toBe(false);
    if ('results' in result) {
      expect(result.results.length).toBeGreaterThanOrEqual(1);
    }
  });
  it('without map falls back to hasAnyEnemyShips check', () => {
    const state = makeCombatState();
    const result = beginCombatPhase(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.phase).toBe('combat');
    }
  });
  it('without map advances turn when no enemies', () => {
    const state = makeCombatState();
    state.ships[1].lifecycle = 'destroyed';
    const result = beginCombatPhase(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.phase).not.toBe('combat');
    }
  });
});
describe('base defense with skipCombat', () => {
  it('resolves planetary defense during skip when enabled', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BD02'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const p0Bases = state.players[0].bases;
    if (p0Bases.length > 0) {
      const [bq, br] = p0Bases[0].split(',').map(Number);
      const baseHex = map.hexes.get(p0Bases[0]);
      const bodyName = baseHex?.base?.bodyName;
      if (bodyName) {
        const enemy = must(state.ships.find((s) => s.owner === 1));
        enemy.lifecycle = 'active';
        enemy.position = { q: bq + 1, r: br };
        enemy.lastMovementPath = [enemy.position];
        const adjKey = hexKey(enemy.position);
        const adjHex = map.hexes.get(adjKey);
        if (adjHex?.gravity?.bodyName === bodyName) {
          const result = skipCombat(state, 0, map, () => 0.99);
          expect('error' in result).toBe(false);
          if ('results' in result && result.results) {
            const baseDef = result.results.find(
              (r) => r.attackType === 'baseDefense',
            );
            expect(baseDef).toBeDefined();
          }
        }
      }
    }
  });
});
describe('endCombat', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = endCombat(state, 0, openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'phase',
    );
  });
  it('rejects when not active player', () => {
    const state = makeCombatState({ activePlayer: 1 });
    const result = endCombat(state, 0, openMap, Math.random);
    expect('error' in result && getErrorMessage(result.error)).toContain(
      'turn',
    );
  });
  it('advances after combat when no base defense', () => {
    const state = makeCombatState();
    state.ships[1].lifecycle = 'destroyed';
    const result = endCombat(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.phase).not.toBe('combat');
    }
  });
  it('returns state without results when no base defense fires', () => {
    const state = makeCombatState();
    state.ships[1].lifecycle = 'destroyed';
    const result = endCombat(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.results).toBeUndefined();
    }
  });
  it('resolves base defense during endCombat when enabled', () => {
    const map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BD03'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const p0Bases = state.players[0].bases;
    if (p0Bases.length > 0) {
      const [bq, br] = p0Bases[0].split(',').map(Number);
      const baseHex = map.hexes.get(p0Bases[0]);
      const bodyName = baseHex?.base?.bodyName;
      if (bodyName) {
        const enemy = must(state.ships.find((s) => s.owner === 1));
        enemy.lifecycle = 'active';
        enemy.position = { q: bq + 1, r: br };
        enemy.lastMovementPath = [enemy.position];
        const adjKey = hexKey(enemy.position);
        const adjHex = map.hexes.get(adjKey);
        if (adjHex?.gravity?.bodyName === bodyName) {
          const result = endCombat(state, 0, map, () => 0.99);
          expect('error' in result).toBe(false);
          if ('results' in result && result.results) {
            const baseDef = result.results.find(
              (r) => r.attackType === 'baseDefense',
            );
            expect(baseDef).toBeDefined();
          }
        }
      }
    }
  });
  it('cleans up destroyed ordnance after combat', () => {
    const state = makeCombatState();
    state.ordnance = [makeOrdnance({ lifecycle: 'destroyed' })];
    const result = endCombat(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.ordnance.length).toBe(0);
    }
  });
  it('returns game over when outcome is set during combat end', () => {
    const state = makeCombatState();
    // All enemy ships destroyed means game ends
    state.ships = [
      makeShip({ id: asShipId('a0'), owner: 0, position: { q: 0, r: 0 } }),
    ];
    const result = endCombat(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('state' in result) {
      expect(result.state.outcome).not.toBeNull();
    }
  });
});
describe('processSingleCombat', () => {
  it('rejects when not in combat phase', () => {
    const state = makeCombatState({ phase: 'astrogation' });
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asShipId('e0'),
        targetType: 'ship',
        attackStrength: null,
      },
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
  });
  it('rejects duplicate target already attacked this phase', () => {
    const state = makeCombatState();
    state.combatTargetedThisPhase = ['ship:e0'];
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asShipId('e0'),
        targetType: 'ship',
        attackStrength: null,
      },
      openMap,
      Math.random,
    );
    expect('error' in result && result.error.message).toContain('once');
  });
  it('rejects attacker that already fired this phase', () => {
    const state = makeCombatState();
    state.ships[0].firedThisPhase = true;
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asShipId('e0'),
        targetType: 'ship',
        attackStrength: null,
      },
      openMap,
      Math.random,
    );
    expect('error' in result && result.error.message).toContain(
      'already attacked',
    );
  });
  it('rejects duplicate attacker ids inside a single declaration', () => {
    const state = makeCombatState();
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0'), asShipId('a0')],
        targetId: asShipId('e0'),
        targetType: 'ship',
        attackStrength: null,
      },
      openMap,
      Math.random,
    );
    expect('error' in result && result.error.message).toContain('at most once');
  });
  it('rejects invalid declared ship strength', () => {
    const state = makeCombatState();
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asShipId('e0'),
        targetType: 'ship',
        attackStrength: 999,
      },
      openMap,
      Math.random,
    );
    expect('error' in result && result.error.message).toContain(
      'Invalid declared attack strength',
    );
  });
  it('resolves a successful ship attack', () => {
    const state = makeCombatState();
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asShipId('e0'),
        targetType: 'ship',
        attackStrength: null,
      },
      openMap,
      () => 0.99,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.state.combatTargetedThisPhase).toContain('ship:e0');
      const attacker = result.state.ships.find((s) => s.id === 'a0');
      expect(attacker?.firedThisPhase).toBe(true);
    }
  });
  it('resolves anti-nuke attack against enemy nuke', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('nuke0'),
        owner: 1,
        type: 'nuke',
        position: { q: 1, r: 0 },
      }),
    ];
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asOrdnanceId('nuke0'),
        targetType: 'ordnance',
        attackStrength: null,
      },
      openMap,
      () => 0.01,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.results.length).toBe(1);
      expect(result.results[0].attackType).toBe('antiNuke');
    }
  });
  it('rejects reduced-strength anti-nuke declarations', () => {
    const state = makeCombatState();
    state.ordnance = [
      makeOrdnance({
        id: asOrdnanceId('nuke0'),
        owner: 1,
        type: 'nuke',
        position: { q: 1, r: 0 },
      }),
    ];
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asOrdnanceId('nuke0'),
        targetType: 'ordnance',
        attackStrength: 1,
      },
      openMap,
      Math.random,
    );
    expect('error' in result && result.error.message).toContain(
      'Reduced-strength attacks are only supported against ships',
    );
  });
  it('rejects attacking undetected target', () => {
    const state = makeCombatState();
    state.ships[1].detected = false;
    const result = processSingleCombat(
      state,
      0,
      {
        attackerIds: [asShipId('a0')],
        targetId: asShipId('e0'),
        targetType: 'ship',
        attackStrength: null,
      },
      openMap,
      Math.random,
    );
    expect('error' in result && result.error.message).toContain('detected');
  });
});
