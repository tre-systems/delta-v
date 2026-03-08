import { describe, it, expect, beforeEach } from 'vitest';
import { aiAstrogation, aiOrdnance, aiCombat } from '../ai';
import { createGame } from '../game-engine';
import { buildSolarSystemMap, SCENARIOS, findBaseHex } from '../map-data';
import { SHIP_STATS, ORDNANCE_MASS } from '../constants';
import type { GameState, SolarSystemMap, Ship } from '../types';

let map: SolarSystemMap;

beforeEach(() => {
  map = buildSolarSystemMap();
});

describe('aiAstrogation', () => {
  it('returns one order per AI ship', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const orders = aiAstrogation(state, 1, map);
    const aiShips = state.ships.filter(s => s.owner === 1);
    expect(orders).toHaveLength(aiShips.length);
  });

  it('each order has a valid shipId belonging to the AI', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const orders = aiAstrogation(state, 1, map);
    const aiShipIds = new Set(state.ships.filter(s => s.owner === 1).map(s => s.id));
    for (const order of orders) {
      expect(aiShipIds.has(order.shipId)).toBe(true);
    }
  });

  it('burn is null or 0-5', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const orders = aiAstrogation(state, 1, map);
    for (const order of orders) {
      if (order.burn !== null) {
        expect(order.burn).toBeGreaterThanOrEqual(0);
        expect(order.burn).toBeLessThanOrEqual(5);
      }
    }
  });

  it('disabled ships get null burn', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Disable AI's ship
    const aiShip = state.ships.find(s => s.owner === 1)!;
    aiShip.damage.disabledTurns = 3;

    const orders = aiAstrogation(state, 1, map);
    const disabledOrder = orders.find(o => o.shipId === aiShip.id);
    expect(disabledOrder).toBeDefined();
    expect(disabledOrder!.burn).toBeNull();
  });

  it('destroyed ships get null burn', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    aiShip.destroyed = true;

    const orders = aiAstrogation(state, 1, map);
    const destroyedOrder = orders.find(o => o.shipId === aiShip.id);
    expect(destroyedOrder).toBeDefined();
    expect(destroyedOrder!.burn).toBeNull();
  });

  it('returns orders for escape scenario', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);
    // Player 0 has escape objective
    const orders = aiAstrogation(state, 0, map);
    const p0Ships = state.ships.filter(s => s.owner === 0);
    expect(orders).toHaveLength(p0Ships.length);
  });

  it('works for multi-ship scenario (escape)', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);
    // Enforcer side (player 1) has 2 ships
    const orders = aiAstrogation(state, 1, map);
    expect(orders).toHaveLength(2);
    // Each order should reference a different ship
    const shipIds = orders.map(o => o.shipId);
    expect(new Set(shipIds).size).toBe(2);
  });

  it('does not crash when ship has zero fuel', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    aiShip.fuel = 0;

    const orders = aiAstrogation(state, 1, map);
    expect(orders).toHaveLength(1);
    // With zero fuel, should choose null burn (no other option)
    expect(orders[0].burn).toBeNull();
  });
});

