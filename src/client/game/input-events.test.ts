import { describe, expect, it } from 'vitest';
import { HEX_DIRECTIONS, hexAdd, hexKey } from '../../shared/hex';
import { buildSolarSystemMap } from '../../shared/map-data';
import type { GameState, PlayerState, Ship, SolarSystemMap } from '../../shared/types';
import { type InputEvent, interpretInput } from './input-events';
import type { PlanningState } from './planning';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'corvette',
  owner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  landed: false,
  destroyed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createPlayers = (): [PlayerState, PlayerState] => [
  { connected: true, ready: true, targetBody: '', homeBody: 'Terra', bases: [], escapeWins: false },
  { connected: true, ready: true, targetBody: '', homeBody: 'Mars', bases: [], escapeWins: false },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: 'TEST',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip(), createShip({ id: 'ship-1', owner: 1, position: { q: 2, r: 0 } })],
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

const createPlanning = (overrides: Partial<PlanningState> = {}): PlanningState => ({
  selectedShipId: null,
  burns: new Map(),
  overloads: new Map(),
  weakGravityChoices: new Map(),
  torpedoAccel: null,
  torpedoAccelSteps: null,
  combatTargetId: null,
  combatTargetType: null,
  combatAttackerIds: [],
  combatAttackStrength: null,
  queuedAttacks: [],
  hoverHex: null,
  ...overrides,
});

const simpleMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -2, maxQ: 4, minR: -2, maxR: 4 },
};

const click = (q: number, r: number): InputEvent => ({ type: 'clickHex', hex: { q, r } });
const hover = (hex: { q: number; r: number } | null): InputEvent => ({ type: 'hoverHex', hex });

