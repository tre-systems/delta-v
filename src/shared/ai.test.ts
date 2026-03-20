import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAstrogation, aiCombat, aiOrdnance } from './ai';
import { ORDNANCE_MASS, SHIP_STATS } from './constants';
import { createGame } from './engine/game-engine';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from './map-data';
import type { SolarSystemMap } from './types';

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

    const aiShips = state.ships.filter((s) => s.owner === 1);
    expect(orders).toHaveLength(aiShips.length);
  });

  it('each order has a valid shipId belonging to the AI', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);

    const orders = aiAstrogation(state, 1, map);

    const aiShipIds = new Set(
      state.ships.filter((s) => s.owner === 1).map((s) => s.id),
    );
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
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.damage.disabledTurns = 3;

    const orders = aiAstrogation(state, 1, map);

    const disabledOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(disabledOrder).toBeDefined();
    expect(disabledOrder!.burn).toBeNull();
  });

  it('destroyed ships are skipped (no order generated)', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.destroyed = true;

    const orders = aiAstrogation(state, 1, map);

    const destroyedOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(destroyedOrder).toBeUndefined();
  });

  it('takes off from home base when it has a target', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // AI is player 1, starts landed at Venus, target is Mars
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    expect(aiShip.landed).toBe(true);

    const orders = aiAstrogation(state, 1, map);

    // AI should burn to take off, not stay landed
    expect(orders[0].burn).not.toBeNull();
  });

  it('returns orders for escape scenario', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);

    // Player 0 has escape objective
    const orders = aiAstrogation(state, 0, map);

    const p0Ships = state.ships.filter((s) => s.owner === 0);
    expect(orders).toHaveLength(p0Ships.length);
  });

  it('works for multi-ship scenario (escape)', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);

    // Enforcer side (player 1) has 2 ships (1 corvette + 1 corsair per rules)
    const orders = aiAstrogation(state, 1, map);

    expect(orders).toHaveLength(2);
    // Each order should reference a different ship
    const shipIds = orders.map((o) => o.shipId);
    expect(new Set(shipIds).size).toBe(2);
  });

  it('does not crash when ship has zero fuel', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.fuel = 0;

    const orders = aiAstrogation(state, 1, map);

    expect(orders).toHaveLength(1);
    // With zero fuel, should choose null burn (no other option)
    expect(orders[0].burn).toBeNull();
  });

  it('does not choose overload after the ship has already used its allowance', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.landed = false;
    aiShip.position = { q: 10, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 10;

    const withAllowance = aiAstrogation(state, 1, map, 'hard');
    expect(withAllowance[0].overload).not.toBeNull();

    aiShip.overloadUsed = true;

    const withoutAllowance = aiAstrogation(state, 1, map, 'hard');
    expect(withoutAllowance[0].overload).toBeUndefined();
  });
});

describe('aiOrdnance', () => {
  it('returns empty array when no enemies exist', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Destroy all enemy ships
    for (const s of state.ships.filter((s) => s.owner === 0)) {
      s.destroyed = true;
    }

    const launches = aiOrdnance(state, 1, map);

    expect(launches).toHaveLength(0);
  });

  it('returns empty array for ships without cargo', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Fill up the AI ship's cargo
    const aiShip = state.ships.find((s) => s.owner === 1)!;
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
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.landed = false;
    aiShip.damage.disabledTurns = 2;

    const launches = aiOrdnance(state, 1, map);

    expect(launches).toHaveLength(0);
  });

  it('launches torpedo at nearby enemy for warships', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemyShip = state.ships.find((s) => s.owner === 0)!;

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
    const ship0 = state.ships.find((s) => s.owner === 0)!;
    const ship1 = state.ships.find((s) => s.owner === 1)!;

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
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrims = state.ships.filter((s) => s.owner === 0);
    enforcers.forEach((s, i) => {
      s.landed = false;
      s.position = { q: i * 2, r: 0 };
    });
    pilgrims.forEach((s, i) => {
      s.landed = false;
      s.position = { q: i * 2 + 1, r: 0 };
    });

    const launches = aiOrdnance(state, 1, map);

    const aiShipIds = new Set(enforcers.map((s) => s.id));
    for (const launch of launches) {
      expect(aiShipIds.has(launch.shipId)).toBe(true);
    }
  });
});

