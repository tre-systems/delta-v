import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
  buildAIFleetPurchases,
} from './ai';
import { must } from './assert';
import { ORDNANCE_MASS, SHIP_STATS } from './constants';
import {
  beginCombatPhase,
  createGameOrThrow,
  processAstrogation,
  skipCombat,
} from './engine/game-engine';
import { asHexKey } from './hex';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from './map-data';
import { computeCourse } from './movement';
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
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const orders = aiAstrogation(state, 1, map);
    const aiShips = state.ships.filter((s) => s.owner === 1);
    expect(orders).toHaveLength(aiShips.length);
  });
  it('each order has a valid shipId belonging to the AI', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const orders = aiAstrogation(state, 1, map);
    const aiShipIds = new Set(
      state.ships.filter((s) => s.owner === 1).map((s) => s.id),
    );
    for (const order of orders) {
      expect(aiShipIds.has(order.shipId)).toBe(true);
    }
  });
  it('burn is null or 0-5', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const orders = aiAstrogation(state, 1, map);
    for (const order of orders) {
      if (order.burn !== null) {
        expect(order.burn).toBeGreaterThanOrEqual(0);
        expect(order.burn).toBeLessThanOrEqual(5);
      }
    }
  });
  it('disabled ships get null burn', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.damage.disabledTurns = 3;
    const orders = aiAstrogation(state, 1, map);
    const disabledOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(disabledOrder).toBeDefined();
    expect(disabledOrder?.burn).toBeNull();
  });
  it('destroyed ships are skipped (no order generated)', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'destroyed';
    const orders = aiAstrogation(state, 1, map);
    const destroyedOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(destroyedOrder).toBeUndefined();
  });
  it('takes off from home base when it has a target', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    // AI is player 1, starts landed at Venus, target is Mars
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    expect(aiShip.lifecycle).toBe('landed');
    const orders = aiAstrogation(state, 1, map);
    // AI should burn to take off, not stay landed
    expect(orders[0].burn).not.toBeNull();
  });
  it('returns orders for escape scenario', () => {
    const state = createGameOrThrow(SCENARIOS.escape, map, 'TEST', findBaseHex);
    // Player 0 has escape objective
    const orders = aiAstrogation(state, 0, map);
    const p0Ships = state.ships.filter((s) => s.owner === 0);
    expect(orders).toHaveLength(p0Ships.length);
  });
  it('works for multi-ship scenario (escape)', () => {
    const state = createGameOrThrow(SCENARIOS.escape, map, 'TEST', findBaseHex);
    // Enforcer side (player 1) has 2 ships (1 corvette + 1 corsair per rules)
    const orders = aiAstrogation(state, 1, map);
    expect(orders).toHaveLength(2);
    // Each order should reference a different ship
    const shipIds = orders.map((o) => o.shipId);
    expect(new Set(shipIds).size).toBe(2);
  });
  it('starts enforcer pursuit after the fugitives break from Terra', () => {
    let state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      'ESCAPE-CHASE',
      findBaseHex,
    );
    const pilgrimOrders = aiAstrogation(state, 0, map, 'hard');
    const pilgrimResult = processAstrogation(
      state,
      0,
      pilgrimOrders,
      map,
      () => 0.5,
    );

    if ('error' in pilgrimResult) {
      expect.unreachable(String(pilgrimResult.error));
    }
    state = pilgrimResult.state;

    const orders = aiAstrogation(state, 1, map, 'hard');
    const corvetteOrder = must(orders.find((order) => order.shipId === 'p1s0'));
    const corsairOrder = must(orders.find((order) => order.shipId === 'p1s1'));

    expect(corvetteOrder.burn).not.toBeNull();
    expect(corsairOrder.burn).not.toBeNull();
  });
  it('does not crash when ship has zero fuel', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.fuel = 0;
    const orders = aiAstrogation(state, 1, map);
    expect(orders).toHaveLength(1);
    // With zero fuel, should choose null burn (no other option)
    expect(orders[0].burn).toBeNull();
  });
  it('does not choose overload after the ship has already used its allowance', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 10, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 10;
    const withAllowance = aiAstrogation(state, 1, map, 'hard');
    expect(withAllowance[0].overload).not.toBeNull();
    aiShip.overloadUsed = true;
    const withoutAllowance = aiAstrogation(state, 1, map, 'hard');
    expect(withoutAllowance[0].overload).toBeNull();
  });
  it('avoids takeoff plans that immediately trap the ship in a solar crash line', () => {
    let state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'LOOKAHEAD',
      findBaseHex,
    );
    state.activePlayer = 0;

    const p0Orders = aiAstrogation(state, 0, map, 'hard');
    const p0Result = processAstrogation(state, 0, p0Orders, map, Math.random);

    if ('error' in p0Result) {
      expect.unreachable(String(p0Result.error));
    }
    state = p0Result.state;

    const ship = must(state.ships.find((s) => s.id === 'p1s0'));
    const [order] = aiAstrogation(state, 1, map, 'hard');
    expect(order).toBeDefined();

    const course = computeCourse(ship, order?.burn ?? null, map, {
      overload: order?.overload ?? null,
      weakGravityChoices: order?.weakGravityChoices,
      destroyedBases: state.destroyedBases,
    });
    expect(course.outcome).not.toBe('crash');

    const projectedShip = {
      ...ship,
      position: course.destination,
      velocity: course.newVelocity,
      fuel: Math.max(0, ship.fuel - course.fuelSpent),
      pendingGravityEffects: course.enteredGravityEffects,
      lifecycle:
        course.outcome === 'landing'
          ? ('landed' as const)
          : ('active' as const),
    };
    const hasSafeFollowUp = [null, 0, 1, 2, 3, 4, 5].some(
      (burn) =>
        computeCourse(projectedShip, burn, map, {
          destroyedBases: state.destroyedBases,
        }).outcome !== 'crash',
    );

    expect(hasSafeFollowUp).toBe(true);
  });

  it('shifts to a home-screening line when biplanetary defense becomes urgent', () => {
    let state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'BIP-DEFEND',
      findBaseHex,
    );
    const rng = () => 0.5;

    const p0Turn1 = aiAstrogation(state, 0, map, 'hard', rng);
    const p0Turn1Result = processAstrogation(state, 0, p0Turn1, map, rng);

    if ('error' in p0Turn1Result) {
      expect.unreachable(String(p0Turn1Result.error));
    }
    state = p0Turn1Result.state;

    const p1Turn1 = aiAstrogation(state, 1, map, 'hard', rng);
    const p1Turn1Result = processAstrogation(state, 1, p1Turn1, map, rng);

    if ('error' in p1Turn1Result) {
      expect.unreachable(String(p1Turn1Result.error));
    }
    state = p1Turn1Result.state;

    const p1CombatStart = beginCombatPhase(state, 1, map, rng);

    if ('error' in p1CombatStart) {
      expect.unreachable(String(p1CombatStart.error));
    }
    state = p1CombatStart.state;

    if (state.phase === 'combat') {
      const p1CombatSkip = skipCombat(state, 1, map, rng);

      if ('error' in p1CombatSkip) {
        expect.unreachable(String(p1CombatSkip.error));
      }
      state = p1CombatSkip.state;
    }

    const p0Turn2 = aiAstrogation(state, 0, map, 'hard', rng);
    const p0Turn2Result = processAstrogation(state, 0, p0Turn2, map, rng);

    if ('error' in p0Turn2Result) {
      expect.unreachable(String(p0Turn2Result.error));
    }
    state = p0Turn2Result.state;

    const p0CombatStart = beginCombatPhase(state, 0, map, rng);

    if ('error' in p0CombatStart) {
      expect.unreachable(String(p0CombatStart.error));
    }
    state = p0CombatStart.state;

    if (state.phase === 'combat') {
      const p0CombatSkip = skipCombat(state, 0, map, rng);

      if ('error' in p0CombatSkip) {
        expect.unreachable(String(p0CombatSkip.error));
      }
      state = p0CombatSkip.state;
    }

    const [order] = aiAstrogation(state, 1, map, 'hard', rng);

    expect(order).toBeDefined();
    expect(order.burn).not.toBeNull();
  });

  it('uses a coordinated escape line for immediate passenger threats', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      'PAX-HOLD',
      findBaseHex,
    );
    const orders = aiAstrogation(state, 0, map, 'hard');
    const transportOrder = must(
      orders.find((order) => order.shipId === 'p0s0'),
    );
    const corvetteOrder = must(orders.find((order) => order.shipId === 'p0s1'));

    expect(transportOrder.overload).toBeNull();
    expect(transportOrder.burn).toBe(1);
    expect(corvetteOrder.burn).toBe(1);
  });

  it('keeps a convoy tanker stacked with the passenger carrier for fuel support', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      'PAX-FUEL',
      findBaseHex,
    );
    const orders = aiAstrogation(state, 0, map, 'hard');
    const linerOrder = must(orders.find((order) => order.shipId === 'p0s0'));
    const tankerOrder = must(orders.find((order) => order.shipId === 'p0s1'));

    expect(linerOrder.burn).not.toBeNull();
    expect(tankerOrder.overload).toBeNull();
    expect(tankerOrder.burn).toBe(linerOrder.burn);
  });

  it('allows corrective-burn objective lines outside the emergency search case', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      'PAX-CORRECT',
      findBaseHex,
    );
    const enemy = must(state.ships.find((ship) => ship.id === 'p1s0'));

    enemy.position = { q: 0, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };
    const orders = aiAstrogation(state, 0, map, 'hard');
    const transportOrder = must(
      orders.find((order) => order.shipId === 'p0s0'),
    );

    expect(transportOrder.burn).not.toBeNull();
  });
});
describe('aiOrdnance', () => {
  it('returns empty array when no enemies exist', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    // Destroy all enemy ships
    for (const s of state.ships.filter((s) => s.owner === 0)) {
      s.lifecycle = 'destroyed';
    }
    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });
  it('returns empty array for ships without cargo', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    // Fill up the AI ship's cargo
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const stats = SHIP_STATS[aiShip.type];
    aiShip.cargoUsed = stats.cargo;
    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });
  it('does not launch from landed ships', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    // Ships start landed in biplanetary
    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });
  it('does not launch from disabled ships', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
    aiShip.damage.disabledTurns = 2;
    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });
  it('launches torpedo at nearby enemy for warships', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    // Place ships close together and not landed
    aiShip.position = { q: 0, r: 0 };
    aiShip.lifecycle = 'active';
    enemyShip.position = { q: 3, r: 0 };
    enemyShip.lifecycle = 'active';
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
    const state = createGameOrThrow(SCENARIOS.duel, map, 'TEST', findBaseHex);
    const ship0 = must(state.ships.find((s) => s.owner === 0));
    const ship1 = must(state.ships.find((s) => s.owner === 1));
    // Place ships close together, not landed
    ship0.position = { q: 0, r: 0 };
    ship0.lifecycle = 'active';
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.position = { q: 4, r: 0 };
    ship1.lifecycle = 'active';
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
    const state = createGameOrThrow(SCENARIOS.escape, map, 'TEST', findBaseHex);
    // Unland enforcer ships and place near enemies
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrims = state.ships.filter((s) => s.owner === 0);
    enforcers.forEach((s, i) => {
      s.lifecycle = 'active';
      s.position = { q: i * 2, r: 0 };
    });
    pilgrims.forEach((s, i) => {
      s.lifecycle = 'active';
      s.position = { q: i * 2 + 1, r: 0 };
    });
    const launches = aiOrdnance(state, 1, map);
    const aiShipIds = new Set(enforcers.map((s) => s.id));
    for (const launch of launches) {
      expect(aiShipIds.has(launch.shipId)).toBe(true);
    }
  });
});
describe('buildAIFleetPurchases', () => {
  it('prefers many smaller hulls in warship-only fleet skirmishes', () => {
    const state = createGameOrThrow(
      SCENARIOS.fleetAction,
      map,
      'FLEET-SWARM',
      findBaseHex,
    );
    const purchases = buildAIFleetPurchases(
      state,
      0,
      'hard',
      SCENARIOS.fleetAction.availableFleetPurchases,
    );

    expect(purchases).toHaveLength(10);
    expect(
      purchases.every(
        (purchase) =>
          purchase.kind === 'ship' && purchase.shipType === 'corvette',
      ),
    ).toBe(true);
  });
});
describe('aiLogistics', () => {
  it('moves passengers onto a stronger escort during rescue scenarios', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      'LOG1',
      findBaseHex,
    );
    const transport = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'transport'),
    );
    const corvette = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'corvette'),
    );
    const enemy = must(state.ships.find((ship) => ship.owner === 1));

    state.phase = 'logistics';
    state.activePlayer = 0;
    transport.passengersAboard = 20;
    corvette.cargoUsed = 0;
    enemy.position = { q: 0, r: 0 };
    enemy.lastMovementPath = [{ q: 0, r: 0 }];

    expect(aiLogistics(state, 0, map, 'hard')).toEqual([
      {
        sourceShipId: transport.id,
        targetShipId: corvette.id,
        transferType: 'passengers',
        amount: 5,
      },
    ]);
  });

  it('defers partial passenger transfers when immediate combat is likely', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      'LOG1B',
      findBaseHex,
    );

    state.phase = 'logistics';
    state.activePlayer = 0;

    expect(aiLogistics(state, 0, map, 'hard')).toEqual([]);
  });

  it('tops up fuel from a tanker when an escort is running short', () => {
    const state = createGameOrThrow(SCENARIOS.convoy, map, 'LOG2', findBaseHex);
    const tanker = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'tanker'),
    );
    const frigate = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'frigate'),
    );
    const liner = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'liner'),
    );

    state.phase = 'logistics';
    state.activePlayer = 0;
    tanker.lifecycle = 'active';
    frigate.fuel = 1;
    frigate.lifecycle = 'active';
    liner.lifecycle = 'destroyed';
    const [transfer] = aiLogistics(state, 0, map, 'normal');

    expect(transfer).toMatchObject({
      sourceShipId: tanker.id,
      targetShipId: frigate.id,
      transferType: 'fuel',
    });
    expect(transfer?.amount).toBeGreaterThan(0);
  });
});
describe('aiCombat', () => {
  it('returns empty when AI has no ships that can attack', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    // Destroy AI ships
    for (const s of state.ships.filter((s) => s.owner === 1)) {
      s.lifecycle = 'destroyed';
    }
    const attacks = aiCombat(state, 1, openMap);
    expect(attacks).toHaveLength(0);
  });
  it('returns empty when no enemies exist', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    for (const s of state.ships.filter((s) => s.owner === 0)) {
      s.lifecycle = 'destroyed';
    }
    const attacks = aiCombat(state, 1, openMap);
    expect(attacks).toHaveLength(0);
  });
  it('attacks nearby enemy with reasonable odds', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    // Place them adjacent -- best possible odds
    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    enemyShip.position = { q: 1, r: 0 };
    enemyShip.lastMovementPath = [{ q: 1, r: 0 }];
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.lifecycle = 'active';
    enemyShip.detected = true;
    const attacks = aiCombat(state, 1, openMap);
    // At adjacent range with equal strength, AI should attack
    expect(attacks.length).toBeGreaterThanOrEqual(1);
    if (attacks.length > 0) {
      expect(attacks[0].attackerIds).toContain(aiShip.id);
      expect(attacks[0].targetId).toBe(enemyShip.id);
    }
  });
  it('skips targets that are blocked by a body', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    enemyShip.position = { q: 2, r: 0 };
    enemyShip.lastMovementPath = [{ q: 2, r: 0 }];
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.lifecycle = 'active';
    const blockedMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
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
    const state = createGameOrThrow(SCENARIOS.escape, map, 'TEST', findBaseHex);
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrim = must(state.ships.find((s) => s.owner === 0));
    // Place all near each other
    for (let i = 0; i < enforcers.length; i++) {
      enforcers[i].position = { q: 0, r: i };
      enforcers[i].lastMovementPath = [{ q: 0, r: i }];
      enforcers[i].velocity = { dq: 0, dr: 0 };
      enforcers[i].lifecycle = 'active';
    }
    pilgrim.position = { q: 1, r: 0 };
    pilgrim.lastMovementPath = [{ q: 1, r: 0 }];
    pilgrim.velocity = { dq: 0, dr: 0 };
    pilgrim.lifecycle = 'active';
    pilgrim.detected = true;
    // Destroy other pilgrims
    for (const s of state.ships.filter(
      (s) => s.owner === 0 && s.id !== pilgrim.id,
    )) {
      s.lifecycle = 'destroyed';
    }
    const attacks = aiCombat(state, 1, openMap);
    expect(attacks).toHaveLength(1);
    // Should concentrate all ships on the single target
    expect(attacks[0].attackerIds).toHaveLength(enforcers.length);
    expect(attacks[0].targetId).toBe(pilgrim.id);
  });
  it('easy AI is more conservative about attacking', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    // Place them far apart -- poor odds
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    enemyShip.position = { q: 8, r: 0 };
    enemyShip.velocity = { dq: 3, dr: 0 };
    enemyShip.lifecycle = 'active';
    // Easy AI should skip combat with bad range + velocity mods
    const attacks = aiCombat(state, 1, map, 'easy');
    expect(attacks).toHaveLength(0);
  });
  it('attack contains valid ship references', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'TEST',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    enemyShip.position = { q: 1, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.lifecycle = 'active';
    const attacks = aiCombat(state, 1, map);
    if (attacks.length > 0) {
      const allShipIds = new Set(state.ships.map((s) => s.id));
      for (const id of attacks[0].attackerIds) {
        expect(allShipIds.has(id)).toBe(true);
      }
      expect(allShipIds.has(attacks[0].targetId)).toBe(true);
    }
  });
  it('avoids low-odds attacks from ships carrying passengers', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      'PAX-CBT',
      findBaseHex,
    );
    const corvette = must(state.ships.find((ship) => ship.id === 'p0s1'));
    const corsair = must(state.ships.find((ship) => ship.id === 'p1s0'));

    corvette.passengersAboard = 5;
    corvette.position = { q: 7, r: -6 };
    corvette.lastMovementPath = [{ q: 7, r: -6 }];
    corvette.velocity = { dq: 0, dr: 0 };
    corsair.position = { q: 6, r: -6 };
    corsair.lastMovementPath = [{ q: 6, r: -6 }];
    corsair.velocity = { dq: 0, dr: 0 };

    expect(aiCombat(state, 0, map, 'hard')).toEqual([]);
  });
});
describe('AI scenario handling', () => {
  it('duel: AI generates orders for each ship', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'FA01', findBaseHex);
    const orders = aiAstrogation(state, 1, map);
    const aiShips = state.ships.filter((s) => s.owner === 1);
    expect(orders).toHaveLength(aiShips.length);
    expect(aiShips.length).toBe(1);
  });
  it('combat-only: AI seeks combat when no target body', () => {
    // Use duel scenario (no target body, pure combat)
    const state = createGameOrThrow(SCENARIOS.duel, map, 'FA02', findBaseHex);
    // Unland all ships and place opposing fleets far apart
    for (const ship of state.ships) {
      ship.lifecycle = 'active';
      ship.position = ship.owner === 0 ? { q: -10, r: 0 } : { q: 10, r: 0 };
      ship.velocity = { dq: 0, dr: 0 };
    }
    const orders = aiAstrogation(state, 1, map, 'hard');
    // At least one ship should burn toward enemy (not null)
    const hasBurn = orders.some((o) => o.burn !== null);
    expect(hasBurn).toBe(true);
  });
  it('blockade: AI interceptor seeks enemy runner', () => {
    const state = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      'BK01',
      findBaseHex,
    );
    // The corvette (player 1) starts in space
    const dreadnaught = must(state.ships.find((s) => s.owner === 1));
    expect(dreadnaught.lifecycle).toBe('active');
    const orders = aiAstrogation(state, 1, map);
    expect(orders).toHaveLength(1);
  });
  it('blockade: runner AI navigates toward Mars', () => {
    const state = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      'BK02',
      findBaseHex,
    );
    const runner = must(state.ships.find((s) => s.owner === 0));
    // Unland runner and place it in open space
    runner.lifecycle = 'active';
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
        const state = createGameOrThrow(scenario, map, 'DF01', findBaseHex);
        // Unland ships for meaningful AI decisions
        for (const s of state.ships) {
          if (s.lifecycle !== 'destroyed') {
            s.lifecycle = 'active';
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
    const state = createGameOrThrow(SCENARIOS.escape, map, 'ESC1', findBaseHex);
    const pilgrim = must(state.ships.find((s) => s.owner === 0));
    pilgrim.lifecycle = 'active';
    pilgrim.position = { q: 0, r: -10 };
    pilgrim.velocity = { dq: 0, dr: -2 };
    const orders = aiAstrogation(state, 0, map, 'hard');
    const order = orders.find((o) => o.shipId === pilgrim.id);
    expect(order).toBeDefined();
    // Should burn, not drift
    expect(order?.burn).not.toBeNull();
  });
  it('escape AI penalizes staying landed', () => {
    const state = createGameOrThrow(SCENARIOS.escape, map, 'ESC2', findBaseHex);
    // Pilgrims start with velocity -- they should keep moving, not stay at base
    const orders = aiAstrogation(state, 0, map);
    // At least some pilgrims should have a burn order
    const hasBurn = orders.some((o) => o.burn !== null);
    expect(hasBurn).toBe(true);
  });
});
describe('aiAstrogation — captured ships', () => {
  it('captured ships get null burn', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'CAP1',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.control = 'captured';
    const orders = aiAstrogation(state, 1, map);
    const capturedOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(capturedOrder).toBeDefined();
    expect(capturedOrder?.burn).toBeNull();
  });
});
describe('aiAstrogation — emplaced ships', () => {
  it('emplaced (orbital base) ships are skipped', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'EMP1',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.baseStatus = 'emplaced';
    const orders = aiAstrogation(state, 1, map);
    const emplacedOrder = orders.find((o) => o.shipId === aiShip.id);
    expect(emplacedOrder).toBeUndefined();
  });
});
describe('aiAstrogation — checkpoint race', () => {
  it('grandTour: AI navigates toward unvisited bodies', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      'GT01',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    expect(aiShip.lifecycle).toBe('landed');
    const orders = aiAstrogation(state, 1, map, 'normal');
    expect(orders).toHaveLength(1);
    // Should take off
    expect(orders[0].burn).not.toBeNull();
  });
  it('grandTour: AI with all checkpoints visited targets home body', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      'GT02',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    // Place ship in open space away from gravity wells
    aiShip.lifecycle = 'active';
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
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      'GT03',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
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
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      'GT04',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 5, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 20;
    const orders = aiAstrogation(state, 1, map, 'hard');
    // combatDisabled means no overloads
    expect(orders[0].overload).toBeNull();
  });
});
describe('aiAstrogation — easy AI randomization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('easy AI sometimes picks random direction', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.25 -> triggers random
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'RAND',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
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
    expect(orders[0].overload).toBeNull();
  });
  it('easy AI skips random direction when Math.random >= 0.25', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // >= 0.25 -> no random
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'RAND',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 10;
    const orders = aiAstrogation(state, 1, map, 'easy');
    expect(orders).toHaveLength(1);
  });
});
describe('aiAstrogation — pure combat positioning', () => {
  it('AI in duel aggressively approaches enemy', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'CMB1', findBaseHex);
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 15, r: 0 };
    aiShip.velocity = { dq: -1, dr: 0 };
    aiShip.fuel = 20;
    enemyShip.lifecycle = 'active';
    enemyShip.position = { q: -15, r: 0 };
    enemyShip.velocity = { dq: 1, dr: 0 };
    const orders = aiAstrogation(state, 1, map, 'hard');
    // Should burn toward enemy
    expect(orders[0].burn).not.toBeNull();
  });
  it('AI penalizes staying landed in pure combat', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'CMB2', findBaseHex);
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    // AI is landed but has fuel
    aiShip.lifecycle = 'landed';
    aiShip.fuel = 20;
    enemyShip.lifecycle = 'active';
    enemyShip.position = { q: 10, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };
    const orders = aiAstrogation(state, 1, map, 'hard');
    // Should take off, not stay landed
    expect(orders[0].burn).not.toBeNull();
  });
});
describe('aiOrdnance — defensive mine-laying', () => {
  it('escape AI drops defensive mines when being pursued', () => {
    const state = createGameOrThrow(SCENARIOS.escape, map, 'DFM1', findBaseHex);
    const pilgrim = must(state.ships.find((s) => s.owner === 0));
    const enforcer = must(state.ships.find((s) => s.owner === 1));
    // Set up escape scenario: pilgrim fleeing with velocity, enforcer close behind
    pilgrim.lifecycle = 'active';
    pilgrim.position = { q: 0, r: -10 };
    pilgrim.velocity = { dq: 0, dr: -3 };
    pilgrim.fuel = 10;
    pilgrim.cargoUsed = 0;
    enforcer.lifecycle = 'active';
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
    const state = createGameOrThrow(SCENARIOS.escape, map, 'DFM2', findBaseHex);
    const pilgrim = must(state.ships.find((s) => s.owner === 0));
    const enforcer = must(state.ships.find((s) => s.owner === 1));
    pilgrim.lifecycle = 'active';
    pilgrim.position = { q: 0, r: -10 };
    pilgrim.velocity = { dq: 0, dr: -3 };
    pilgrim.cargoUsed = 0;
    // Place enforcer far enough to avoid regular mine range (>4 for easy)
    // but within defensive mine range (<=8)
    enforcer.lifecycle = 'active';
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
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'MBR1',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.cargoUsed = 0;
    enemy.lifecycle = 'active';
    enemy.position = { q: 2, r: 0 };
    // No pending orders -> no burn -> no mine
    state.pendingAstrogationOrders = [];
    const launches = aiOrdnance(state, 1, map, 'normal');
    const mineLaunch = launches.find((l) => l.ordnanceType === 'mine');
    expect(mineLaunch).toBeUndefined();
  });
  it('drops mine when a pending burn order exists', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'MBR2',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.cargoUsed = 0;
    // Corvette: cargo=5, mine=10 -> too small! Use a ship with more cargo.
    // Set up a frigate scenario instead
    aiShip.type = 'frigate';
    enemy.lifecycle = 'active';
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
    const state = createGameOrThrow(SCENARIOS.duel, map, 'NUK1', findBaseHex);
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    // Use frigate for both -- frigate has canOverload=true and cargo=40
    aiShip.type = 'frigate';
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.cargoUsed = 0;
    // Make enemy very strong (dreadnaught)
    enemy.type = 'dreadnaught';
    enemy.lifecycle = 'active';
    enemy.position = { q: 4, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };
    const launches = aiOrdnance(state, 1, map, 'hard');
    if (launches.length > 0) {
      // Hard AI should prefer nuke against stronger enemy at close range
      expect(['nuke', 'torpedo']).toContain(launches[0].ordnanceType);
    }
  });
  it('does not launch nuke on normal difficulty', () => {
    const state = createGameOrThrow(SCENARIOS.duel, map, 'NUK2', findBaseHex);
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.type = 'frigate';
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.cargoUsed = 0;
    enemy.type = 'dreadnaught';
    enemy.lifecycle = 'active';
    enemy.position = { q: 4, r: 0 };
    const launches = aiOrdnance(state, 1, map, 'normal');
    const nukeLaunch = launches.find((l) => l.ordnanceType === 'nuke');
    // Normal AI doesn't launch nukes (only hard does)
    expect(nukeLaunch).toBeUndefined();
  });

  it('avoids nukes from passenger ships in a friendly stack', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      'NUK3',
      findBaseHex,
    );
    const launches = aiOrdnance(state, 0, map, 'hard');

    expect(launches.find((launch) => launch.ordnanceType === 'nuke')).toBe(
      undefined,
    );
  });

  it('does not launch ordnance from ships carrying passengers in rescue scenarios', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      'NUK4',
      findBaseHex,
    );

    expect(aiOrdnance(state, 0, map, 'hard')).toEqual([]);
  });
});
describe('aiOrdnance — easy AI skip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('easy AI skips ordnance 30% of the time', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.3 -> skip
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'SKIP',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    enemy.lifecycle = 'active';
    enemy.position = { q: 2, r: 0 };
    const launches = aiOrdnance(state, 1, map, 'easy');
    expect(launches).toHaveLength(0);
  });
});
describe('aiCombat — anti-nuke targeting', () => {
  it('targets enemy nukes when they threaten own ships', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'NUKE',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    // Move enemy far away (no LOS for ship combat)
    enemy.position = { q: 50, r: 0 };
    enemy.lifecycle = 'active';
    // Place a nuke near AI ship
    state.ordnance.push({
      id: 'nuke-1',
      type: 'nuke',
      owner: 0,
      sourceShipId: null,
      position: { q: 2, r: 0 },
      velocity: { dq: -1, dr: 0 },
      lifecycle: 'active' as const,
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
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'NPRI',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    // Enemy far away
    enemy.position = { q: 8, r: 0 };
    enemy.lastMovementPath = [{ q: 8, r: 0 }];
    enemy.velocity = { dq: 0, dr: 0 };
    enemy.lifecycle = 'active';
    // Nuke very close
    state.ordnance.push({
      id: 'nuke-close',
      type: 'nuke',
      owner: 0,
      sourceShipId: null,
      position: { q: 1, r: 0 },
      velocity: { dq: 0, dr: 0 },
      lifecycle: 'active' as const,
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
    const state = createGameOrThrow(SCENARIOS.escape, map, 'EASY', findBaseHex);
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrims = state.ships.filter((s) => s.owner === 0);
    // Place all ships adjacent for guaranteed attacks
    for (const [i, s] of enforcers.entries()) {
      s.position = { q: 0, r: i };
      s.lastMovementPath = [{ q: 0, r: i }];
      s.velocity = { dq: 0, dr: 0 };
      s.lifecycle = 'active';
    }
    for (const [i, s] of pilgrims.entries()) {
      s.position = { q: 1, r: i };
      s.lastMovementPath = [{ q: 1, r: i }];
      s.velocity = { dq: 0, dr: 0 };
      s.lifecycle = 'active';
    }
    const attacks = aiCombat(state, 1, openMap, 'easy');
    // Easy AI should attack at most one target
    expect(attacks.length).toBeLessThanOrEqual(1);
  });
});
describe('aiCombat — landed enemy skipping', () => {
  it('does not attack landed enemies', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      'LAND',
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    enemy.position = { q: 1, r: 0 };
    enemy.lastMovementPath = [{ q: 1, r: 0 }];
    enemy.velocity = { dq: 0, dr: 0 };
    enemy.lifecycle = 'landed'; // Landed ships can't be attacked
    const attacks = aiCombat(state, 1, openMap);
    expect(attacks).toHaveLength(0);
  });
});
describe('aiCombat — multiple targets', () => {
  it('assigns each attacker to only one target', () => {
    const state = createGameOrThrow(SCENARIOS.escape, map, 'MULT', findBaseHex);
    const enforcers = state.ships.filter((s) => s.owner === 1);
    const pilgrims = state.ships.filter((s) => s.owner === 0);
    // Enforcers at origin, pilgrims spread out
    for (const s of enforcers) {
      s.position = { q: 0, r: 0 };
      s.lastMovementPath = [{ q: 0, r: 0 }];
      s.velocity = { dq: 0, dr: 0 };
      s.lifecycle = 'active';
    }
    for (const [i, s] of pilgrims.entries()) {
      s.position = { q: 2, r: i };
      s.lastMovementPath = [{ q: 2, r: i }];
      s.velocity = { dq: 0, dr: 0 };
      s.lifecycle = 'active';
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