describe('interpretInput', () => {
  describe('guard conditions', () => {
    it('returns [] when no game state', () => {
      expect(interpretInput(click(0, 0), null, simpleMap, 0, createPlanning())).toEqual([]);
    });

    it('returns [] when no map', () => {
      expect(interpretInput(click(0, 0), createState(), null, 0, createPlanning())).toEqual([]);
    });

    it('returns [] when not active player', () => {
      const state = createState({ activePlayer: 1 });
      expect(interpretInput(click(0, 0), state, simpleMap, 0, createPlanning())).toEqual([]);
    });

    it('returns [] for non-interactive phases', () => {
      const state = createState({ phase: 'fleetBuilding' });
      expect(interpretInput(click(0, 0), state, simpleMap, 0, createPlanning())).toEqual([]);
    });
  });

  describe('astrogation phase', () => {
    it('selects own ship at hex', () => {
      const cmds = interpretInput(click(0, 0), createState(), simpleMap, 0, createPlanning());
      expect(cmds).toEqual([{ type: 'selectShip', shipId: 'ship-0' }]);
    });

    it('deselects when clicking empty space', () => {
      const cmds = interpretInput(click(9, 9), createState(), simpleMap, 0, createPlanning());
      expect(cmds).toEqual([{ type: 'deselectShip' }]);
    });

    it('toggles burn from destination ring', () => {
      const burnHex = hexAdd({ q: 0, r: 0 }, HEX_DIRECTIONS[0]);
      const planning = createPlanning({ selectedShipId: 'ship-0' });
      const cmds = interpretInput({ type: 'clickHex', hex: burnHex }, createState(), simpleMap, 0, planning);
      expect(cmds).toEqual([{ type: 'setBurnDirection', shipId: 'ship-0', direction: 0 }]);
    });

    it('toggles overload from burn destination ring', () => {
      const burnDest = hexAdd({ q: 0, r: 0 }, HEX_DIRECTIONS[0]);
      const overloadHex = hexAdd(burnDest, HEX_DIRECTIONS[1]);
      const planning = createPlanning({
        selectedShipId: 'ship-0',
        burns: new Map([['ship-0', 0]]),
      });
      const cmds = interpretInput({ type: 'clickHex', hex: overloadHex }, createState(), simpleMap, 0, planning);
      expect(cmds).toEqual([{ type: 'setOverloadDirection', shipId: 'ship-0', direction: 1 }]);
    });

    it('toggles weak gravity choices', () => {
      const map = buildSolarSystemMap();
      const weakHex = { q: 15, r: -10 };
      const state = createState({
        ships: [createShip({ position: { q: 14, r: -10 }, velocity: { dq: 1, dr: 0 } })],
      });
      const planning = createPlanning({ selectedShipId: 'ship-0' });
      const cmds = interpretInput({ type: 'clickHex', hex: weakHex }, state, map, 0, planning);
      expect(cmds).toEqual([{ type: 'setWeakGravityChoices', shipId: 'ship-0', choices: { [hexKey(weakHex)]: true } }]);
    });
  });

  describe('ordnance phase', () => {
    it('cycles torpedo acceleration', () => {
      const state = createState({ phase: 'ordnance' });
      const torpHex = hexAdd({ q: 0, r: 0 }, HEX_DIRECTIONS[0]);
      const planning = createPlanning({ selectedShipId: 'ship-0' });
      const cmds = interpretInput({ type: 'clickHex', hex: torpHex }, state, simpleMap, 0, planning);
      expect(cmds).toEqual([{ type: 'setTorpedoAccel', direction: 0, steps: 1 }]);
    });

    it('selects ship and clears torpedo accel', () => {
      const state = createState({ phase: 'ordnance' });
      const cmds = interpretInput(click(0, 0), state, simpleMap, 0, createPlanning());
      expect(cmds).toEqual([{ type: 'selectShip', shipId: 'ship-0' }, { type: 'clearTorpedoAcceleration' }]);
    });

    it('returns [] for disabled ships', () => {
      const state = createState({
        phase: 'ordnance',
        ships: [createShip({ damage: { disabledTurns: 1 } })],
      });
      const cmds = interpretInput(click(0, 0), state, simpleMap, 0, createPlanning());
      expect(cmds).toEqual([]);
    });
  });

  describe('combat phase', () => {
    const combatState = () =>
      createState({
        phase: 'combat',
        ships: [
          createShip({ position: { q: 0, r: 0 } }),
          createShip({ id: 'ship-1', owner: 1, position: { q: 1, r: 0 } }),
        ],
      });

    it('selects a combat target', () => {
      const state = combatState();
      const planning = createPlanning();
      const cmds = interpretInput(click(1, 0), state, simpleMap, 0, planning);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].type).toBe('setCombatPlan');
    });

    it('deselects same target on re-click', () => {
      const state = combatState();
      const planning = createPlanning({ combatTargetId: 'ship-1', combatTargetType: 'ship' });
      const cmds = interpretInput(click(1, 0), state, simpleMap, 0, planning);
      expect(cmds).toEqual([{ type: 'clearCombatSelection' }]);
    });

    it('clears selection on empty space', () => {
      const state = combatState();
      const cmds = interpretInput(click(9, 9), state, simpleMap, 0, createPlanning());
      expect(cmds).toEqual([{ type: 'clearCombatSelection' }]);
    });

    it('toggles attacker selection', () => {
      const state = combatState();
      const planning = createPlanning({
        combatTargetId: 'ship-1',
        combatTargetType: 'ship',
        combatAttackerIds: [],
      });
      const cmds = interpretInput(click(0, 0), state, simpleMap, 0, planning);
      expect(cmds).toHaveLength(1);
      expect(cmds[0].type).toBe('setCombatPlan');
    });
  });

  describe('hover events', () => {
    it('emits setHoverHex when game state exists', () => {
      const cmds = interpretInput(hover({ q: 3, r: 4 }), createState(), simpleMap, 0, createPlanning());
      expect(cmds).toEqual([{ type: 'setHoverHex', hex: { q: 3, r: 4 } }]);
    });

    it('clears hover when no state but planning has hoverHex', () => {
      const planning = createPlanning({ hoverHex: { q: 1, r: 1 } });
      const cmds = interpretInput(hover(null), null, null, 0, planning);
      expect(cmds).toEqual([{ type: 'setHoverHex', hex: null }]);
    });

    it('returns [] when no state and no existing hoverHex', () => {
      const cmds = interpretInput(hover({ q: 1, r: 1 }), null, null, 0, createPlanning());
      expect(cmds).toEqual([]);
    });
  });
});