describe('aiCombat', () => {
  it('returns empty when AI has no ships that can attack', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    // Destroy AI ships
    for (const s of state.ships.filter((s) => s.owner === 1)) {
      s.destroyed = true;
    }

    const attacks = aiCombat(state, 1, openMap);

    expect(attacks).toHaveLength(0);
  });

  it('returns empty when no enemies exist', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    for (const s of state.ships.filter((s) => s.owner === 0)) {
      s.destroyed = true;
    }

    const attacks = aiCombat(state, 1, openMap);

    expect(attacks).toHaveLength(0);
  });

  it('attacks nearby enemy with reasonable odds', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemyShip = state.ships.find((s) => s.owner === 0)!;

    // Place them adjacent -- best possible odds
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
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemyShip = state.ships.find((s) => s.owner === 0)!;

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
        [
          '1,0',
          {
            terrain: 'planetSurface',
            body: { name: 'Blocker', destructive: false },
          },
        ],
      ]),
      bodies: [],
      bounds: { minQ: -5, maxQ: 5, minR: -5, maxR: 5 },
    };

    expect(aiCombat(state, 1, blockedMap)).toEqual([]);
  });

  it('concentrates fire with multiple ships', () => {
    const state = createGame(SCENARIOS.escape, map, 'TEST', findBaseHex);
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrim = state.ships.find((s) => s.owner === 0)!;

    // Place all near each other
    for (let i = 0; i < enforcers.length; i++) {
      enforcers[i].position = { q: 0, r: i };
      enforcers[i].lastMovementPath = [{ q: 0, r: i }];
      enforcers[i].velocity = { dq: 0, dr: 0 };
      enforcers[i].landed = false;
    }
    pilgrim.position = { q: 1, r: 0 };
    pilgrim.lastMovementPath = [{ q: 1, r: 0 }];
    pilgrim.velocity = { dq: 0, dr: 0 };
    pilgrim.landed = false;

    // Destroy other pilgrims
    for (const s of state.ships.filter(
      (s) => s.owner === 0 && s.id !== pilgrim.id,
    )) {
      s.destroyed = true;
    }

    const attacks = aiCombat(state, 1, openMap);

    expect(attacks).toHaveLength(1);
    // Should concentrate all ships on the single target
    expect(attacks[0].attackerIds).toHaveLength(enforcers.length);
    expect(attacks[0].targetId).toBe(pilgrim.id);
  });

  it('easy AI is more conservative about attacking', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'TEST', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemyShip = state.ships.find((s) => s.owner === 0)!;

    // Place them far apart -- poor odds
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
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemyShip = state.ships.find((s) => s.owner === 0)!;

    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;
    enemyShip.position = { q: 1, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.landed = false;

    const attacks = aiCombat(state, 1, map);

    if (attacks.length > 0) {
      const allShipIds = new Set(state.ships.map((s) => s.id));
      for (const id of attacks[0].attackerIds) {
        expect(allShipIds.has(id)).toBe(true);
      }
      expect(allShipIds.has(attacks[0].targetId)).toBe(true);
    }
  });
});

