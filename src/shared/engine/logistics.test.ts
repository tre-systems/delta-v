import { describe, expect, it } from 'vitest';
import { must } from '../assert';
import { buildSolarSystemMap } from '../map-data';
import type { GameState, Ship, TransferOrder } from '../types';
import {
  getTransferEligiblePairs,
  processLogistics,
  processSurrender,
  shouldEnterLogisticsPhase,
  skipLogistics,
} from './logistics';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'test',
  type: 'corvette',
  owner: 0,
  position: { q: 5, r: 5 },
  velocity: { dq: 1, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  landed: false,
  destroyed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});
const makeState = (
  ships: Ship[],
  overrides: Partial<GameState> = {},
): GameState => ({
  gameId: 'test',
  scenario: 'test',
  scenarioRules: { logisticsEnabled: true },
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'logistics',
  activePlayer: 0,
  ships,
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Venus',
      bases: [],
      escapeWins: false,
    },
  ],
  winner: null,
  winReason: null,
  ...overrides,
});
const map = buildSolarSystemMap();
describe('processSurrender', () => {
  it('marks ship as surrendered', () => {
    const ship = makeShip({ id: 's1', owner: 0 });
    const state = makeState([ship], {
      phase: 'astrogation',
      activePlayer: 0,
    });
    const result = processSurrender(state, 0, ['s1']);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const s = must(result.state.ships.find((s) => s.id === 's1'));
      expect(s.controlStatus).toBe('surrendered');
    }
  });
  it('rejects surrender of enemy ship', () => {
    const ship = makeShip({ id: 's1', owner: 1 });
    const state = makeState([ship], {
      phase: 'astrogation',
      activePlayer: 0,
    });
    const result = processSurrender(state, 0, ['s1']);
    expect('error' in result).toBe(true);
  });
  it('rejects surrender of destroyed ship', () => {
    const ship = makeShip({
      id: 's1',
      owner: 0,
      destroyed: true,
    });
    const state = makeState([ship], {
      phase: 'astrogation',
      activePlayer: 0,
    });
    const result = processSurrender(state, 0, ['s1']);
    expect('error' in result).toBe(true);
  });
  it('rejects surrender of already surrendered ship', () => {
    const ship = makeShip({
      id: 's1',
      owner: 0,
      controlStatus: 'surrendered',
    });
    const state = makeState([ship], {
      phase: 'astrogation',
      activePlayer: 0,
    });
    const result = processSurrender(state, 0, ['s1']);
    expect('error' in result).toBe(true);
  });
  it('rejects surrender when not in astrogation phase', () => {
    const ship = makeShip({ id: 's1', owner: 0 });
    const state = makeState([ship], {
      phase: 'combat',
      activePlayer: 0,
    });
    const result = processSurrender(state, 0, ['s1']);
    expect('error' in result).toBe(true);
  });
  it('rejects surrender when logistics not enabled', () => {
    const ship = makeShip({ id: 's1', owner: 0 });
    const state = makeState([ship], {
      phase: 'astrogation',
      activePlayer: 0,
      scenarioRules: {},
    });
    const result = processSurrender(state, 0, ['s1']);
    expect('error' in result).toBe(true);
  });
  it('surrenders multiple ships', () => {
    const s1 = makeShip({ id: 's1', owner: 0 });
    const s2 = makeShip({ id: 's2', owner: 0 });
    const state = makeState([s1, s2], {
      phase: 'astrogation',
      activePlayer: 0,
    });
    const result = processSurrender(state, 0, ['s1', 's2']);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.state.ships.find((s) => s.id === 's1')?.controlStatus).toBe(
        'surrendered',
      );
      expect(result.state.ships.find((s) => s.id === 's2')?.controlStatus).toBe(
        'surrendered',
      );
    }
  });
});
describe('getTransferEligiblePairs', () => {
  it('finds friendly ship pairs at same hex+velocity', () => {
    const source = makeShip({
      id: 'tanker',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const target = makeShip({
      id: 'corvette',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([source, target]);
    const pairs = getTransferEligiblePairs(state, 0);
    expect(pairs.length).toBe(1);
    expect(pairs[0].canTransferFuel).toBe(true);
    expect(pairs[0].maxFuel).toBe(15);
  });
  it('excludes pairs at different hexes', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
      position: { q: 6, r: 5 },
    });
    const state = makeState([source, target]);
    expect(getTransferEligiblePairs(state, 0)).toHaveLength(0);
  });
  it('excludes pairs with different velocity', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
      velocity: { dq: 2, dr: 0 },
    });
    const state = makeState([source, target]);
    expect(getTransferEligiblePairs(state, 0)).toHaveLength(0);
  });
  it('torch ships cannot transfer fuel', () => {
    const source = makeShip({
      id: 'torch',
      type: 'torch',
      owner: 0,
      fuel: Infinity,
    });
    const target = makeShip({
      id: 'corvette',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([source, target]);
    const pairs = getTransferEligiblePairs(state, 0);
    // Torch can transfer cargo but not fuel
    if (pairs.length > 0) {
      expect(pairs[0].canTransferFuel).toBe(false);
    }
  });
  it('allows looting disabled enemy ships', () => {
    const enemy = makeShip({
      id: 'enemy',
      type: 'frigate',
      owner: 1,
      fuel: 15,
      damage: { disabledTurns: 2 },
    });
    const friendly = makeShip({
      id: 'friendly',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([enemy, friendly]);
    const pairs = getTransferEligiblePairs(state, 0);
    expect(pairs.length).toBe(1);
    expect(pairs[0].source.id).toBe('enemy');
    expect(pairs[0].canTransferFuel).toBe(true);
  });
  it('allows looting surrendered enemy ships', () => {
    const enemy = makeShip({
      id: 'enemy',
      type: 'frigate',
      owner: 1,
      fuel: 15,
      controlStatus: 'surrendered',
    });
    const friendly = makeShip({
      id: 'friendly',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([enemy, friendly]);
    const pairs = getTransferEligiblePairs(state, 0);
    expect(pairs.length).toBe(1);
  });
  it('blocks looting operational enemy ships', () => {
    const enemy = makeShip({
      id: 'enemy',
      type: 'frigate',
      owner: 1,
      fuel: 15,
    });
    const friendly = makeShip({
      id: 'friendly',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([enemy, friendly]);
    expect(getTransferEligiblePairs(state, 0)).toHaveLength(0);
  });
  it('excludes destroyed ships', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
      destroyed: true,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([source, target]);
    expect(getTransferEligiblePairs(state, 0)).toHaveLength(0);
  });
});
describe('shouldEnterLogisticsPhase', () => {
  it('returns false when logistics disabled', () => {
    const s1 = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const s2 = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([s1, s2], { scenarioRules: {} });
    expect(shouldEnterLogisticsPhase(state)).toBe(false);
  });
  it('returns false when no eligible pairs', () => {
    const s1 = makeShip({
      id: 's1',
      type: 'corvette',
      owner: 0,
      fuel: 20,
    });
    const state = makeState([s1]);
    expect(shouldEnterLogisticsPhase(state)).toBe(false);
  });
  it('returns true when eligible pairs exist', () => {
    const s1 = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const s2 = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([s1, s2]);
    expect(shouldEnterLogisticsPhase(state)).toBe(true);
  });
});
describe('processLogistics', () => {
  it('transfers fuel between ships', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([source, target]);
    const transfer: TransferOrder = {
      sourceShipId: 's1',
      targetShipId: 's2',
      transferType: 'fuel',
      amount: 10,
    };
    const result = processLogistics(state, 0, [transfer], map);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const src = must(result.state.ships.find((s) => s.id === 's1'));
      const tgt = must(result.state.ships.find((s) => s.id === 's2'));
      expect(src.fuel).toBe(40);
      expect(tgt.fuel).toBe(15);
    }
  });
  it('transfers cargo between ships', () => {
    const source = makeShip({
      id: 's1',
      type: 'frigate',
      owner: 0,
      cargoUsed: 0,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      cargoUsed: 3,
    });
    const state = makeState([source, target]);
    const transfer: TransferOrder = {
      sourceShipId: 's1',
      targetShipId: 's2',
      transferType: 'cargo',
      amount: 2,
    };
    const result = processLogistics(state, 0, [transfer], map);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const src = must(result.state.ships.find((s) => s.id === 's1'));
      const tgt = must(result.state.ships.find((s) => s.id === 's2'));
      expect(src.cargoUsed).toBe(2);
      expect(tgt.cargoUsed).toBe(1);
    }
  });
  it('rejects transfer exceeding source fuel', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 5,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([source, target]);
    const transfer: TransferOrder = {
      sourceShipId: 's1',
      targetShipId: 's2',
      transferType: 'fuel',
      amount: 10,
    };
    const result = processLogistics(state, 0, [transfer], map);
    expect('error' in result).toBe(true);
  });
  it('rejects transfer exceeding target fuel capacity', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 18,
    });
    const state = makeState([source, target]);
    const transfer: TransferOrder = {
      sourceShipId: 's1',
      targetShipId: 's2',
      transferType: 'fuel',
      amount: 5,
    };
    const result = processLogistics(state, 0, [transfer], map);
    expect('error' in result).toBe(true);
  });
  it('rejects torch fuel transfer', () => {
    const source = makeShip({
      id: 's1',
      type: 'torch',
      owner: 0,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([source, target]);
    const transfer: TransferOrder = {
      sourceShipId: 's1',
      targetShipId: 's2',
      transferType: 'fuel',
      amount: 5,
    };
    const result = processLogistics(state, 0, [transfer], map);
    expect('error' in result).toBe(true);
  });
  it('rejects when not in logistics phase', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
    });
    const state = makeState([source, target], {
      phase: 'astrogation',
    });
    const transfer: TransferOrder = {
      sourceShipId: 's1',
      targetShipId: 's2',
      transferType: 'fuel',
      amount: 5,
    };
    const result = processLogistics(state, 0, [transfer], map);
    expect('error' in result).toBe(true);
  });
  it('rejects ships at different positions', () => {
    const source = makeShip({
      id: 's1',
      type: 'tanker',
      owner: 0,
      fuel: 50,
    });
    const target = makeShip({
      id: 's2',
      type: 'corvette',
      owner: 0,
      fuel: 5,
      position: { q: 6, r: 5 },
    });
    const state = makeState([source, target]);
    const transfer: TransferOrder = {
      sourceShipId: 's1',
      targetShipId: 's2',
      transferType: 'fuel',
      amount: 5,
    };
    const result = processLogistics(state, 0, [transfer], map);
    expect('error' in result).toBe(true);
  });
});
describe('skipLogistics', () => {
  it('advances past logistics phase', () => {
    const state = makeState([makeShip()]);
    const result = skipLogistics(state, 0, map);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.state.phase).not.toBe('logistics');
    }
  });
  it('rejects when not in logistics phase', () => {
    const state = makeState([makeShip()], {
      phase: 'astrogation',
    });
    const result = skipLogistics(state, 0, map);
    expect('error' in result).toBe(true);
  });
  it('rejects wrong player', () => {
    const state = makeState([makeShip()]);
    const result = skipLogistics(state, 1, map);
    expect('error' in result).toBe(true);
  });
});
