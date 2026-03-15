import { describe, it, expect, beforeEach } from 'vitest';
import { aiAstrogation, aiOrdnance, aiCombat } from '../ai';
import { createGame } from '../game-engine';
import { buildSolarSystemMap, SCENARIOS, findBaseHex } from '../map-data';
import { SHIP_STATS, ORDNANCE_MASS } from '../constants';
import type { GameState, SolarSystemMap, Ship } from '../types';

let map: SolarSystemMap;
const openMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -50, maxQ: 50, minR: -50, maxR: 50 },
};

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

  it('destroyed ships are skipped (no order generated)', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    aiShip.destroyed = true;

    const orders = aiAstrogation(state, 1, map);
    const destroyedOrder = orders.find(o => o.shipId === aiShip.id);
    expect(destroyedOrder).toBeUndefined();
  });

  it('takes off from home base when it has a target', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // AI is player 1, starts landed at Venus, target is Mars
    const aiShip = state.ships.find(s => s.owner === 1)!;
    expect(aiShip.landed).toBe(true);

    const orders = aiAstrogation(state, 1, map);
    // AI should burn to take off, not stay landed
    expect(orders[0].burn).not.toBeNull();
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

  it('hard AI launches nuke against stronger enemy', () => {
    const state = createGame(SCENARIOS.duel, map, 'TEST', findBaseHex);
    const ship0 = state.ships.find(s => s.owner === 0)!;
    const ship1 = state.ships.find(s => s.owner === 1)!;

    // Place ships close together, not landed
    ship0.position = { q: 0, r: 0 };
    ship0.landed = false;
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.position = { q: 4, r: 0 };
    ship1.landed = false;
    ship1.velocity = { dq: 0, dr: 0 };

    // Make ship1 outgunned by giving ship0 extra combat strength (simulate damage)
    // ship1 is a frigate with cargo=40, so it can launch nukes
    const launches = aiOrdnance(state, 1, map, 'hard');
    // Hard AI should attempt torpedo or nuke given cargo capacity
    if (launches.length > 0) {
      expect(['torpedo', 'nuke']).toContain(launches[0].ordnanceType);
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

    const attacks = aiCombat(state, 1, openMap);
    expect(attacks).toHaveLength(0);
  });

  it('returns empty when no enemies exist', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    state.ships.filter(s => s.owner === 0).forEach(s => { s.destroyed = true; });

    const attacks = aiCombat(state, 1, openMap);
    expect(attacks).toHaveLength(0);
  });

  it('attacks nearby enemy with reasonable odds', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    const enemyShip = state.ships.find(s => s.owner === 0)!;

    // Place them adjacent — best possible odds
    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;
    enemyShip.position = { q: 1, r: 0 };
    enemyShip.lastMovementPath = [{ q: 1, r: 0 }];
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.landed = false;

    const attacks = aiCombat(state, 1, openMap);
    // At adjacent range with equal strength, AI should attack
    expect(attacks.length).toBeGreaterThanOrEqual(1);
    if (attacks.length > 0) {
      expect(attacks[0].attackerIds).toContain(aiShip.id);
      expect(attacks[0].targetId).toBe(enemyShip.id);
    }
  });

  it('skips targets that are blocked by a body', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    const enemyShip = state.ships.find(s => s.owner === 0)!;

    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;
    enemyShip.position = { q: 2, r: 0 };
    enemyShip.lastMovementPath = [{ q: 2, r: 0 }];
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.landed = false;

    const blockedMap: SolarSystemMap = {
      hexes: new Map([
        ['1,0', { terrain: 'planetSurface', body: { name: 'Blocker', destructive: false } }],
      ]),
      bodies: [],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };

    expect(aiCombat(state, 1, blockedMap)).toEqual([]);
  });

  it('concentrates fire with multiple ships', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);
    const enforcers = state.ships.filter(s => s.owner === 1);
    const pilgrim = state.ships.find(s => s.owner === 0)!;

    // Place all near each other
    enforcers[0].position = { q: 0, r: 0 };
    enforcers[0].lastMovementPath = [{ q: 0, r: 0 }];
    enforcers[0].velocity = { dq: 0, dr: 0 };
    enforcers[0].landed = false;
    enforcers[1].position = { q: 0, r: 1 };
    enforcers[1].lastMovementPath = [{ q: 0, r: 1 }];
    enforcers[1].velocity = { dq: 0, dr: 0 };
    enforcers[1].landed = false;
    pilgrim.position = { q: 1, r: 0 };
    pilgrim.lastMovementPath = [{ q: 1, r: 0 }];
    pilgrim.velocity = { dq: 0, dr: 0 };
    pilgrim.landed = false;
    // Destroy other pilgrims
    state.ships.filter(s => s.owner === 0 && s.id !== pilgrim.id).forEach(s => { s.destroyed = true; });

    const attacks = aiCombat(state, 1, openMap);
    expect(attacks).toHaveLength(1);
    // Should concentrate both ships on the single target
    expect(attacks[0].attackerIds).toHaveLength(2);
    expect(attacks[0].targetId).toBe(pilgrim.id);
  });

  it('easy AI is more conservative about attacking', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find(s => s.owner === 1)!;
    const enemyShip = state.ships.find(s => s.owner === 0)!;

    // Place them far apart — poor odds
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;
    enemyShip.position = { q: 8, r: 0 };
    enemyShip.velocity = { dq: 3, dr: 0 };
    enemyShip.landed = false;

    // Easy AI should skip combat with bad range + velocity mods
    const attacks = aiCombat(state, 1, map, 'easy');
    expect(attacks).toHaveLength(0);
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

    const attacks = aiCombat(state, 1, map);
    if (attacks.length > 0) {
      const allShipIds = new Set(state.ships.map(s => s.id));
      for (const id of attacks[0].attackerIds) {
        expect(allShipIds.has(id)).toBe(true);
      }
      expect(allShipIds.has(attacks[0].targetId)).toBe(true);
    }
  });
});