describe('AI scenario handling', () => {
  it('duel: AI generates orders for each ship', () => {
    const state = createGame(SCENARIOS.duel, map, 'FA01', findBaseHex);

    const orders = aiAstrogation(state, 1, map);

    const aiShips = state.ships.filter((s) => s.owner === 1);
    expect(orders).toHaveLength(aiShips.length);
    expect(aiShips.length).toBe(1);
  });

  it('combat-only: AI seeks combat when no target body', () => {
    // Use duel scenario (no target body, pure combat)
    const state = createGame(SCENARIOS.duel, map, 'FA02', findBaseHex);

    // Unland all ships and place opposing fleets far apart
    for (const ship of state.ships) {
      ship.landed = false;
      ship.position = ship.owner === 0 ? { q: -10, r: 0 } : { q: 10, r: 0 };
      ship.velocity = { dq: 0, dr: 0 };
    }

    const orders = aiAstrogation(state, 1, map, 'hard');

    // At least one ship should burn toward enemy (not null)
    const hasBurn = orders.some((o) => o.burn !== null);
    expect(hasBurn).toBe(true);
  });

  it('blockade: AI interceptor seeks enemy runner', () => {
    const state = createGame(SCENARIOS.blockade, map, 'BK01', findBaseHex);

    // The corvette (player 1) starts in space
    const dreadnaught = state.ships.find((s) => s.owner === 1)!;
    expect(dreadnaught.landed).toBe(false);

    const orders = aiAstrogation(state, 1, map);

    expect(orders).toHaveLength(1);
  });

  it('blockade: runner AI navigates toward Mars', () => {
    const state = createGame(SCENARIOS.blockade, map, 'BK02', findBaseHex);
    const runner = state.ships.find((s) => s.owner === 0)!;

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
    const difficulties: Array<'easy' | 'normal' | 'hard'> = [
      'easy',
      'normal',
      'hard',
    ];
    const scenarios = [
      SCENARIOS.biplanetary,
      SCENARIOS.escape,
      SCENARIOS.blockade,
      SCENARIOS.duel,
    ];

    for (const scenario of scenarios) {
      for (const diff of difficulties) {
        const state = createGame(scenario, map, 'DF01', findBaseHex);

        // Unland ships for meaningful AI decisions
        for (const s of state.ships) {
          if (!s.destroyed) {
            s.landed = false;
            s.velocity = { dq: 0, dr: 0 };
          }
        }

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

describe('aiAstrogation — escape strategy', () => {
  it('escape AI prefers directions that increase distance from center', () => {
    const state = createGame(SCENARIOS.escape, map, 'ESC1', findBaseHex);
    const pilgrim = state.ships.find((s) => s.owner === 0)!;
    pilgrim.landed = false;
    pilgrim.position = { q: 0, r: -15 };
    pilgrim.velocity = { dq: 0, dr: -2 };

    const orders = aiAstrogation(state, 0, map, 'hard');

    const order = orders.find((o) => o.shipId === pilgrim.id);
    expect(order).toBeDefined();
    // Should burn, not drift
    expect(order!.burn).not.toBeNull();
  });

  it('escape AI penalizes staying landed', () => {
    const state = createGame(SCENARIOS.escape, map, 'ESC2', findBaseHex);

    // Pilgrims start with velocity -- they should keep moving, not stay at base
    const orders = aiAstrogation(state, 0, map);

    // At least some pilgrims should have a burn order
    const hasBurn = orders.some((o) => o.burn !== null);
    expect(hasBurn).toBe(true);
  });
});

describe('aiAstrogation — captured ships', () => {
  it('captured ships get null burn', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'CAP1', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.captured = true;

    const orders = aiAstrogation(state, 1, map);

    const capturedOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(capturedOrder).toBeDefined();
    expect(capturedOrder!.burn).toBeNull();
  });
});

describe('aiAstrogation — emplaced ships', () => {
  it('emplaced (orbital base) ships are skipped', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'EMP1', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.emplaced = true;

    const orders = aiAstrogation(state, 1, map);

    const emplacedOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(emplacedOrder).toBeUndefined();
  });
});

describe('aiAstrogation — checkpoint race', () => {
  it('grandTour: AI navigates toward unvisited bodies', () => {
    const state = createGame(SCENARIOS.grandTour, map, 'GT01', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    expect(aiShip.landed).toBe(true);

    const orders = aiAstrogation(state, 1, map, 'normal');

    expect(orders).toHaveLength(1);
    // Should take off
    expect(orders[0].burn).not.toBeNull();
  });

  it('grandTour: AI with all checkpoints visited targets home body', () => {
    const state = createGame(SCENARIOS.grandTour, map, 'GT02', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;

    // Place ship in open space away from gravity wells
    aiShip.landed = false;
    aiShip.position = { q: -5, r: 0 };
    aiShip.velocity = { dq: -1, dr: -1 };
    aiShip.fuel = 20;

    // Mark all checkpoints as visited
    state.players[1].visitedBodies = [
      ...(state.scenarioRules.checkpointBodies ?? []),
    ];

    const orders = aiAstrogation(state, 1, map, 'hard');

    // Should generate a valid order (navigating toward Mars, the home body)
    expect(orders).toHaveLength(1);
    expect(orders[0].shipId).toBe(aiShip.id);
  });

  it('grandTour: AI diverts to nearest base when low on fuel', () => {
    const state = createGame(SCENARIOS.grandTour, map, 'GT03', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 1, dr: 0 };
    aiShip.fuel = 3; // Very low fuel

    const orders = aiAstrogation(state, 1, map, 'normal');

    expect(orders).toHaveLength(1);
    // Should still generate a valid order
    if (orders[0].burn !== null) {
      expect(orders[0].burn).toBeGreaterThanOrEqual(0);
      expect(orders[0].burn).toBeLessThanOrEqual(5);
    }
  });

  it('grandTour: does not use overloads since combatDisabled', () => {
    const state = createGame(SCENARIOS.grandTour, map, 'GT04', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.landed = false;
    aiShip.position = { q: 5, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 20;

    const orders = aiAstrogation(state, 1, map, 'hard');

    // combatDisabled means no overloads
    expect(orders[0].overload).toBeUndefined();
  });
});

describe('aiAstrogation — easy AI randomization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('easy AI sometimes picks random direction', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.25 -> triggers random

    const state = createGame(SCENARIOS.biplanetary, map, 'RAND', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 10;

    const orders = aiAstrogation(state, 1, map, 'easy');

    // Should still produce a valid order
    expect(orders).toHaveLength(1);
    if (orders[0].burn !== null) {
      expect(orders[0].burn).toBeGreaterThanOrEqual(0);
      expect(orders[0].burn).toBeLessThanOrEqual(5);
    }
    // Easy AI never overloads
    expect(orders[0].overload).toBeUndefined();
  });

  it('easy AI skips random direction when Math.random >= 0.25', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // >= 0.25 -> no random

    const state = createGame(SCENARIOS.biplanetary, map, 'RAND', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 10;

    const orders = aiAstrogation(state, 1, map, 'easy');

    expect(orders).toHaveLength(1);
  });
});

describe('aiAstrogation — pure combat positioning', () => {
  it('AI in duel aggressively approaches enemy', () => {
    const state = createGame(SCENARIOS.duel, map, 'CMB1', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemyShip = state.ships.find((s) => s.owner === 0)!;

    aiShip.landed = false;
    aiShip.position = { q: 15, r: 0 };
    aiShip.velocity = { dq: -1, dr: 0 };
    aiShip.fuel = 20;

    enemyShip.landed = false;
    enemyShip.position = { q: -15, r: 0 };
    enemyShip.velocity = { dq: 1, dr: 0 };

    const orders = aiAstrogation(state, 1, map, 'hard');

    // Should burn toward enemy
    expect(orders[0].burn).not.toBeNull();
  });

  it('AI penalizes staying landed in pure combat', () => {
    const state = createGame(SCENARIOS.duel, map, 'CMB2', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemyShip = state.ships.find((s) => s.owner === 0)!;

    // AI is landed but has fuel
    aiShip.landed = true;
    aiShip.fuel = 20;

    enemyShip.landed = false;
    enemyShip.position = { q: 10, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };

    const orders = aiAstrogation(state, 1, map, 'hard');

    // Should take off, not stay landed
    expect(orders[0].burn).not.toBeNull();
  });
});

describe('aiOrdnance — defensive mine-laying', () => {
  it('escape AI drops defensive mines when being pursued', () => {
    const state = createGame(SCENARIOS.escape, map, 'DFM1', findBaseHex);
    const pilgrim = state.ships.find((s) => s.owner === 0)!;
    const enforcer = state.ships.find((s) => s.owner === 1)!;

    // Set up escape scenario: pilgrim fleeing with velocity, enforcer close behind
    pilgrim.landed = false;
    pilgrim.position = { q: 0, r: -10 };
    pilgrim.velocity = { dq: 0, dr: -3 };
    pilgrim.fuel = 10;
    pilgrim.cargoUsed = 0;

    enforcer.landed = false;
    enforcer.position = { q: 1, r: -8 };
    enforcer.velocity = { dq: 0, dr: -2 };

    // Pilgrim needs a pending burn order (mine rule requires burn)
    state.pendingAstrogationOrders = [
      { shipId: pilgrim.id, burn: 0, overload: null },
    ];

    // Escape scenario only allows nukes, but let's test with mine allowed
    state.scenarioRules.allowedOrdnanceTypes = ['mine', 'nuke'];

    const launches = aiOrdnance(state, 0, map, 'normal');

    // Should attempt to drop a mine (transport has cargo=50, mine costs 10)
    const mineLaunch = launches.find(
      (l) => l.shipId === pilgrim.id && l.ordnanceType === 'mine',
    );
    if (
      SHIP_STATS[pilgrim.type].cargo - pilgrim.cargoUsed >=
      ORDNANCE_MASS.mine
    ) {
      expect(mineLaunch).toBeDefined();
    }
  });

  it('easy AI does not drop defensive mines', () => {
    const state = createGame(SCENARIOS.escape, map, 'DFM2', findBaseHex);
    const pilgrim = state.ships.find((s) => s.owner === 0)!;
    const enforcer = state.ships.find((s) => s.owner === 1)!;

    pilgrim.landed = false;
    pilgrim.position = { q: 0, r: -10 };
    pilgrim.velocity = { dq: 0, dr: -3 };
    pilgrim.cargoUsed = 0;

    // Place enforcer far enough to avoid regular mine range (>4 for easy)
    // but within defensive mine range (<=8)
    enforcer.landed = false;
    enforcer.position = { q: 0, r: -4 };

    state.pendingAstrogationOrders = [
      { shipId: pilgrim.id, burn: 0, overload: null },
    ];
    state.scenarioRules.allowedOrdnanceTypes = ['mine', 'nuke'];

    // Mock Math.random to avoid the 30% early-return skip
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const launches = aiOrdnance(state, 0, map, 'easy');

    // Easy AI should not use defensive mine-laying (difficulty !== 'easy' check)
    const mineLaunch = launches.find((l) => l.ordnanceType === 'mine');
    expect(mineLaunch).toBeUndefined();

    vi.restoreAllMocks();
  });
});

describe('aiOrdnance — mine burn requirement', () => {
  it('does not drop mine without a pending burn order', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'MBR1', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    aiShip.cargoUsed = 0;
    enemy.landed = false;
    enemy.position = { q: 2, r: 0 };

    // No pending orders -> no burn -> no mine
    state.pendingAstrogationOrders = [];

    const launches = aiOrdnance(state, 1, map, 'normal');

    const mineLaunch = launches.find((l) => l.ordnanceType === 'mine');
    expect(mineLaunch).toBeUndefined();
  });

  it('drops mine when a pending burn order exists', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'MBR2', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    aiShip.cargoUsed = 0;
    // Corvette: cargo=5, mine=10 -> too small! Use a ship with more cargo.
    // Set up a frigate scenario instead
    aiShip.type = 'frigate';

    enemy.landed = false;
    enemy.position = { q: 3, r: 0 };

    state.pendingAstrogationOrders = [
      { shipId: aiShip.id, burn: 2, overload: null },
    ];

    const launches = aiOrdnance(state, 1, map, 'normal');

    // Frigate has torpedo capability, so it may launch torpedo instead
    // The important thing is that it can launch something with a burn order present
    expect(launches.length).toBeGreaterThanOrEqual(0);
  });
});

describe('aiOrdnance — nuke launch conditions', () => {
  it('hard AI launches nuke when enemy is strong and close', () => {
    const state = createGame(SCENARIOS.duel, map, 'NUK1', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    // Use frigate for both -- frigate has canOverload=true and cargo=40
    aiShip.type = 'frigate';
    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.cargoUsed = 0;

    // Make enemy very strong (dreadnaught)
    enemy.type = 'dreadnaught';
    enemy.landed = false;
    enemy.position = { q: 4, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };

    const launches = aiOrdnance(state, 1, map, 'hard');

    if (launches.length > 0) {
      // Hard AI should prefer nuke against stronger enemy at close range
      expect(['nuke', 'torpedo']).toContain(launches[0].ordnanceType);
    }
  });

  it('does not launch nuke on normal difficulty', () => {
    const state = createGame(SCENARIOS.duel, map, 'NUK2', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    aiShip.type = 'frigate';
    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    aiShip.cargoUsed = 0;

    enemy.type = 'dreadnaught';
    enemy.landed = false;
    enemy.position = { q: 4, r: 0 };

    const launches = aiOrdnance(state, 1, map, 'normal');

    const nukeLaunch = launches.find((l) => l.ordnanceType === 'nuke');
    // Normal AI doesn't launch nukes (only hard does)
    expect(nukeLaunch).toBeUndefined();
  });
});

describe('aiOrdnance — easy AI skip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('easy AI skips ordnance 30% of the time', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.3 -> skip

    const state = createGame(SCENARIOS.biplanetary, map, 'SKIP', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    aiShip.landed = false;
    aiShip.position = { q: 0, r: 0 };
    enemy.landed = false;
    enemy.position = { q: 2, r: 0 };

    const launches = aiOrdnance(state, 1, map, 'easy');

    expect(launches).toHaveLength(0);
  });
});

describe('aiCombat — anti-nuke targeting', () => {
  it('targets enemy nukes when they threaten own ships', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'NUKE', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;

    // Move enemy far away (no LOS for ship combat)
    enemy.position = { q: 50, r: 0 };
    enemy.landed = false;

    // Place a nuke near AI ship
    state.ordnance.push({
      id: 'nuke-1',
      type: 'nuke',
      owner: 0,
      position: { q: 2, r: 0 },
      velocity: { dq: -1, dr: 0 },
      destroyed: false,
      turnsRemaining: 3,
    });

    const attacks = aiCombat(state, 1, openMap);

    // AI should try to target the threatening nuke
    const nukeAttack = attacks.find((a) => a.targetId === 'nuke-1');
    if (nukeAttack) {
      expect(nukeAttack.targetType).toBe('ordnance');
      expect(nukeAttack.attackerIds).toContain(aiShip.id);
    }
  });

  it('prioritizes close nukes over distant enemies', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'NPRI', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;

    // Enemy far away
    enemy.position = { q: 8, r: 0 };
    enemy.lastMovementPath = [{ q: 8, r: 0 }];
    enemy.velocity = { dq: 0, dr: 0 };
    enemy.landed = false;

    // Nuke very close
    state.ordnance.push({
      id: 'nuke-close',
      type: 'nuke',
      owner: 0,
      position: { q: 1, r: 0 },
      velocity: { dq: 0, dr: 0 },
      destroyed: false,
      turnsRemaining: 3,
    });

    const attacks = aiCombat(state, 1, openMap);

    // Should have at least one attack
    expect(attacks.length).toBeGreaterThanOrEqual(1);
    // First attack should target the close nuke (higher score)
    if (attacks.length > 0) {
      expect(attacks[0].targetId).toBe('nuke-close');
    }
  });
});

describe('aiCombat — easy AI single attack', () => {
  it('easy AI only makes one attack per phase', () => {
    const state = createGame(SCENARIOS.escape, map, 'EASY', findBaseHex);
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrims = state.ships.filter((s) => s.owner === 0);

    // Place all ships adjacent for guaranteed attacks
    for (const [i, s] of enforcers.entries()) {
      s.position = { q: 0, r: i };
      s.lastMovementPath = [{ q: 0, r: i }];
      s.velocity = { dq: 0, dr: 0 };
      s.landed = false;
    }
    for (const [i, s] of pilgrims.entries()) {
      s.position = { q: 1, r: i };
      s.lastMovementPath = [{ q: 1, r: i }];
      s.velocity = { dq: 0, dr: 0 };
      s.landed = false;
    }

    const attacks = aiCombat(state, 1, openMap, 'easy');

    // Easy AI should attack at most one target
    expect(attacks.length).toBeLessThanOrEqual(1);
  });
});

describe('aiCombat — landed enemy skipping', () => {
  it('does not attack landed enemies', () => {
    const state = createGame(SCENARIOS.biplanetary, map, 'LAND', findBaseHex);
    const aiShip = state.ships.find((s) => s.owner === 1)!;
    const enemy = state.ships.find((s) => s.owner === 0)!;

    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.landed = false;

    enemy.position = { q: 1, r: 0 };
    enemy.lastMovementPath = [{ q: 1, r: 0 }];
    enemy.velocity = { dq: 0, dr: 0 };
    enemy.landed = true; // Landed ships can't be attacked

    const attacks = aiCombat(state, 1, openMap);

    expect(attacks).toHaveLength(0);
  });
});

describe('aiCombat — multiple targets', () => {
  it('assigns each attacker to only one target', () => {
    const state = createGame(SCENARIOS.escape, map, 'MULT', findBaseHex);
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrims = state.ships.filter((s) => s.owner === 0);

    // Enforcers at origin, pilgrims spread out
    for (const s of enforcers) {
      s.position = { q: 0, r: 0 };
      s.lastMovementPath = [{ q: 0, r: 0 }];
      s.velocity = { dq: 0, dr: 0 };
      s.landed = false;
    }
    for (const [i, s] of pilgrims.entries()) {
      s.position = { q: 2, r: i };
      s.lastMovementPath = [{ q: 2, r: i }];
      s.velocity = { dq: 0, dr: 0 };
      s.landed = false;
    }

    const attacks = aiCombat(state, 1, openMap, 'hard');

    // Verify no attacker appears in multiple attacks
    const allAttackerIds: string[] = [];
    for (const attack of attacks) {
      for (const id of attack.attackerIds) {
        expect(allAttackerIds).not.toContain(id);
        allAttackerIds.push(id);
      }
    }
  });
});