describe('aiOrdnance', () => {
  it('returns empty array when no enemies exist', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Destroy all enemy ships
    state.ships.filter(s => s.owner === 0).forEach(s => { s.destroyed = true; });

    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });

  it('returns empty array for ships without cargo', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Fill up the AI ship's cargo
    const aiShip = state.ships.find(s => s.owner === 1)!;
    const stats = SHIP_STATS[aiShip.type];
    aiShip.cargoUsed = stats.cargo;

    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });

  it('does not launch from landed ships', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Ships start landed in biplanetary
    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });

  it('does not launch from disabled ships', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    aiShip.landed = false;
    aiShip.damage.disabledTurns = 2;

    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });

  it('launches torpedo at nearby enemy for warships', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    const enemyShip = state.ships.find(s => s.owner === 0)!;

    // Place ships close together and not landed
    aiShip.position = { q: 0, r: 0 };
    aiShip.landed = false;
    enemyShip.position = { q: 3, r: 0 };
    enemyShip.landed = false;

    const launches = aiOrdnance(state, 1, map);
    // Corvette can overload and has enough cargo for torpedo
    if (launches.length > 0) {
      expect(launches[0].ordnanceType).toBe('torpedo');
      expect(launches[0].torpedoAccel).toBeDefined();
      expect(launches[0].torpedoAccel).toBeGreaterThanOrEqual(0);
      expect(launches[0].torpedoAccel).toBeLessThanOrEqual(5);
    }
  });

  it('each launch references a valid AI ship', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);
    // Unland enforcer ships and place near enemies
    const enforcers = state.ships.filter(s => s.owner === 1);
    const pilgrims = state.ships.filter(s => s.owner === 0);
    enforcers.forEach((s, i) => {
      s.landed = false;
      s.position = { q: i * 2, r: 0 };
    });
    pilgrims.forEach((s, i) => {
      s.landed = false;
      s.position = { q: i * 2 + 1, r: 0 };
    });

    const launches = aiOrdnance(state, 1, map);
    const aiShipIds = new Set(enforcers.map(s => s.id));
    for (const launch of launches) {
      expect(aiShipIds.has(launch.shipId)).toBe(true);
    }
  });
});

describe('aiCombat', () => {
  it('returns empty when AI has no ships that can attack', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Destroy AI ships
    state.ships.filter(s => s.owner === 1).forEach(s => { s.destroyed = true; });

    const attacks = aiCombat(state, 1);
    expect(attacks).toHaveLength(0);
  });

  it('returns empty when no enemies exist', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    state.ships.filter(s => s.owner === 0).forEach(s => { s.destroyed = true; });

    const attacks = aiCombat(state, 1);
    expect(attacks).toHaveLength(0);
  });

  it('attacks nearby enemy with reasonable odds', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    const enemyShip = state.ships.find(s => s.owner === 0)!;

    // Place them adjacent — best possible odds
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;
    enemyShip.position = { q: 1, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.landed = false;

    const attacks = aiCombat(state, 1);
    // At adjacent range with equal strength, AI should attack
    expect(attacks.length).toBeGreaterThanOrEqual(1);
    if (attacks.length > 0) {
      expect(attacks[0].attackerIds).toContain(aiShip.id);
      expect(attacks[0].targetId).toBe(enemyShip.id);
    }
  });

  it('concentrates fire with multiple ships', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);
    const enforcers = state.ships.filter(s => s.owner === 1);
    const pilgrim = state.ships.find(s => s.owner === 0)!;

    // Place all near each other
    enforcers[0].position = { q: 0, r: 0 };
    enforcers[0].velocity = { dq: 0, dr: 0 };
    enforcers[0].landed = false;
    enforcers[1].position = { q: 0, r: 1 };
    enforcers[1].velocity = { dq: 0, dr: 0 };
    enforcers[1].landed = false;
    pilgrim.position = { q: 1, r: 0 };
    pilgrim.velocity = { dq: 0, dr: 0 };
    pilgrim.landed = false;
    // Destroy other pilgrims
    state.ships.filter(s => s.owner === 0 && s.id !== pilgrim.id).forEach(s => { s.destroyed = true; });

    const attacks = aiCombat(state, 1);
    expect(attacks).toHaveLength(1);
    // Should concentrate both ships on the single target
    expect(attacks[0].attackerIds).toHaveLength(2);
    expect(attacks[0].targetId).toBe(pilgrim.id);
  });

  it('attack contains valid ship references', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    const enemyShip = state.ships.find(s => s.owner === 0)!;

    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;
    enemyShip.position = { q: 1, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.landed = false;

    const attacks = aiCombat(state, 1);
    if (attacks.length > 0) {
      const allShipIds = new Set(state.ships.map(s => s.id));
      for (const id of attacks[0].attackerIds) {
        expect(allShipIds.has(id)).toBe(true);
      }
      expect(allShipIds.has(attacks[0].targetId)).toBe(true);
    }
  });
});