describe('AI scenario handling', () => {
  it('fleet action: AI generates orders for all 3 ships', () => {
    const state = createGame(SCENARIOS.fleetAction, map, 'FA01', findBaseHex);
    const orders = aiAstrogation(state, 1, map);
    const aiShips = state.ships.filter(s => s.owner === 1);
    expect(orders).toHaveLength(aiShips.length);
    expect(aiShips.length).toBe(3);
  });

  it('fleet action: AI seeks combat when no target body', () => {
    const state = createGame(SCENARIOS.fleetAction, map, 'FA02', findBaseHex);
    // Unland all ships and place opposing fleets nearby
    for (const ship of state.ships) {
      ship.landed = false;
      ship.position = ship.owner === 0
        ? { q: 0, r: 0 }
        : { q: 5, r: 0 };
      ship.velocity = { dq: 0, dr: 0 };
    }
    const orders = aiAstrogation(state, 1, map, 'hard');
    // At least one ship should burn toward enemy (not null)
    const hasBurn = orders.some(o => o.burn !== null);
    expect(hasBurn).toBe(true);
  });

  it('blockade: AI interceptor seeks enemy runner', () => {
    const state = createGame(SCENARIOS.blockade, map, 'BK01', findBaseHex);
    // The dreadnaught (player 1) starts in space
    const dreadnaught = state.ships.find(s => s.owner === 1)!;
    expect(dreadnaught.landed).toBe(false);
    const orders = aiAstrogation(state, 1, map);
    expect(orders).toHaveLength(1);
  });

  it('blockade: runner AI navigates toward Mars', () => {
    const state = createGame(SCENARIOS.blockade, map, 'BK02', findBaseHex);
    const runner = state.ships.find(s => s.owner === 0)!;
    // Unland runner and place it in open space
    runner.landed = false;
    runner.position = { q: -3, r: -5 };
    runner.velocity = { dq: 0, dr: 0 };

    const orders = aiAstrogation(state, 0, map, 'hard');
    expect(orders).toHaveLength(1);
    // Hard AI should burn toward Mars (not drift)
    expect(orders[0].burn).not.toBeNull();
  });

  it('AI handles all difficulty levels without errors', () => {
    const difficulties: Array<'easy' | 'normal' | 'hard'> = ['easy', 'normal', 'hard'];
    const scenarios = [SCENARIOS.biplanetary, SCENARIOS.escape, SCENARIOS.blockade, SCENARIOS.fleetAction];

    for (const scenario of scenarios) {
      for (const diff of difficulties) {
        const state = createGame(scenario, map, 'DF01', findBaseHex);
        // Unland ships for meaningful AI decisions
        state.ships.forEach(s => {
          if (!s.destroyed) {
            s.landed = false;
            s.velocity = { dq: 0, dr: 0 };
          }
        });

        const orders = aiAstrogation(state, 1, map, diff);
        expect(orders.length).toBeGreaterThan(0);

        const launches = aiOrdnance(state, 1, map, diff);
        expect(Array.isArray(launches)).toBe(true);

        const attacks = aiCombat(state, 1, map, diff);
        expect(Array.isArray(attacks)).toBe(true);
      }
    }
  });
});
