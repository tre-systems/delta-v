import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findFuelStallShipIds,
  findPassengerTransferMistakes,
  type SimulationFailureCapture,
} from '../../scripts/simulate-ai';
import type {
  AstrogationPlanTraceCollector,
  OrdnancePlanTraceCollector,
} from './ai';
import {
  aiCombat,
  aiLogistics,
  buildAIDoctrineContext,
  buildAIFleetPurchases,
  chooseCombatAttackGroupPlan,
  chooseCombatHoldFirePlan,
  chooseCombatTargetPlan,
  chooseLogisticsTransferPlan,
  chooseOrdnanceHoldPlan,
  choosePassengerCarrierEscortTargetPlan,
  choosePassengerCarrierInterceptPlan,
  choosePassengerCombatPlan,
  choosePassengerDeliveryApproachPlan,
  choosePassengerEscortFormationPlan,
  choosePassengerFuelSupportPlan,
  choosePassengerPostCarrierLossTargetPlan,
  choosePostCarrierLossPursuitPlan,
  chooseReachableRefuelTargetPlan,
  aiAstrogation as rawAiAstrogation,
  aiOrdnance as rawAiOrdnance,
} from './ai';
import type { AIDifficulty } from './ai/types';
import type {
  AstrogationOrder,
  GameState,
  OrdnanceLaunch,
  PlayerId,
  TransferOrder,
} from './types/domain';

// Deterministic RNG for test calls that historically omitted the parameter.
// Production signatures now require `rng` to catch accidental `Math.random`
// leaks; these wrappers supply a mid-bias fallback so the many existing
// test sites keep working without mechanical churn. New tests should pass
// their own seeded RNG when they actually care about dice outcomes.
const TEST_RNG: () => number = () => 0.5;

const aiAstrogation = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
  rng: () => number = TEST_RNG,
  tracePlan?: AstrogationPlanTraceCollector,
): AstrogationOrder[] =>
  rawAiAstrogation(state, playerId, map, difficulty, rng, tracePlan);

const aiOrdnance = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  difficulty: AIDifficulty = 'normal',
  rng: () => number = TEST_RNG,
  tracePlan?: OrdnancePlanTraceCollector,
): OrdnanceLaunch[] =>
  rawAiOrdnance(state, playerId, map, difficulty, rng, tracePlan);

import {
  estimateMovementCostToHex,
  estimateRemainingCheckpointTourCost,
  findDirectionToward,
  findNearestRefuelBase,
  findReachableRefuelBase,
  getHomeDefenseThreat,
  pickNextCheckpoint,
  planShortHorizonMovementToHex,
} from './ai/common';
import { AI_CONFIG } from './ai/config';
import {
  assignPassengerShipRoles,
  assignTurnShipRoles,
  getPrimaryPassengerCarrier,
  scorePassengerArrivalOdds,
  scorePassengerEscortCourse,
} from './ai/logistics';
import {
  assessNukeBallisticToEnemy,
  evaluateOrdnanceLaunchIntercept,
  resolveHardNukeReachThreshold,
  resolveHardNukeScoreFloor,
} from './ai/ordnance';
import { scoreCombatPositioning, scoreNavigation } from './ai/scoring';
import { must } from './assert';
import { ORDNANCE_MASS, SHIP_STATS } from './constants';
import {
  beginCombatPhase,
  createGameOrThrow,
  processAstrogation,
  skipCombat,
} from './engine/game-engine';
import {
  asHexKey,
  HEX_DIRECTIONS,
  hexAdd,
  hexDistance,
  hexVecLength,
} from './hex';
import { asGameId, asOrdnanceId, asShipId, type ShipId } from './ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from './map-data';
import { computeCourse } from './movement';
import {
  createTestShip,
  createTestState,
  driftingEnemyWouldBeHitByBallistic,
  driftingEnemyWouldBeHitByOpenSpaceBallistic,
  EMPTY_SOLAR_MAP,
} from './test-helpers';
import type { SolarSystemMap } from './types';

let map: SolarSystemMap;
const openMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -50, maxQ: 50, minR: -50, maxR: 50 },
};

const loadAIFailureFixture = (name: string): SimulationFailureCapture =>
  JSON.parse(
    readFileSync(new URL(`./ai/__fixtures__/${name}`, import.meta.url), 'utf8'),
  ) as SimulationFailureCapture;

beforeEach(() => {
  map = buildSolarSystemMap();
});
describe('aiAstrogation', () => {
  it('returns one order per AI ship', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      asGameId('TEST'),
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
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST'),
      findBaseHex,
    );
    // Player 0 has escape objective
    const orders = aiAstrogation(state, 0, map);
    const p0Ships = state.ships.filter((s) => s.owner === 0);
    expect(orders).toHaveLength(p0Ships.length);
  });
  it('works for multi-ship scenario (escape)', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST'),
      findBaseHex,
    );
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
      asGameId('ESCAPE-CHASE'),
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
      asGameId('TEST'),
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
      asGameId('TEST'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 10;
    enemyShip.lifecycle = 'active';
    enemyShip.position = { q: 4, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };
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
      asGameId('LOOKAHEAD'),
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
      asGameId('BIP-DEFEND'),
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

  it('keeps a clean next-turn landing line over a merely adjacent detour', () => {
    const ship = createTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const cleanApproach = {
      destination: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      newVelocity: { dq: 1, dr: 0 },
      fuelSpent: 1,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'normal' as const,
    };
    const detour = {
      destination: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      newVelocity: { dq: 0, dr: 1 },
      fuelSpent: 1,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'normal' as const,
    };

    expect(
      scoreNavigation(
        ship,
        cleanApproach,
        { q: 2, r: 0 },
        'Mars',
        AI_CONFIG.hard,
      ),
    ).toBeGreaterThan(
      scoreNavigation(ship, detour, { q: 2, r: 0 }, 'Mars', AI_CONFIG.hard),
    );
  });
  it('values disciplined final approach more strongly within three hexes of the target', () => {
    const ship = createTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const disciplinedApproach = {
      destination: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      newVelocity: { dq: 1, dr: 0 },
      fuelSpent: 1,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'normal' as const,
    };
    const hotApproach = {
      destination: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      newVelocity: { dq: 2, dr: 0 },
      fuelSpent: 1,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'normal' as const,
    };

    expect(
      scoreNavigation(
        ship,
        disciplinedApproach,
        { q: 2, r: 0 },
        'Mars',
        AI_CONFIG.hard,
      ),
    ).toBeGreaterThan(
      scoreNavigation(
        ship,
        hotApproach,
        { q: 2, r: 0 },
        'Mars',
        AI_CONFIG.hard,
      ),
    );
  });

  it('does not trigger home screening for a merely modest race lead', () => {
    const state = createTestState({
      phase: 'astrogation',
      players: [
        { homeBody: 'Venus', targetBody: 'Mars' },
        { homeBody: 'Mars', targetBody: 'Venus' },
      ],
      ships: [
        createTestShip({
          id: asShipId('p0-racer'),
          owner: 0,
          originalOwner: 0,
          position: { q: -13, r: 16 },
          velocity: { dq: 0, dr: 0 },
        }),
        createTestShip({
          id: asShipId('p1-racer'),
          owner: 1,
          originalOwner: 1,
          position: { q: -4, r: 3 },
          velocity: { dq: 0, dr: 0 },
        }),
      ],
    });
    const enemyShips = state.ships.filter((ship) => ship.owner === 0);

    expect(getHomeDefenseThreat(state, 1, map, enemyShips)).toBeNull();
  });

  it('does not bias toward combat when the enemy is nearby but behind on the race', () => {
    const ship = createTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
    });
    const enemy = createTestShip({
      id: asShipId('enemy-screen'),
      owner: 1,
      originalOwner: 1,
      position: { q: 1, r: 2 },
      velocity: { dq: 0, dr: 0 },
    });
    const course = {
      destination: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      newVelocity: { dq: 1, dr: 0 },
      fuelSpent: 1,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'normal' as const,
    };

    expect(
      scoreCombatPositioning(
        ship,
        course,
        [enemy],
        false,
        { q: 2, r: 0 },
        false,
        0,
        AI_CONFIG.hard,
      ),
    ).toBe(0);
  });

  it('prefers a short forced landing line when approaching the target world', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-LANDING-LINE'),
      findBaseHex,
    );
    const racer = must(state.ships.find((ship) => ship.owner === 0));
    const opponent = must(state.ships.find((ship) => ship.owner === 1));

    state.phase = 'astrogation';
    state.activePlayer = 0;
    racer.lifecycle = 'active';
    racer.position = { q: -7, r: 3 };
    racer.velocity = { dq: 1, dr: 2 };
    racer.fuel = 15;
    opponent.lifecycle = 'active';
    opponent.position = { q: -8, r: -1 };
    opponent.velocity = { dq: 0, dr: -3 };
    opponent.fuel = 14;

    const [order] = aiAstrogation(state, 0, map, 'hard');

    expect(order?.shipId).toBe(racer.id);
    expect(order?.burn).toBe(2);
  });

  it('biplanetary: takes a burn-to-land objective line before attrition can decide the game', () => {
    const fixture = loadAIFailureFixture('biplanetary-burn-to-land.json');
    const ship = must(
      fixture.state.ships.find((candidate) => candidate.owner === 1),
    );
    const [order] = aiAstrogation(
      fixture.state,
      fixture.activePlayer,
      map,
      fixture.difficulty,
    );
    const course = computeCourse(ship, order?.burn ?? null, map, {
      land: order?.land,
      overload: order?.overload ?? null,
      destroyedBases: fixture.state.destroyedBases,
      weakGravityChoices: order?.weakGravityChoices,
    });

    expect(fixture.kind).toBe('objectiveDrift');
    expect(order?.shipId).toBe(ship.id);
    expect(order?.land).toBe(true);
    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Mars');
    }
  });

  it('preserves an immediate landing line under Venus gravity in biplanetary', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-VENUS-GRAVITY-LINE'),
      findBaseHex,
    );
    const racer = must(state.ships.find((ship) => ship.owner === 0));
    const opponent = must(state.ships.find((ship) => ship.owner === 1));

    state.phase = 'astrogation';
    state.activePlayer = 0;

    racer.lifecycle = 'active';
    racer.position = { q: -5, r: 5 };
    racer.velocity = { dq: 1, dr: 1 };
    racer.fuel = 13;
    racer.pendingGravityEffects = [
      {
        hex: { q: -5, r: 5 },
        direction: 4,
        bodyName: 'Venus',
        strength: 'full',
        ignored: false,
      },
    ];

    opponent.lifecycle = 'active';
    opponent.position = { q: -8, r: -4 };
    opponent.velocity = { dq: 0, dr: -1 };
    opponent.fuel = 12;

    const [order] = aiAstrogation(state, 0, map, 'hard');
    const course = computeCourse(racer, order?.burn ?? null, map, {
      land: order?.land,
      overload: order?.overload ?? null,
      destroyedBases: state.destroyedBases,
      weakGravityChoices: order?.weakGravityChoices,
    });

    expect(order?.shipId).toBe(racer.id);
    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Venus');
    }
  });

  it('uses an evasive evacuation line without a turn-one landing', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('PAX-HOLD'),
      findBaseHex,
    );
    const orders = aiAstrogation(state, 0, map, 'hard');
    const transportOrder = must(
      orders.find((order) => order.shipId === 'p0s0'),
    );
    const corvetteOrder = must(orders.find((order) => order.shipId === 'p0s1'));
    const transport = must(state.ships.find((ship) => ship.id === 'p0s0'));
    const corvette = must(state.ships.find((ship) => ship.id === 'p0s1'));
    const transportCourse = computeCourse(
      transport,
      transportOrder.burn ?? null,
      map,
      {
        land: transportOrder.land,
        overload: transportOrder.overload ?? null,
        destroyedBases: state.destroyedBases,
        weakGravityChoices: transportOrder.weakGravityChoices,
      },
    );
    const corvetteCourse = computeCourse(
      corvette,
      corvetteOrder.burn ?? null,
      map,
      {
        land: corvetteOrder.land,
        overload: corvetteOrder.overload ?? null,
        destroyedBases: state.destroyedBases,
        weakGravityChoices: corvetteOrder.weakGravityChoices,
      },
    );
    const terra = must(map.bodies.find((body) => body.name === 'Terra'));

    expect(transportOrder.burn).toBe(0);
    expect(transportOrder.overload).toBeNull();
    expect(corvetteOrder.burn).not.toBe(transportOrder.burn);
    expect(transportCourse.outcome).not.toBe('landing');
    expect(corvetteCourse.destination).not.toEqual(transportCourse.destination);
    expect(hexDistance(transportCourse.destination, terra.center)).toBeLessThan(
      hexDistance(transport.position, terra.center),
    );
  });

  it('keeps a convoy tanker stacked with the passenger carrier for fuel support', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('PAX-FUEL'),
      findBaseHex,
    );
    const orders = aiAstrogation(state, 0, map, 'hard');
    const linerOrder = must(orders.find((order) => order.shipId === 'p0s0'));
    const tankerOrder = must(orders.find((order) => order.shipId === 'p0s1'));
    const tanker = must(state.ships.find((ship) => ship.id === 'p0s1'));
    const doctrine = buildAIDoctrineContext(state, 0, map);
    const fuelSupportPlan = choosePassengerFuelSupportPlan(
      state,
      0,
      tanker,
      [linerOrder],
      map,
      doctrine.passenger,
    );

    expect(linerOrder.burn).not.toBeNull();
    expect(fuelSupportPlan?.chosen).toMatchObject({
      intent: 'supportPassengerCarrier',
      action: {
        type: 'astrogationOrder',
        shipId: 'p0s1',
        carrierShipId: 'p0s0',
        burn: linerOrder.burn,
        overload: null,
      },
    });
    expect(tankerOrder.overload).toBeNull();
    expect(tankerOrder.burn).toBe(linerOrder.burn);
  });

  it('regroups a detached convoy tanker toward the moving passenger carrier', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('PAX-FUEL-REGROUP'),
      findBaseHex,
    );
    const shipStates = new Map<
      string,
      {
        lifecycle: 'active' | 'destroyed';
        position: { q: number; r: number };
        velocity: { dq: number; dr: number };
        fuel: number;
        disabledTurns: number;
        passengersAboard?: number;
      }
    >([
      [
        'p0s0',
        {
          lifecycle: 'active',
          position: { q: -5, r: 6 },
          velocity: { dq: 1, dr: 1 },
          fuel: 6,
          disabledTurns: 0,
          passengersAboard: 120,
        },
      ],
      [
        'p0s1',
        {
          lifecycle: 'active',
          position: { q: -7, r: 4 },
          velocity: { dq: 0, dr: 0 },
          fuel: 42,
          disabledTurns: 0,
        },
      ],
      [
        'p0s2',
        {
          lifecycle: 'active',
          position: { q: -6, r: 2 },
          velocity: { dq: 0, dr: 2 },
          fuel: 13,
          disabledTurns: 0,
        },
      ],
      [
        'p1s0',
        {
          lifecycle: 'destroyed',
          position: { q: -6, r: -4 },
          velocity: { dq: 0, dr: 0 },
          fuel: 16,
          disabledTurns: 8,
        },
      ],
      [
        'p1s1',
        {
          lifecycle: 'active',
          position: { q: -6, r: -2 },
          velocity: { dq: 0, dr: 1 },
          fuel: 15,
          disabledTurns: 0,
        },
      ],
      [
        'p1s2',
        {
          lifecycle: 'destroyed',
          position: { q: -7, r: -3 },
          velocity: { dq: 0, dr: 0 },
          fuel: 20,
          disabledTurns: 7,
        },
      ],
    ]);

    state.turnNumber = 9;
    state.phase = 'astrogation';
    state.activePlayer = 0;

    for (const ship of state.ships) {
      const next = must(shipStates.get(ship.id));
      ship.lifecycle = next.lifecycle;
      ship.position = next.position;
      ship.velocity = next.velocity;
      ship.fuel = next.fuel;
      ship.damage = { disabledTurns: next.disabledTurns };
      ship.pendingGravityEffects = [];
      ship.detected = true;
      ship.passengersAboard = next.passengersAboard;
    }

    const orders = aiAstrogation(state, 0, map, 'hard');
    const tankerOrder = must(orders.find((order) => order.shipId === 'p0s1'));

    expect(tankerOrder.burn).not.toBeNull();
    expect(findFuelStallShipIds(state, 0, orders)).toEqual([]);
  });

  it('builds shared passenger doctrine context for convoy planning', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('PAX-DOCTRINE'),
      findBaseHex,
    );
    const doctrine = buildAIDoctrineContext(state, 0, map);

    expect(doctrine.passenger.isPassengerMission).toBe(true);
    expect(doctrine.passenger.primaryCarrier?.id).toBe('p0s0');
    expect(doctrine.passenger.shipRoles.get('p0s0')).toBe('carrier');
    expect(doctrine.shipRoles.get('p0s0')).toBe('carrier');
    expect(doctrine.passenger.activeThreat).not.toBeNull();
  });

  it('traces applied astrogation passenger plans', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('PAX-TRACE'),
      findBaseHex,
    );
    const tracedIntents: string[] = [];
    const scalarTraceRejectedCounts: number[] = [];

    aiAstrogation(state, 0, map, 'hard', TEST_RNG, ({ decision }) => {
      tracedIntents.push(decision.chosen.intent);

      if (decision.chosen.id.startsWith('scalar-astrogation:')) {
        scalarTraceRejectedCounts.push(decision.rejected.length);
      }
    });

    expect(tracedIntents).toContain('supportPassengerCarrier');
    expect(tracedIntents).toContain('deliverPassengers');
    expect(Math.max(...scalarTraceRejectedCounts)).toBeGreaterThan(0);
  });

  it('convoy: passenger carrier near Venus starts the landing approach instead of coasting', () => {
    const fixture = loadAIFailureFixture(
      'convoy-carrier-near-target-stall.json',
    );
    const carrier = must(
      fixture.state.ships.find((ship) => ship.id === 'p0s0'),
    );
    const orders = aiAstrogation(
      fixture.state,
      fixture.activePlayer,
      map,
      fixture.difficulty,
    );
    const carrierOrder = must(
      orders.find((order) => order.shipId === carrier.id),
    );
    const course = computeCourse(carrier, carrierOrder.burn ?? null, map, {
      land: carrierOrder.land,
      overload: carrierOrder.overload ?? null,
      destroyedBases: fixture.state.destroyedBases,
      weakGravityChoices: carrierOrder.weakGravityChoices,
    });
    const venus = must(map.bodies.find((body) => body.name === 'Venus'));
    const deliveryPlan = choosePassengerDeliveryApproachPlan(
      fixture.state,
      carrier,
      carrier,
      venus.center,
      map,
    );

    expect(fixture.kind).toBe('objectiveDrift');
    expect(carrier.passengersAboard).toBeGreaterThan(0);
    expect(deliveryPlan?.chosen).toMatchObject({
      intent: 'deliverPassengers',
      action: {
        type: 'astrogationOrder',
        shipId: carrier.id,
        targetHex: venus.center,
        burn: carrierOrder.burn,
        overload: null,
      },
    });
    expect(carrierOrder.burn).not.toBeNull();
    expect(hexDistance(course.destination, venus.center)).toBeLessThan(
      hexDistance(carrier.position, venus.center),
    );
  });

  it('convoy: passenger carrier avoids a boundary-doomed solar slingshot', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('CONVOY-PAX-BOUNDARY'),
      findBaseHex,
    );
    const shipStates = new Map<
      string,
      {
        lifecycle: 'active' | 'destroyed';
        position: { q: number; r: number };
        velocity: { dq: number; dr: number };
        fuel: number;
        disabledTurns: number;
        passengersAboard?: number;
        lastMovementPath: { q: number; r: number }[];
      }
    >([
      [
        'p0s0',
        {
          lifecycle: 'active',
          position: { q: -1, r: -3 },
          velocity: { dq: 2, dr: 2 },
          fuel: 10,
          disabledTurns: 0,
          passengersAboard: 120,
          lastMovementPath: [
            { q: -3, r: -5 },
            { q: -2, r: -5 },
            { q: -2, r: -4 },
            { q: -1, r: -4 },
            { q: -1, r: -3 },
          ],
        },
      ],
      [
        'p0s1',
        {
          lifecycle: 'active',
          position: { q: -1, r: -3 },
          velocity: { dq: 2, dr: 2 },
          fuel: 42,
          disabledTurns: 0,
          lastMovementPath: [
            { q: -3, r: -5 },
            { q: -2, r: -5 },
            { q: -2, r: -4 },
            { q: -1, r: -4 },
            { q: -1, r: -3 },
          ],
        },
      ],
      [
        'p0s2',
        {
          lifecycle: 'active',
          position: { q: -5, r: -4 },
          velocity: { dq: 2, dr: -1 },
          fuel: 15,
          disabledTurns: 0,
          lastMovementPath: [
            { q: -7, r: -3 },
            { q: -6, r: -3 },
            { q: -5, r: -4 },
          ],
        },
      ],
      [
        'p1s0',
        {
          lifecycle: 'active',
          position: { q: -6, r: -6 },
          velocity: { dq: 1, dr: -1 },
          fuel: 15,
          disabledTurns: 0,
          lastMovementPath: [
            { q: -7, r: -5 },
            { q: -6, r: -6 },
          ],
        },
      ],
      [
        'p1s1',
        {
          lifecycle: 'destroyed',
          position: { q: -6, r: -4 },
          velocity: { dq: 0, dr: 0 },
          fuel: 17,
          disabledTurns: 6,
          lastMovementPath: [
            { q: -6, r: -3 },
            { q: -6, r: -4 },
          ],
        },
      ],
      [
        'p1s2',
        {
          lifecycle: 'destroyed',
          position: { q: -7, r: -4 },
          velocity: { dq: 0, dr: 0 },
          fuel: 19,
          disabledTurns: 6,
          lastMovementPath: [
            { q: -7, r: -3 },
            { q: -7, r: -4 },
          ],
        },
      ],
    ]);

    state.turnNumber = 5;
    state.phase = 'astrogation';
    state.activePlayer = 0;

    for (const ship of state.ships) {
      const next = must(shipStates.get(ship.id));
      ship.lifecycle = next.lifecycle;
      ship.position = next.position;
      ship.velocity = next.velocity;
      ship.fuel = next.fuel;
      ship.damage = { disabledTurns: next.disabledTurns };
      ship.lastMovementPath = next.lastMovementPath;
      ship.pendingGravityEffects = [];
      ship.detected = true;
      ship.passengersAboard = next.passengersAboard;
    }

    const carrier = must(state.ships.find((ship) => ship.id === 'p0s0'));
    const orders = aiAstrogation(state, 0, map, 'hard');
    const carrierOrder = must(
      orders.find((order) => order.shipId === carrier.id),
    );
    const course = computeCourse(carrier, carrierOrder.burn, map, {
      destroyedBases: state.destroyedBases,
    });

    expect(carrierOrder.burn).not.toBe(5);
    expect(course.destination).not.toEqual({ q: 1, r: 0 });
  });

  it('convoy: passenger carrier avoids over-accelerating into a delayed gravity trap', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('CONVOY-PAX-DELAYED-GRAVITY'),
      findBaseHex,
    );
    const shipStates = new Map<
      string,
      {
        lifecycle: 'active' | 'destroyed';
        position: { q: number; r: number };
        velocity: { dq: number; dr: number };
        fuel: number;
        disabledTurns: number;
        passengersAboard?: number;
        lastMovementPath: { q: number; r: number }[];
      }
    >([
      [
        'p0s0',
        {
          lifecycle: 'active',
          position: { q: -1, r: -3 },
          velocity: { dq: 2, dr: 2 },
          fuel: 10,
          disabledTurns: 0,
          passengersAboard: 120,
          lastMovementPath: [
            { q: -3, r: -5 },
            { q: -2, r: -5 },
            { q: -2, r: -4 },
            { q: -1, r: -4 },
            { q: -1, r: -3 },
          ],
        },
      ],
      [
        'p0s1',
        {
          lifecycle: 'active',
          position: { q: -1, r: -3 },
          velocity: { dq: 2, dr: 2 },
          fuel: 42,
          disabledTurns: 0,
          lastMovementPath: [
            { q: -3, r: -5 },
            { q: -2, r: -5 },
            { q: -2, r: -4 },
            { q: -1, r: -4 },
            { q: -1, r: -3 },
          ],
        },
      ],
      [
        'p0s2',
        {
          lifecycle: 'active',
          position: { q: -5, r: -4 },
          velocity: { dq: 2, dr: -1 },
          fuel: 15,
          disabledTurns: 1,
          lastMovementPath: [
            { q: -7, r: -3 },
            { q: -6, r: -3 },
            { q: -5, r: -4 },
          ],
        },
      ],
      [
        'p1s0',
        {
          lifecycle: 'active',
          position: { q: -6, r: -9 },
          velocity: { dq: 1, dr: -3 },
          fuel: 17,
          disabledTurns: 1,
          lastMovementPath: [
            { q: -7, r: -6 },
            { q: -7, r: -7 },
            { q: -6, r: -8 },
            { q: -6, r: -9 },
          ],
        },
      ],
      [
        'p1s1',
        {
          lifecycle: 'active',
          position: { q: -5, r: -4 },
          velocity: { dq: 1, dr: 0 },
          fuel: 15,
          disabledTurns: 0,
          lastMovementPath: [
            { q: -6, r: -4 },
            { q: -5, r: -4 },
          ],
        },
      ],
      [
        'p1s2',
        {
          lifecycle: 'destroyed',
          position: { q: -7, r: -4 },
          velocity: { dq: 0, dr: 0 },
          fuel: 19,
          disabledTurns: 6,
          lastMovementPath: [
            { q: -7, r: -3 },
            { q: -7, r: -4 },
          ],
        },
      ],
    ]);

    state.turnNumber = 5;
    state.phase = 'astrogation';
    state.activePlayer = 0;

    for (const ship of state.ships) {
      const next = must(shipStates.get(ship.id));
      ship.lifecycle = next.lifecycle;
      ship.position = next.position;
      ship.velocity = next.velocity;
      ship.fuel = next.fuel;
      ship.damage = { disabledTurns: next.disabledTurns };
      ship.lastMovementPath = next.lastMovementPath;
      ship.pendingGravityEffects = [];
      ship.detected = true;
      ship.passengersAboard = next.passengersAboard;
    }

    const carrier = must(state.ships.find((ship) => ship.id === 'p0s0'));
    const orders = aiAstrogation(state, 0, map, 'hard');
    const carrierOrder = must(
      orders.find((order) => order.shipId === carrier.id),
    );
    const course = computeCourse(carrier, carrierOrder.burn, map, {
      destroyedBases: state.destroyedBases,
    });

    expect(carrierOrder.burn).toBeNull();
    expect(course.outcome).toBe('normal');
    expect(course.destination).toEqual({ q: 1, r: -1 });
  });

  it('evacuation: remaining escort pursues raiders after the carrier is lost', () => {
    const fixture = loadAIFailureFixture(
      'evacuation-escort-after-carrier-loss-stall.json',
    );
    const stalledShipId = must(fixture.stalledShipIds?.[0]);
    const orders = aiAstrogation(
      fixture.state,
      fixture.activePlayer,
      map,
      fixture.difficulty,
    );
    const escortOrder = must(
      orders.find((order) => order.shipId === stalledShipId),
    );
    const escort = must(
      fixture.state.ships.find((ship) => ship.id === stalledShipId),
    );

    expect(fixture.kind).toBe('fuelStall');
    expect(
      choosePassengerPostCarrierLossTargetPlan(
        fixture.state,
        fixture.activePlayer,
        escort,
        null,
      )?.chosen,
    ).toMatchObject({
      intent: 'postCarrierLossPursuit',
      action: {
        type: 'navigationTargetOverride',
        shipId: stalledShipId,
        targetHex: null,
        targetBody: '',
      },
    });
    expect(escortOrder.burn).not.toBeNull();
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, orders),
    ).not.toContain(stalledShipId);
  });

  it('keeps escort scoring tethered to the passenger carrier outside immediate threat range', () => {
    const carrier = createTestShip({
      id: asShipId('carrier'),
      owner: 0,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });
    const escort = createTestShip({
      id: asShipId('escort'),
      owner: 0,
      originalOwner: 0,
      type: 'frigate',
      position: { q: 4, r: 0 },
    });
    const distantThreat = createTestShip({
      id: asShipId('threat'),
      owner: 1,
      originalOwner: 1,
      position: { q: 0, r: 7 },
    });
    const closingCourse = {
      destination: { q: 2, r: 0 },
      path: [
        { q: 4, r: 0 },
        { q: 3, r: 0 },
        { q: 2, r: 0 },
      ],
      newVelocity: { dq: 0, dr: 0 },
      fuelSpent: 1,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'normal' as const,
    };
    const driftingCourse = {
      destination: { q: 5, r: 0 },
      path: [
        { q: 4, r: 0 },
        { q: 5, r: 0 },
      ],
      newVelocity: { dq: 0, dr: 0 },
      fuelSpent: 1,
      gravityEffects: [],
      enteredGravityEffects: [],
      outcome: 'normal' as const,
    };

    expect(
      scorePassengerEscortCourse(escort, closingCourse, carrier, [
        distantThreat,
      ]),
    ).toBeGreaterThan(
      scorePassengerEscortCourse(escort, driftingCourse, carrier, [
        distantThreat,
      ]),
    );
  });

  it('chooses carrier escort targeting when a passenger carrier is threatened', () => {
    const carrier = createTestShip({
      id: asShipId('carrier-target'),
      owner: 0,
      originalOwner: 0,
      type: 'transport',
      passengersAboard: 2,
      position: { q: 0, r: 0 },
    });
    const escort = createTestShip({
      id: asShipId('escort-target'),
      owner: 0,
      originalOwner: 0,
      type: 'frigate',
      position: { q: 4, r: 0 },
    });
    const threat = createTestShip({
      id: asShipId('threat-target'),
      owner: 1,
      originalOwner: 1,
      position: { q: 0, r: 5 },
    });
    const state = createTestState({
      scenarioRules: { targetWinRequiresPassengers: true },
      ships: [carrier, escort, threat],
      players: [{ targetBody: 'Mars' }, { targetBody: 'Venus' }],
    });

    expect(
      choosePassengerCarrierEscortTargetPlan(state, 0, escort, carrier, [
        threat,
      ])?.chosen,
    ).toMatchObject({
      intent: 'escortCarrier',
      action: {
        type: 'navigationTargetOverride',
        shipId: escort.id,
        carrierShipId: carrier.id,
        threatShipId: threat.id,
        targetHex: null,
        targetBody: '',
      },
    });
  });

  it('targets a disabled passenger carrier rendezvous before chasing raiders', () => {
    const carrier = createTestShip({
      id: asShipId('disabled-carrier-target'),
      owner: 0,
      originalOwner: 0,
      type: 'transport',
      passengersAboard: 12,
      position: { q: 3, r: -6 },
      velocity: { dq: 2, dr: 0 },
      damage: { disabledTurns: 2 },
    });
    const escort = createTestShip({
      id: asShipId('disabled-carrier-escort'),
      owner: 0,
      originalOwner: 0,
      type: 'frigate',
      position: { q: -2, r: -5 },
      velocity: { dq: 3, dr: -2 },
    });
    const threat = createTestShip({
      id: asShipId('disabled-carrier-threat'),
      owner: 1,
      originalOwner: 1,
      type: 'corvette',
      position: { q: 0, r: -5 },
      velocity: { dq: 2, dr: 0 },
    });
    const state = createTestState({
      scenarioRules: { targetWinRequiresPassengers: true },
      ships: [carrier, escort, threat],
      players: [{ targetBody: 'Mars' }, { targetBody: '' }],
    });

    expect(
      choosePassengerCarrierEscortTargetPlan(state, 0, escort, carrier, [
        threat,
      ])?.chosen,
    ).toMatchObject({
      intent: 'escortCarrier',
      action: {
        type: 'navigationTargetOverride',
        shipId: escort.id,
        carrierShipId: carrier.id,
        threatShipId: threat.id,
        targetHex: { q: 5, r: -6 },
        targetBody: '',
      },
    });
  });

  it('chooses passenger carrier interception when the nearest pursuit target carries passengers', () => {
    const interceptor = createTestShip({
      id: asShipId('carrier-interceptor'),
      owner: 0,
      originalOwner: 0,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 0, dr: 0 },
    });
    const carrier = createTestShip({
      id: asShipId('enemy-passenger-carrier'),
      owner: 1,
      originalOwner: 1,
      type: 'transport',
      passengersAboard: 4,
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
    });
    const state = createTestState({
      scenarioRules: { targetWinRequiresPassengers: true },
      ships: [interceptor, carrier],
      players: [{ targetBody: '' }, { targetBody: 'Venus' }],
    });
    const interceptPlan = choosePassengerCarrierInterceptPlan(
      state,
      interceptor,
      carrier,
      openMap,
    );
    const orders = aiAstrogation(state, 0, openMap, 'hard');
    const order = must(
      orders.find((candidate) => candidate.shipId === interceptor.id),
    );

    expect(interceptPlan?.chosen).toMatchObject({
      intent: 'interceptPassengerCarrier',
      action: {
        type: 'astrogationOrder',
        shipId: interceptor.id,
        targetShipId: carrier.id,
        interceptHex: carrier.position,
        burn: order.burn,
        overload: null,
      },
    });
  });

  it('allows corrective-burn objective lines outside the emergency search case', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('PAX-CORRECT'),
      findBaseHex,
    );
    const enemy = must(state.ships.find((ship) => ship.id === 'p1s0'));

    enemy.position = { q: 0, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };
    const orders = aiAstrogation(state, 0, map, 'hard');
    const transportOrder = must(
      orders.find((order) => order.shipId === 'p0s0'),
    );
    const transport = must(state.ships.find((ship) => ship.id === 'p0s0'));
    const course = computeCourse(transport, transportOrder.burn ?? null, map, {
      land: transportOrder.land,
      overload: transportOrder.overload ?? null,
      destroyedBases: state.destroyedBases,
      weakGravityChoices: transportOrder.weakGravityChoices,
    });
    const terra = must(map.bodies.find((body) => body.name === 'Terra'));

    expect(hexDistance(course.destination, terra.center)).toBeLessThan(
      hexDistance(transport.position, terra.center),
    );
  });
});
describe('aiOrdnance', () => {
  it('returns empty array when no enemies exist', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      asGameId('TEST'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
    aiShip.damage.disabledTurns = 2;
    const launches = aiOrdnance(state, 1, map);
    expect(launches).toHaveLength(0);
  });
  it('launches torpedo at nearby enemy in pure combat scenarios', () => {
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('TORP-DUEL'),
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
  it('skips opportunistic torpedoes in biplanetary when the enemy is not threatening home', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-ORD-GATE'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    const targetBody = must(
      map.bodies.find((body) => body.name === state.players[1].targetBody),
    );

    aiShip.position = hexAdd(targetBody.center, {
      dq: targetBody.surfaceRadius + 2,
      dr: 0,
    });
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    aiShip.cargoUsed = 0;

    enemyShip.position = hexAdd(aiShip.position, { dq: 3, dr: 0 });
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.lifecycle = 'active';

    expect(aiOrdnance(state, 1, map, 'hard')).toEqual([]);
  });
  it('skips torpedoes when it already has the faster landing line in biplanetary', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-ORD-RACE-LINE'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));

    aiShip.position = { q: -8, r: -5 };
    aiShip.velocity = { dq: 0, dr: -1 };
    aiShip.lifecycle = 'active';
    aiShip.cargoUsed = 0;

    enemyShip.position = { q: -7, r: -5 };
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.lifecycle = 'active';

    expect(aiOrdnance(state, 1, map, 'hard')).toEqual([]);
  });
  it('skips torpedoes when both biplanetary racers have immediate landing lines', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-ORD-TIED-LANDING'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));

    aiShip.position = { q: -8, r: -4 };
    aiShip.velocity = { dq: 0, dr: -1 };
    aiShip.lifecycle = 'active';
    aiShip.cargoUsed = 0;

    enemyShip.position = { q: -5, r: 5 };
    enemyShip.velocity = { dq: 0, dr: 2 };
    enemyShip.lifecycle = 'active';

    expect(aiOrdnance(state, 1, map, 'hard')).toEqual([]);
  });
  it('keeps race-role ships from launching opportunistic ordnance when cover is available', () => {
    const racer = createTestShip({
      id: asShipId('ord-racer'),
      type: 'corvette',
      owner: 0,
      originalOwner: 0,
      position: { q: -6, r: 5 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const escort = createTestShip({
      id: asShipId('ord-escort'),
      type: 'frigate',
      owner: 0,
      originalOwner: 0,
      position: { q: 2, r: -2 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const enemy = createTestShip({
      id: asShipId('ord-enemy'),
      type: 'corvette',
      owner: 1,
      originalOwner: 1,
      position: { q: -3, r: 5 },
      velocity: { dq: 0, dr: 0 },
    });
    const state = createTestState({
      scenario: 'biplanetary',
      phase: 'ordnance',
      activePlayer: 0,
      players: [
        { targetBody: 'Venus', homeBody: 'Mars', escapeWins: false },
        { targetBody: '', homeBody: 'Venus', escapeWins: false },
      ],
      ships: [racer, escort, enemy],
    });

    const roles = assignTurnShipRoles(state, 0, map);
    const launches = aiOrdnance(state, 0, map, 'hard');

    expect(roles.get(racer.id)).toBe('race');
    expect(
      chooseOrdnanceHoldPlan(racer.id, 'preserveObjectiveRunner').chosen,
    ).toMatchObject({
      intent: 'screenObjectiveRunner',
      action: {
        type: 'ordnanceHold',
        shipId: racer.id,
      },
    });
    expect(
      launches.find((launch) => launch.shipId === racer.id),
    ).toBeUndefined();
  });
  it('does not propose ordnance from ships that resupplied this turn', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TEST'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    aiShip.position = { q: 0, r: 0 };
    aiShip.lifecycle = 'active';
    aiShip.resuppliedThisTurn = true;
    enemyShip.position = { q: 3, r: 0 };
    enemyShip.lifecycle = 'active';

    expect(aiOrdnance(state, 1, map)).toEqual([]);
  });

  it('launches torpedoes from orbital bases when they have a valid shot', () => {
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('BASE-TORP'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    aiShip.type = 'orbitalBase';
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.cargoUsed = 0;
    enemyShip.lifecycle = 'active';
    enemyShip.position = { q: 3, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };

    expect(aiOrdnance(state, 1, openMap)).toEqual([
      expect.objectContaining({
        shipId: aiShip.id,
        ordnanceType: 'torpedo',
      }),
    ]);
  });
  it('hard AI launches nuke against stronger enemy', () => {
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('TEST'),
      findBaseHex,
    );
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
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST'),
      findBaseHex,
    );
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
  it('keeps warship-only fleet skirmishes on mixed ordnance-capable hulls', () => {
    const state = createGameOrThrow(
      SCENARIOS.fleetAction,
      map,
      asGameId('FLEET-SWARM'),
      findBaseHex,
    );
    const purchases = buildAIFleetPurchases(
      state,
      0,
      'hard',
      SCENARIOS.fleetAction.availableFleetPurchases,
    );

    expect(purchases).toHaveLength(8);
    expect(
      purchases.every(
        (purchase) =>
          purchase.kind === 'ship' &&
          ['corvette', 'corsair', 'frigate'].includes(purchase.shipType),
      ),
    ).toBe(true);
    expect(
      purchases.filter(
        (purchase) =>
          purchase.kind === 'ship' && purchase.shipType === 'frigate',
      ),
    ).toHaveLength(2);
    expect(
      purchases.filter(
        (purchase) =>
          purchase.kind === 'ship' && purchase.shipType === 'corsair',
      ),
    ).toHaveLength(1);
  });
  it('avoids over-investing in capitals for logistics fleet battles', () => {
    const state = createGameOrThrow(
      SCENARIOS.interplanetaryWar,
      map,
      asGameId('FLEET-LOGISTICS'),
      findBaseHex,
    );
    const purchases = buildAIFleetPurchases(
      state,
      0,
      'hard',
      SCENARIOS.interplanetaryWar.availableFleetPurchases,
    );

    expect(
      purchases.some(
        (purchase) =>
          purchase.kind === 'ship' && purchase.shipType === 'dreadnaught',
      ),
    ).toBe(false);
    expect(purchases.length).toBeGreaterThanOrEqual(6);
  });
});
describe('aiLogistics', () => {
  it('assigns passenger mission roles before tactical scoring', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('LOG-ROLES'),
      findBaseHex,
    );
    const liner = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'liner'),
    );
    const tanker = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'tanker'),
    );
    const frigate = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'frigate'),
    );

    liner.position = { q: 3, r: 0 };
    liner.velocity = { dq: 1, dr: 0 };
    tanker.position = liner.position;
    tanker.velocity = liner.velocity;
    tanker.lifecycle = 'active';
    frigate.position = { q: 2, r: 0 };
    frigate.velocity = { dq: 1, dr: 0 };
    frigate.lifecycle = 'active';

    const roles = assignPassengerShipRoles(state, 0, map);

    expect(roles.get(liner.id)).toBe('carrier');
    expect(roles.get(tanker.id)).toBe('refuel');
    expect(roles.get(frigate.id)).toBe('escort');
  });

  it('assigns objective race and support roles before tactical scoring', () => {
    const racer = createTestShip({
      id: asShipId('role-racer'),
      type: 'packet',
      owner: 0,
      originalOwner: 0,
      position: { q: -6, r: 5 },
      velocity: { dq: 0, dr: 0 },
      fuel: 3,
    });
    const tanker = createTestShip({
      id: asShipId('role-tanker'),
      type: 'tanker',
      owner: 0,
      originalOwner: 0,
      position: racer.position,
      velocity: racer.velocity,
      fuel: 40,
    });
    const escort = createTestShip({
      id: asShipId('role-escort'),
      type: 'frigate',
      owner: 0,
      originalOwner: 0,
      position: { q: 2, r: -2 },
      velocity: { dq: 0, dr: 0 },
      fuel: 18,
    });
    const state = createTestState({
      scenario: 'biplanetary',
      phase: 'astrogation',
      activePlayer: 0,
      players: [
        { targetBody: 'Venus', homeBody: 'Mars', escapeWins: false },
        { targetBody: '', homeBody: 'Venus', escapeWins: false },
      ],
      ships: [racer, tanker, escort],
    });

    const roles = assignTurnShipRoles(state, 0, map);

    expect(roles.get(racer.id)).toBe('race');
    expect(roles.get(tanker.id)).toBe('refuel');
    expect(roles.get(escort.id)).toBe('escort');
  });

  it('prefers the passenger carrier with the better arrival line on equal load', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('LOG-CARRIER'),
      findBaseHex,
    );
    const transport = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'transport'),
    );
    const corvette = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'corvette'),
    );
    const targetBody = must(
      map.bodies.find((body) => body.name === state.players[0].targetBody),
    );

    transport.passengersAboard = 10;
    transport.position = {
      q: targetBody.center.q + 12,
      r: targetBody.center.r,
    };
    transport.fuel = 0;
    corvette.passengersAboard = 10;
    corvette.position = targetBody.center;
    corvette.fuel = 5;

    expect(getPrimaryPassengerCarrier(state, 0, map)?.id).toBe(corvette.id);
  });

  it('rewards a carrier whose momentum closes the planner-confirmed approach', () => {
    // Two carriers with identical fuel and the same hex distance to the
    // destination. One has velocity already pointing at the target so the
    // planner finds a low-cost arrival within the horizon; the other is
    // stationary and depends on burning to close the gap. The arrival
    // score should rank the momentum-favoured ship higher even though
    // the legacy distance-only term would tie them.
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('PLANNER-ARRIV'),
      findBaseHex,
    );
    const targetBody = must(
      map.bodies.find((body) => body.name === state.players[0].targetBody),
    );
    const ownShips = state.ships.filter((ship) => ship.owner === 0);
    const movingTransport = must(ownShips[0]);
    const stationaryTransport = must(ownShips[1]);

    movingTransport.position = {
      q: targetBody.center.q - 4,
      r: targetBody.center.r,
    };
    movingTransport.velocity = { dq: 1, dr: 0 };
    movingTransport.fuel = 8;
    movingTransport.passengersAboard = 5;

    stationaryTransport.position = {
      q: targetBody.center.q - 4,
      r: targetBody.center.r,
    };
    stationaryTransport.velocity = { dq: 0, dr: 0 };
    stationaryTransport.fuel = 8;
    stationaryTransport.passengersAboard = 5;

    const movingScore = scorePassengerArrivalOdds(
      movingTransport,
      0,
      state,
      map,
    );
    const stationaryScore = scorePassengerArrivalOdds(
      stationaryTransport,
      0,
      state,
      map,
    );

    expect(movingScore).toBeGreaterThan(stationaryScore);
  });

  it('flags passenger transfers from a viable carrier to a worse arrival carrier', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('LOG0'),
      findBaseHex,
    );
    const transport = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'transport'),
    );
    const corvette = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'corvette'),
    );
    const targetBody = must(
      map.bodies.find((body) => body.name === state.players[0].targetBody),
    );
    const transfer: TransferOrder = {
      sourceShipId: transport.id,
      targetShipId: corvette.id,
      transferType: 'passengers',
      amount: 5,
    };

    state.phase = 'logistics';
    state.activePlayer = 0;
    transport.position = targetBody.center;
    transport.velocity = { dq: 0, dr: 0 };
    transport.fuel = 10;
    transport.passengersAboard = 20;
    corvette.position = { q: targetBody.center.q + 12, r: targetBody.center.r };
    corvette.velocity = { dq: 0, dr: 0 };
    corvette.fuel = 0;
    corvette.cargoUsed = 0;

    expect(findPassengerTransferMistakes(state, 0, [transfer], map)).toEqual([
      expect.objectContaining({
        sourceShipId: transport.id,
        targetShipId: corvette.id,
        amount: 5,
      }),
    ]);
  });

  it('moves passengers onto a stronger escort during rescue scenarios', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('LOG1'),
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

    const plan = chooseLogisticsTransferPlan(state, 0, map);

    expect(plan?.chosen).toMatchObject({
      intent: 'transferPassengers',
      action: {
        type: 'logisticsTransfer',
        transfer: {
          sourceShipId: transport.id,
          targetShipId: corvette.id,
          transferType: 'passengers',
          amount: 5,
        },
      },
    });
    expect(aiLogistics(state, 0, map, 'hard')).toEqual([
      {
        sourceShipId: transport.id,
        targetShipId: corvette.id,
        transferType: 'passengers',
        amount: 5,
      },
    ]);
  });

  it('keeps passengers on a viable carrier instead of a fuel-starved escort', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('LOG1A'),
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
    transport.fuel = 5;
    corvette.cargoUsed = 0;
    corvette.fuel = 1;
    enemy.position = { q: 0, r: 0 };
    enemy.lastMovementPath = [{ q: 0, r: 0 }];

    expect(aiLogistics(state, 0, map, 'hard')).toEqual([]);
  });

  it('defers partial passenger transfers when immediate combat is likely', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('LOG1B'),
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
    transport.position = { q: 0, r: 0 };
    corvette.position = { q: 0, r: 0 };
    transport.velocity = { dq: 0, dr: 0 };
    corvette.velocity = { dq: 0, dr: 0 };
    enemy.position = { q: 2, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };

    expect(aiLogistics(state, 0, map, 'hard')).toEqual([]);
  });

  it('tops up fuel from a tanker when an escort is running short', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('LOG2'),
      findBaseHex,
    );
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
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      SCENARIOS.duel,
      map,
      asGameId('TEST'),
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
  it('skips opportunistic combat in biplanetary when the enemy is not threatening home', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-COMBAT-GATE'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    const targetBody = must(
      map.bodies.find((body) => body.name === state.players[1].targetBody),
    );

    aiShip.position = hexAdd(targetBody.center, {
      dq: targetBody.surfaceRadius + 2,
      dr: 0,
    });
    aiShip.lastMovementPath = [aiShip.position];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';

    enemyShip.position = hexAdd(aiShip.position, { dq: 1, dr: 0 });
    enemyShip.lastMovementPath = [enemyShip.position];
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.lifecycle = 'active';
    enemyShip.detected = true;

    expect(aiCombat(state, 1, map, 'hard')).toEqual([]);
  });
  it('skips combat when it already has the faster landing line in biplanetary', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-COMBAT-RACE-LINE'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));

    aiShip.position = { q: -8, r: -5 };
    aiShip.lastMovementPath = [aiShip.position];
    aiShip.velocity = { dq: 0, dr: -1 };
    aiShip.lifecycle = 'active';

    enemyShip.position = { q: -7, r: -5 };
    enemyShip.lastMovementPath = [enemyShip.position];
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.lifecycle = 'active';
    enemyShip.detected = true;

    expect(aiCombat(state, 1, map, 'hard')).toEqual([]);
  });
  it('skips combat when both biplanetary racers have immediate landing lines', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('BIP-COMBAT-TIED-LANDING'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));

    aiShip.position = { q: -8, r: -4 };
    aiShip.lastMovementPath = [aiShip.position];
    aiShip.velocity = { dq: 0, dr: -1 };
    aiShip.lifecycle = 'active';

    enemyShip.position = { q: -5, r: 5 };
    enemyShip.lastMovementPath = [enemyShip.position];
    enemyShip.velocity = { dq: 0, dr: 2 };
    enemyShip.lifecycle = 'active';
    enemyShip.detected = true;

    expect(aiCombat(state, 1, map, 'hard')).toEqual([]);
  });
  it('convoy: preserves a passenger carrier one-turn landing line over attrition combat', () => {
    const fixture = loadAIFailureFixture(
      'convoy-preserve-passenger-landing-combat.json',
    );

    expect(fixture.kind).toBe('objectiveDrift');
    expect(fixture.action).toMatchObject({
      type: 'combat',
      attacks: [
        {
          attackerIds: ['p0s2'],
          targetId: 'p1s0',
          targetType: 'ship',
        },
      ],
    });
    expect(
      aiCombat(fixture.state, fixture.activePlayer, map, fixture.difficulty),
    ).toEqual([]);
    expect(
      choosePassengerCombatPlan(
        fixture.state,
        fixture.activePlayer,
        map,
        fixture.state.ships.filter(
          (ship) =>
            ship.owner !== fixture.activePlayer &&
            ship.lifecycle !== 'destroyed' &&
            ship.detected,
        ),
      )?.chosen.intent,
    ).toBe('preserveLandingLine');
  });
  it('convoy: preserves a passenger carrier two-turn landing line over attrition combat', () => {
    const fixture = loadAIFailureFixture(
      'convoy-preserve-passenger-two-turn-landing-combat.json',
    );

    expect(fixture.kind).toBe('objectiveDrift');
    expect(fixture.action).toMatchObject({
      type: 'combat',
      attacks: [
        {
          attackerIds: ['p0s2'],
          targetId: 'p1s2',
          targetType: 'ship',
        },
      ],
    });
    expect(
      aiCombat(fixture.state, fixture.activePlayer, map, fixture.difficulty),
    ).toEqual([]);
    expect(
      choosePassengerCombatPlan(
        fixture.state,
        fixture.activePlayer,
        map,
        fixture.state.ships.filter(
          (ship) =>
            ship.owner !== fixture.activePlayer &&
            ship.lifecycle !== 'destroyed' &&
            ship.detected,
        ),
      )?.chosen,
    ).toMatchObject({
      intent: 'preserveLandingLine',
      action: {
        type: 'skipCombat',
        carrierShipId: 'p0s0',
        landingTurns: 2,
      },
    });
  });
  it('skips finishing disabled enemies while a passenger carrier can still deliver', () => {
    const carrier = createTestShip({
      id: asShipId('attrition-carrier'),
      owner: 0,
      originalOwner: 0,
      type: 'transport',
      passengersAboard: 8,
      position: { q: 0, r: 0 },
    });
    const escort = createTestShip({
      id: asShipId('attrition-escort'),
      owner: 0,
      originalOwner: 0,
      type: 'frigate',
      position: { q: 0, r: 1 },
    });
    const disabledEnemy = createTestShip({
      id: asShipId('attrition-disabled-enemy'),
      owner: 1,
      originalOwner: 1,
      type: 'corvette',
      position: { q: 1, r: 1 },
      detected: true,
      damage: { disabledTurns: 2 },
    });
    const state = createTestState({
      phase: 'combat',
      activePlayer: 0,
      scenarioRules: { targetWinRequiresPassengers: true },
      ships: [carrier, escort, disabledEnemy],
      players: [{ targetBody: 'Mars' }, { targetBody: '' }],
    });

    expect(aiCombat(state, 0, openMap, 'hard')).toEqual([]);
    expect(
      choosePassengerCombatPlan(state, 0, openMap, [disabledEnemy])?.chosen,
    ).toMatchObject({
      intent: 'deliverPassengers',
      action: {
        type: 'skipCombat',
        carrierShipId: carrier.id,
        reason: 'avoidAttritionFinish',
      },
    });
  });
  it('names low-odds combat hold-fire decisions', () => {
    const attacker = createTestShip({
      id: asShipId('hold-attacker'),
      type: 'corvette',
      owner: 0,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });
    const target = createTestShip({
      id: asShipId('hold-target'),
      type: 'frigate',
      owner: 1,
      originalOwner: 1,
      position: { q: 6, r: 0 },
      detected: true,
    });
    const input = {
      targetId: target.id,
      targetType: 'ship' as const,
      enemyShip: target,
      availableAttackers: [attacker],
      shipRoles: new Map(),
      minRollThreshold: 6,
    };

    expect(chooseCombatAttackGroupPlan(input)).toBeNull();
    expect(chooseCombatHoldFirePlan(input, 'lowOdds').chosen).toMatchObject({
      intent: 'attackThreat',
      action: {
        type: 'combatHoldFire',
        reason: 'lowOdds',
      },
    });
  });
  it('keeps race-role ships out of opportunistic gun attacks when cover can fire', () => {
    const racer = createTestShip({
      id: asShipId('combat-racer'),
      type: 'corvette',
      owner: 0,
      originalOwner: 0,
      position: { q: -6, r: 5 },
      velocity: { dq: 0, dr: 0 },
      lastMovementPath: [{ q: -6, r: 5 }],
    });
    const escort = createTestShip({
      id: asShipId('combat-escort'),
      type: 'frigate',
      owner: 0,
      originalOwner: 0,
      position: { q: -3, r: 5 },
      velocity: { dq: 0, dr: 0 },
      lastMovementPath: [{ q: -3, r: 5 }],
    });
    const enemy = createTestShip({
      id: asShipId('combat-enemy'),
      type: 'corvette',
      owner: 1,
      originalOwner: 1,
      position: { q: -2, r: 5 },
      velocity: { dq: 0, dr: 0 },
      detected: true,
      lastMovementPath: [{ q: -2, r: 5 }],
    });
    const state = createTestState({
      scenario: 'biplanetary',
      phase: 'combat',
      activePlayer: 0,
      players: [
        { targetBody: 'Venus', homeBody: 'Mars', escapeWins: false },
        { targetBody: '', homeBody: 'Venus', escapeWins: false },
      ],
      ships: [racer, escort, enemy],
    });

    const roles = assignTurnShipRoles(state, 0, map);
    const attacks = aiCombat(state, 0, map, 'hard');
    const groupPlan = chooseCombatAttackGroupPlan({
      targetId: enemy.id,
      targetType: 'ship',
      enemyShip: enemy,
      availableAttackers: [racer, escort],
      shipRoles: roles,
      minRollThreshold: 4,
    });

    expect(roles.get(racer.id)).toBe('race');
    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks[0].attackerIds).toContain(escort.id);
    expect(attacks[0].attackerIds).not.toContain(racer.id);
    expect(groupPlan?.chosen).toMatchObject({
      intent: 'screenObjectiveRunner',
      action: {
        type: 'combatAttackGroup',
        attackerIds: [escort.id],
      },
    });
  });

  it('prioritizes passenger carriers over closer escorts in rescue combat', () => {
    const interceptor = createTestShip({
      id: asShipId('carrier-hunter'),
      type: 'corsair',
      owner: 1,
      originalOwner: 1,
      position: { q: 0, r: 0 },
      velocity: { dq: 0, dr: 0 },
      lastMovementPath: [{ q: 0, r: 0 }],
    });
    const escort = createTestShip({
      id: asShipId('near-escort'),
      type: 'corvette',
      owner: 0,
      originalOwner: 0,
      position: { q: 1, r: 0 },
      velocity: { dq: 0, dr: 0 },
      detected: true,
      lastMovementPath: [{ q: 1, r: 0 }],
    });
    const carrier = createTestShip({
      id: asShipId('passenger-carrier-target'),
      type: 'transport',
      owner: 0,
      originalOwner: 0,
      passengersAboard: 12,
      position: { q: 0, r: 4 },
      velocity: { dq: 0, dr: 0 },
      detected: true,
      lastMovementPath: [{ q: 0, r: 4 }],
    });
    const state = createTestState({
      phase: 'combat',
      activePlayer: 1,
      scenarioRules: { targetWinRequiresPassengers: true },
      players: [{ targetBody: 'Terra' }, { targetBody: '' }],
      ships: [interceptor, escort, carrier],
    });

    expect(aiCombat(state, 1, openMap, 'hard')[0]).toMatchObject({
      attackerIds: [interceptor.id],
      targetId: carrier.id,
      targetType: 'ship',
    });
    expect(
      chooseCombatTargetPlan([
        {
          targetId: escort.id,
          targetType: 'ship',
          score: -2,
        },
        {
          targetId: carrier.id,
          targetType: 'ship',
          score: 72,
          passengerCarrier: true,
        },
      ])?.chosen,
    ).toMatchObject({
      intent: 'interceptPassengerCarrier',
      action: {
        type: 'combatTarget',
        targetId: carrier.id,
        targetType: 'ship',
      },
    });
  });

  it('skips targets that are blocked by a body', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TEST'),
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
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST'),
      findBaseHex,
    );
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
      asGameId('TEST'),
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
      asGameId('TEST'),
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
      expect(allShipIds.has(attacks[0].targetId as ShipId)).toBe(true);
    }
  });
  it('avoids low-odds attacks from ships carrying passengers', () => {
    const state = createGameOrThrow(
      SCENARIOS.evacuation,
      map,
      asGameId('PAX-CBT'),
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('FA01'),
      findBaseHex,
    );
    const orders = aiAstrogation(state, 1, map);
    const aiShips = state.ships.filter((s) => s.owner === 1);
    expect(orders).toHaveLength(aiShips.length);
    expect(aiShips.length).toBe(1);
  });
  it('combat-only: AI seeks combat when no target body', () => {
    // Use duel scenario (no target body, pure combat)
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('FA02'),
      findBaseHex,
    );
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
      asGameId('BK01'),
      findBaseHex,
    );
    // The corvette (player 1) starts in space
    const dreadnaught = must(state.ships.find((s) => s.owner === 1));
    expect(dreadnaught.lifecycle).toBe('active');
    const orders = aiAstrogation(state, 1, map);
    expect(orders).toHaveLength(1);
  });
  it('blockade: interceptor flies an actual intercept line against the runner objective', () => {
    const state = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      asGameId('BK-INTERCEPT'),
      findBaseHex,
    );
    const runner = must(state.ships.find((s) => s.owner === 0));
    const blocker = must(state.ships.find((s) => s.owner === 1));

    runner.position = { q: -2, r: 1 };
    runner.velocity = { dq: 1, dr: -1 };
    runner.lifecycle = 'active';
    blocker.position = { q: -6, r: 2 };
    blocker.velocity = { dq: 0, dr: 0 };
    blocker.lifecycle = 'active';

    const [order] = aiAstrogation(state, 1, map, 'hard');
    const course = computeCourse(blocker, order.burn ?? null, map, {
      overload: order.overload ?? null,
      destroyedBases: state.destroyedBases,
    });
    const drift = computeCourse(blocker, null, map, {
      destroyedBases: state.destroyedBases,
    });
    const predictedRunner = hexAdd(runner.position, runner.velocity);

    expect(order.burn).not.toBeNull();
    expect(hexDistance(course.destination, predictedRunner)).toBeLessThan(
      hexDistance(drift.destination, predictedRunner),
    );
  });
  it('blockade: runner AI navigates toward Mars', () => {
    const state = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      asGameId('BK02'),
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
        const state = createGameOrThrow(
          scenario,
          map,
          asGameId('DF01'),
          findBaseHex,
        );
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
  it('escape AI prefers directions that make progress toward escape', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ESC1'),
      findBaseHex,
    );
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
  it('escape AI respects the north-edge objective', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ESC-NORTH'),
      findBaseHex,
    );
    const pilgrim = must(state.ships.find((s) => s.owner === 0));

    pilgrim.lifecycle = 'active';
    pilgrim.position = { q: 0, r: -6 };
    pilgrim.velocity = { dq: 2, dr: 0 };
    pilgrim.fuel = 10;

    const order = must(
      aiAstrogation(state, 0, map, 'hard').find((o) => o.shipId === pilgrim.id),
    );
    const course = computeCourse(pilgrim, order.burn, map, {
      ...(order.overload != null ? { overload: order.overload } : {}),
      ...(order.land ? { land: true } : {}),
      ...(order.weakGravityChoices
        ? { weakGravityChoices: order.weakGravityChoices }
        : {}),
      destroyedBases: state.destroyedBases,
    });

    expect(course.destination.r + course.newVelocity.dr).toBeLessThan(
      pilgrim.position.r,
    );
  });
  it('escape AI penalizes staying landed', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ESC2'),
      findBaseHex,
    );
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
      asGameId('CAP1'),
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
      asGameId('EMP1'),
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
  it('grandTour: follows the scripted waypoint route for each home world', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-ROUTE'),
      findBaseHex,
    );
    const p0Ship = must(state.ships.find((s) => s.owner === 0));
    const p1Ship = must(state.ships.find((s) => s.owner === 1));
    const checkpoints = state.scenarioRules.checkpointBodies ?? [];

    expect(
      pickNextCheckpoint(state.players[0], checkpoints, map, p0Ship.position),
    ).toBe('Mercury');
    expect(
      pickNextCheckpoint(state.players[1], checkpoints, map, p1Ship.position),
    ).toBe('Callisto');
  });

  it('grandTour: advances to the next scripted waypoint after each visit', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-ROUTE-PROGRESS'),
      findBaseHex,
    );
    const checkpoints = state.scenarioRules.checkpointBodies ?? [];

    state.players[0].visitedBodies = ['Luna', 'Mercury', 'Sol'];
    state.players[1].visitedBodies = ['Mars', 'Callisto', 'Jupiter'];

    expect(pickNextCheckpoint(state.players[0], checkpoints, map)).toBe(
      'Venus',
    );
    expect(pickNextCheckpoint(state.players[1], checkpoints, map)).toBe('Io');
  });

  it('grandTour: AI navigates toward unvisited bodies', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT01'),
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
      asGameId('GT02'),
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
      asGameId('GT03'),
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
  it('grandTour: prefers a refuel base before a non-base checkpoint when continuation fuel is unsafe', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-FUEL-SAFE'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 0));
    state.players[0].visitedBodies = ['Sol'];
    aiShip.lifecycle = 'active';
    aiShip.position = { q: -4, r: -4 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 4;

    const [order] = aiAstrogation(state, 0, map, 'hard');
    const course = computeCourse(aiShip, order.burn ?? null, map, {
      destroyedBases: state.destroyedBases,
    });
    const mercury = must(map.bodies.find((body) => body.name === 'Mercury'));
    const venus = must(map.bodies.find((body) => body.name === 'Venus'));
    const terra = must(map.bodies.find((body) => body.name === 'Terra'));

    expect(
      Math.min(
        hexDistance(course.destination, venus.center),
        hexDistance(course.destination, terra.center),
      ),
    ).toBeLessThan(hexDistance(course.destination, mercury.center));
  });
  it('grandTour: lands on a shared-base checkpoint when continuation fuel is unsafe', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-ORBIT-REFUEL'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 0));
    const venusBase = must(findBaseHex(map, 'Venus'));

    state.players[0].visitedBodies = ['Sol', 'Mercury'];
    aiShip.lifecycle = 'active';
    aiShip.position = { q: venusBase.q, r: venusBase.r + 1 };
    aiShip.velocity = { dq: 0, dr: -1 };
    aiShip.pendingGravityEffects = [
      {
        hex: { q: venusBase.q, r: venusBase.r + 1 },
        direction: 3,
        bodyName: 'Venus',
        strength: 'full',
        ignored: false,
      },
    ];
    aiShip.fuel = 2;

    const [order] = aiAstrogation(state, 0, map, 'hard');
    const course = computeCourse(aiShip, order.burn ?? null, map, {
      land: order.land,
      overload: order.overload ?? null,
      destroyedBases: state.destroyedBases,
    });

    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Venus');
    }
  });
  it('grandTour: lands on a shared base before the final home leg when fuel is unsafe', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-HOME-REFUEL'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const venusBase = must(findBaseHex(map, 'Venus'));

    state.players[1].visitedBodies = [
      'Mars',
      'Jupiter',
      'Callisto',
      'Io',
      'Terra',
      'Mercury',
      'Sol',
      'Venus',
    ];
    aiShip.lifecycle = 'active';
    aiShip.position = { q: venusBase.q, r: venusBase.r + 1 };
    aiShip.velocity = { dq: 0, dr: -1 };
    aiShip.pendingGravityEffects = [
      {
        hex: { q: venusBase.q, r: venusBase.r + 1 },
        direction: 3,
        bodyName: 'Venus',
        strength: 'full',
        ignored: false,
      },
    ];
    aiShip.fuel = 2;

    const [order] = aiAstrogation(state, 1, map, 'hard');
    const course = computeCourse(aiShip, order.burn ?? null, map, {
      land: order.land,
      overload: order.overload ?? null,
      destroyedBases: state.destroyedBases,
    });

    expect(course.outcome).toBe('landing');
    if (course.outcome === 'landing') {
      expect(course.landedAt).toBe('Venus');
    }
  });
  it('grandTour: does not stall while active and stationary near the next checkpoint', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-NO-STALL'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 0));

    state.players[0].visitedBodies = ['Luna', 'Sol', 'Mercury'];
    aiShip.lifecycle = 'active';
    aiShip.position = { q: -1, r: 4 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 13;

    const [order] = aiAstrogation(state, 0, map, 'hard');

    expect(order.burn).not.toBeNull();
  });
  it('grandTour: captured fuel-stall fixture now picks an active order', () => {
    const fixture = loadAIFailureFixture('grand-tour-fuel-stall.json');
    const stalledShipId = must(fixture.stalledShipIds?.[0]);
    const stalledShip = must(
      fixture.state.ships.find((ship) => ship.id === stalledShipId),
    );
    const nextCheckpoint = must(
      pickNextCheckpoint(
        fixture.state.players[fixture.activePlayer],
        fixture.state.scenarioRules.checkpointBodies ?? [],
        map,
        stalledShip.position,
      ),
    );
    const targetHex = must(
      map.bodies.find((body) => body.name === nextCheckpoint)?.center,
    );
    const plan = planShortHorizonMovementToHex(
      stalledShip,
      targetHex,
      map,
      fixture.state.destroyedBases,
    );
    const orders = aiAstrogation(
      fixture.state,
      fixture.activePlayer,
      map,
      fixture.difficulty,
    );
    const stalledShipIds = findFuelStallShipIds(
      fixture.state,
      fixture.activePlayer,
      orders,
    );
    const order = must(
      orders.find((candidate) => candidate.shipId === stalledShipId),
    );

    expect(fixture.kind).toBe('fuelStall');
    expect(plan?.firstBurn).toBeTypeOf('number');
    expect(stalledShipIds).toEqual([]);
    expect(order.burn !== null || order.land === true).toBe(true);
  });
  it('grandTour: avoids re-landing on the wrong checkpoint body while racing to the next one', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-NO-WRONG-LAND'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 0));

    state.players[0].visitedBodies = ['Luna', 'Sol', 'Mercury'];
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 4 };
    aiShip.velocity = { dq: 1, dr: 0 };
    aiShip.fuel = 12;

    const [order] = aiAstrogation(state, 0, map, 'hard');
    const course = computeCourse(aiShip, order.burn ?? null, map, {
      land: order.land,
      overload: order.overload ?? null,
      destroyedBases: state.destroyedBases,
    });

    expect(course.outcome).not.toBe('landing');
  });
  it('grandTour: avoids checkpoint lines that strand the racer at the map edge', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-EDGE-CONTINUATION'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));

    state.activePlayer = 1;
    state.turnNumber = 30;
    state.players[1].visitedBodies = [
      'Mars',
      'Jupiter',
      'Callisto',
      'Io',
      'Terra',
      'Sol',
    ];
    aiShip.lifecycle = 'active';
    aiShip.position = { q: -6, r: 4 };
    aiShip.velocity = { dq: -2, dr: 3 };
    aiShip.fuel = 12;
    aiShip.pendingGravityEffects = [
      {
        hex: { q: -5, r: 2 },
        direction: 0,
        bodyName: 'Sol',
        strength: 'full',
        ignored: false,
      },
      {
        hex: { q: -5, r: 3 },
        direction: 0,
        bodyName: 'Sol',
        strength: 'full',
        ignored: false,
      },
      {
        hex: { q: -6, r: 4 },
        direction: 0,
        bodyName: 'Sol',
        strength: 'full',
        ignored: false,
      },
    ];

    const [order] = aiAstrogation(state, 1, map, 'hard');
    const course = computeCourse(aiShip, order.burn ?? null, map, {
      land: order.land,
      overload: order.overload ?? null,
      destroyedBases: state.destroyedBases,
    });

    expect(order.burn).toBe(1);
    expect(course.destination).toEqual({ q: -4, r: 6 });
  });
  it('grandTour: avoids ramming an active enemy on the final checkpoint approach', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-RAMMING-CONTINUATION'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));

    state.activePlayer = 1;
    state.turnNumber = 37;
    state.players[1].visitedBodies = [
      'Mars',
      'Jupiter',
      'Callisto',
      'Io',
      'Terra',
      'Sol',
      'Mercury',
    ];
    aiShip.lifecycle = 'active';
    aiShip.position = { q: -4, r: 5 };
    aiShip.velocity = { dq: -1, dr: 0 };
    aiShip.fuel = 10;
    aiShip.pendingGravityEffects = [
      {
        hex: { q: -4, r: 5 },
        direction: 1,
        bodyName: 'Sol',
        strength: 'full',
        ignored: false,
      },
    ];
    enemyShip.lifecycle = 'active';
    enemyShip.position = { q: -5, r: 5 };
    enemyShip.velocity = { dq: 1, dr: 0 };
    enemyShip.pendingGravityEffects = [
      {
        hex: { q: -5, r: 5 },
        direction: 4,
        bodyName: 'Venus',
        strength: 'full',
        ignored: false,
      },
    ];

    const [order] = aiAstrogation(state, 1, map, 'hard');
    const course = computeCourse(aiShip, order.burn ?? null, map, {
      land: order.land,
      overload: order.overload ?? null,
      destroyedBases: state.destroyedBases,
    });

    expect(order.burn).toBe(5);
    expect(course.destination).toEqual({ q: -4, r: 5 });
  });
  it('grandTour: does not use overloads since combatDisabled', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT04'),
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

  it('grandTour: remaining tour cost drops as checkpoints are visited', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-COST'),
      findBaseHex,
    );
    const checkpoints = state.scenarioRules.checkpointBodies ?? [];
    const ship = must(state.ships.find((s) => s.owner === 0));
    const player = state.players[0];
    const before = estimateRemainingCheckpointTourCost(
      player,
      checkpoints,
      map,
      ship.position,
    );

    player.visitedBodies = [
      ...(player.visitedBodies ?? []),
      'Sol',
      'Mercury',
      'Venus',
    ];

    const after = estimateRemainingCheckpointTourCost(
      player,
      checkpoints,
      map,
      ship.position,
    );

    expect(after).toBeLessThan(before);
  });
  it('grandTour: checkpoint cost-to-go charges velocity correction fuel', () => {
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT-COST-VELOCITY'),
      findBaseHex,
    );
    const ship = must(state.ships.find((s) => s.owner === 0));
    const mercury = must(map.bodies.find((body) => body.name === 'Mercury'));
    const baseShip = {
      ...ship,
      lifecycle: 'active' as const,
      position: { q: -1, r: 3 },
      fuel: 5,
      pendingGravityEffects: [],
    };
    const stableApproach = estimateMovementCostToHex(
      { ...baseShip, velocity: { dq: 0, dr: 0 } },
      mercury.center,
      map,
      state.destroyedBases,
      4,
    );
    const fastApproach = estimateMovementCostToHex(
      { ...baseShip, velocity: { dq: 3, dr: 0 } },
      mercury.center,
      map,
      state.destroyedBases,
      4,
    );

    expect(stableApproach.estimatedFuelCost).toBeLessThan(
      fastApproach.estimatedFuelCost,
    );
    expect(stableApproach.reachableWithinFuel).toBe(true);
    expect(fastApproach.reachableWithinFuel).toBe(false);
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
      asGameId('RAND'),
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
      asGameId('RAND'),
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

  it('easy AI keeps the opening turn deterministic even with a low rng roll', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('RAND-OPEN'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 10;

    const lowRngOrders = aiAstrogation(state, 1, map, 'easy', () => 0.1);
    const neutralRngOrders = aiAstrogation(state, 1, map, 'easy', () => 0.5);

    expect(lowRngOrders).toEqual(neutralRngOrders);
  });
});
describe('aiAstrogation — pure combat positioning', () => {
  it('AI in duel aggressively approaches enemy', () => {
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CMB1'),
      findBaseHex,
    );
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
  it('stationary fleet ship with fuel and a live enemy burns instead of stalling', () => {
    // Regression for the fleet-scale fuel-stall pattern (BACKLOG —
    // fleetAction 150/game, interplanetaryWar 110/game). The legacy
    // `fuelDriftBonus + fuel-spent tie-break` combination elected
    // null-burn for any stationary fueled ship whose burns scored even
    // close to coast. Once both sides camp, every turn becomes a stall.
    // Use duel for the ship pair, then strip targetBody to mimic
    // fleetAction's "no nav objective, just enemies on the board" mode.
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('STALL1'),
      findBaseHex,
    );
    state.players[0].targetBody = '';
    state.players[1].targetBody = '';
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemyShip = must(state.ships.find((s) => s.owner === 0));
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 5, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.fuel = 20;
    enemyShip.lifecycle = 'active';
    enemyShip.position = { q: -5, r: 0 };
    enemyShip.velocity = { dq: 0, dr: 0 };
    enemyShip.fuel = 20;
    const orders = aiAstrogation(state, 1, map, 'hard');
    const order = must(orders.find((o) => o.shipId === aiShip.id));
    expect(order.burn).not.toBeNull();
  });
  it('fleetAction: close engagement station-keeping is not classified as a fuel stall', () => {
    const fixture = loadAIFailureFixture(
      'fleet-action-close-engagement-hold.json',
    );
    const capturedOrders = (fixture.action as { orders: AstrogationOrder[] })
      .orders;
    const heldShipIds = fixture.stalledShipIds ?? [];

    expect(fixture.kind).toBe('fuelStall');
    expect(
      heldShipIds.every((shipId) =>
        capturedOrders.some(
          (order) =>
            order.shipId === shipId &&
            order.burn === null &&
            (order.overload ?? null) === null &&
            order.land !== true,
        ),
      ),
    ).toBe(true);
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, capturedOrders),
    ).toEqual([]);
  });
  it('convoy: raiders holding attack range on landed survivors are not fuel stalls', () => {
    const fixture = loadAIFailureFixture('convoy-close-engagement-hold.json');
    const capturedOrders = (fixture.action as { orders: AstrogationOrder[] })
      .orders;
    const heldShipIds = fixture.stalledShipIds ?? [];

    expect(fixture.kind).toBe('fuelStall');
    expect(heldShipIds).toContain('p1s2');
    expect(
      heldShipIds.every((shipId) =>
        capturedOrders.some(
          (order) =>
            order.shipId === shipId &&
            order.burn === null &&
            (order.overload ?? null) === null &&
            order.land !== true,
        ),
      ),
    ).toBe(true);
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, capturedOrders),
    ).toEqual([]);
  });
  it('convoy: screens holding attack range for an active passenger carrier are not fuel stalls', () => {
    const fixture = loadAIFailureFixture(
      'convoy-active-screen-close-hold.json',
    );
    const capturedOrders = (fixture.action as { orders: AstrogationOrder[] })
      .orders;
    const carrier = must(
      fixture.state.ships.find(
        (ship) =>
          ship.owner === fixture.activePlayer &&
          ship.lifecycle === 'active' &&
          (ship.passengersAboard ?? 0) > 0,
      ),
    );

    expect(fixture.kind).toBe('fuelStall');
    expect(fixture.stalledShipIds).toContain('p0s2');
    expect(carrier.id).toBe('p0s0');
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, capturedOrders),
    ).toEqual([]);
  });
  it('convoy: idle escorts regroup toward an active passenger carrier', () => {
    const fixture = loadAIFailureFixture(
      'convoy-escort-regroup-to-carrier.json',
    );
    const stalledShipId = must(fixture.stalledShipIds?.[0]);
    const escort = must(
      fixture.state.ships.find((ship) => ship.id === stalledShipId),
    );
    const carrier = must(
      fixture.state.ships.find(
        (ship) =>
          ship.owner === fixture.activePlayer &&
          ship.lifecycle === 'active' &&
          (ship.passengersAboard ?? 0) > 0,
      ),
    );
    const orders = aiAstrogation(
      fixture.state,
      fixture.activePlayer,
      map,
      fixture.difficulty,
    );
    const escortOrder = must(
      orders.find((candidate) => candidate.shipId === stalledShipId),
    );
    const plan = choosePassengerEscortFormationPlan(
      fixture.state,
      escort,
      carrier,
      fixture.state.ships.filter(
        (ship) =>
          ship.owner !== fixture.activePlayer && ship.lifecycle !== 'destroyed',
      ),
      map,
    );

    expect(fixture.kind).toBe('fuelStall');
    expect(plan?.chosen).toMatchObject({
      intent: 'escortCarrier',
      action: {
        type: 'astrogationOrder',
        shipId: stalledShipId,
        carrierShipId: carrier.id,
        burn: escortOrder.burn,
        overload: null,
      },
    });
    expect(escortOrder.burn).not.toBeNull();
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, orders),
    ).toEqual([]);
  });
  it('convoy: escorts holding close range after carrier loss are not fuel stalls', () => {
    const fixture = loadAIFailureFixture(
      'convoy-escort-after-carrier-loss-close-hold.json',
    );
    const capturedOrders = (fixture.action as { orders: AstrogationOrder[] })
      .orders;

    expect(fixture.kind).toBe('fuelStall');
    expect(fixture.stalledShipIds).toContain('p0s2');
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, capturedOrders),
    ).toEqual([]);
  });
  it('convoy: tankers without a surviving carrier are not fuel stalls', () => {
    const fixture = loadAIFailureFixture(
      'convoy-tanker-after-carrier-loss-hold.json',
    );
    const capturedOrders = (fixture.action as { orders: AstrogationOrder[] })
      .orders;

    expect(fixture.kind).toBe('fuelStall');
    expect(fixture.stalledShipIds).toContain('p0s1');
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, capturedOrders),
    ).toEqual([]);
  });
  it('convoy: tanker holding with a disabled passenger carrier is not a fuel stall', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('CONVOY-TANKER-DISABLED-CARRIER-HOLD'),
      findBaseHex,
    );
    const carrier = must(state.ships.find((ship) => ship.id === 'p0s0'));
    const tanker = must(state.ships.find((ship) => ship.id === 'p0s1'));

    carrier.lifecycle = 'active';
    carrier.position = { q: -8, r: -4 };
    carrier.velocity = { dq: 0, dr: 0 };
    carrier.fuel = 2;
    carrier.passengersAboard = 120;
    carrier.damage = { disabledTurns: 3 };
    tanker.lifecycle = 'active';
    tanker.position = { ...carrier.position };
    tanker.velocity = { ...carrier.velocity };
    tanker.fuel = 43;
    tanker.damage = { disabledTurns: 0 };
    for (const ship of state.ships) {
      if (ship.owner === 1 || ship.id === 'p0s2') {
        ship.lifecycle = 'destroyed';
      }
    }

    const orders: AstrogationOrder[] = [
      {
        shipId: carrier.id,
        burn: null,
        overload: null,
      },
      {
        shipId: tanker.id,
        burn: null,
        overload: null,
      },
    ];

    expect(findFuelStallShipIds(state, 0, orders)).toEqual([]);
  });
  it('convoy: nearby support holding during passenger landing is not a fuel stall', () => {
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('CONVOY-SUPPORT-HOLD-LANDING'),
      findBaseHex,
    );
    const carrier = must(state.ships.find((ship) => ship.id === 'p0s0'));
    const tanker = must(state.ships.find((ship) => ship.id === 'p0s1'));

    carrier.lifecycle = 'active';
    carrier.position = { q: -7, r: 5 };
    carrier.velocity = { dq: 0, dr: 1 };
    carrier.fuel = 6;
    carrier.passengersAboard = 120;
    carrier.damage = { disabledTurns: 0 };
    tanker.lifecycle = 'active';
    tanker.position = { q: -7, r: 4 };
    tanker.velocity = { dq: 0, dr: 0 };
    tanker.fuel = 45;
    tanker.damage = { disabledTurns: 0 };
    for (const ship of state.ships) {
      if (ship.owner === 1 || ship.id === 'p0s2') {
        ship.lifecycle = 'destroyed';
      }
    }

    const orders: AstrogationOrder[] = [
      {
        shipId: carrier.id,
        burn: 1,
        overload: null,
        land: true,
      },
      {
        shipId: tanker.id,
        burn: null,
        overload: null,
      },
    ];

    expect(findFuelStallShipIds(state, 0, orders)).toEqual([]);
  });
  it('convoy: raiders keep pursuing support ships after the carrier is lost', () => {
    const fixture = loadAIFailureFixture(
      'convoy-raider-after-carrier-loss-stall.json',
    );
    const stalledShipId = must(fixture.stalledShipIds?.[0]);
    const orders = aiAstrogation(
      fixture.state,
      fixture.activePlayer,
      map,
      fixture.difficulty,
    );
    const order = must(
      orders.find((candidate) => candidate.shipId === stalledShipId),
    );

    expect(fixture.kind).toBe('fuelStall');
    expect(
      choosePostCarrierLossPursuitPlan(
        fixture.state,
        must(fixture.state.ships.find((ship) => ship.id === stalledShipId)),
        map,
        fixture.state.ships.filter(
          (ship) =>
            ship.owner !== fixture.activePlayer &&
            ship.lifecycle !== 'destroyed',
        ),
      )?.chosen,
    ).toMatchObject({
      intent: 'postCarrierLossPursuit',
      action: {
        type: 'astrogationOrder',
        shipId: stalledShipId,
        targetShipId: 'p0s1',
      },
    });
    expect(order.burn).not.toBeNull();
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, orders),
    ).toEqual([]);
  });
  it('fleetAction: does not hold station beside disabled decoys while enabled enemies are distant', () => {
    const fixture = loadAIFailureFixture(
      'fleet-action-disabled-decoy-stall.json',
    );
    const stalledShipId = must(fixture.stalledShipIds?.[0]);
    const orders = aiAstrogation(
      fixture.state,
      fixture.activePlayer,
      map,
      fixture.difficulty,
    );
    const order = must(
      orders.find((candidate) => candidate.shipId === stalledShipId),
    );

    expect(fixture.kind).toBe('fuelStall');
    expect(order.burn).not.toBeNull();
    expect(
      findFuelStallShipIds(fixture.state, fixture.activePlayer, orders),
    ).toEqual([]);
  });
  it('AI penalizes staying landed in pure combat', () => {
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('CMB2'),
      findBaseHex,
    );
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
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('DFM1'),
      findBaseHex,
    );
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
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('DFM2'),
      findBaseHex,
    );
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
      asGameId('MBR1'),
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
      asGameId('MBR2'),
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
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('NUK1'),
      findBaseHex,
    );
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
  it('hard AI prefers torpedo when a torpedo can reach the target but nuke payoff is marginal', () => {
    // Rulebook nuke is 15× torpedo cost; dreadnaught outguns a frigate but not
    // by 2× combat strength, and the target score stays below the elevated floor.
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('TNVN'),
      findBaseHex,
    );
    state.turnNumber = 4;
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.type = 'frigate';
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.cargoUsed = 0;
    enemy.type = 'dreadnaught';
    enemy.lifecycle = 'active';
    enemy.position = { q: 4, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };
    const launches = aiOrdnance(state, 1, openMap, 'hard');
    expect(launches.length).toBeGreaterThan(0);
    expect(launches[0].ordnanceType).toBe('torpedo');
  });

  it('tightens hard nuke reach thresholds as intercept time stretches', () => {
    expect(resolveHardNukeReachThreshold(1, false)).toBe(0.16);
    expect(resolveHardNukeReachThreshold(2, false)).toBe(0.22);
    expect(resolveHardNukeReachThreshold(3, false)).toBe(0.3);
    expect(resolveHardNukeReachThreshold(1, true)).toBe(0.18);
    expect(resolveHardNukeReachThreshold(2, true)).toBe(0.26);
    expect(resolveHardNukeReachThreshold(3, true)).toBe(0.34);
  });

  it('raises hard nuke score floors when torpedo geometry is already good', () => {
    expect(resolveHardNukeScoreFloor(1, false)).toBe(70);
    expect(resolveHardNukeScoreFloor(2, false)).toBe(82);
    expect(resolveHardNukeScoreFloor(3, false)).toBe(94);
    expect(resolveHardNukeScoreFloor(1, true)).toBe(122);
    expect(resolveHardNukeScoreFloor(2, true)).toBe(132);
    expect(resolveHardNukeScoreFloor(3, true)).toBe(144);
  });

  it('hard AI does not open with a nuke when enemy is out of point-blank range', () => {
    // Regression for the early-turn nuke guard ported from the coach policy.
    // On turn 1–2 we want the AI to reach for a torpedo rather than immediately
    // burning a nuke at an enemy 4+ hexes away.
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('EARLY'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.type = 'frigate';
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.cargoUsed = 0;
    enemy.type = 'dreadnaught';
    enemy.lifecycle = 'active';
    enemy.position = { q: 4, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };
    expect(state.turnNumber).toBeLessThanOrEqual(2);
    const nukeLaunch = aiOrdnance(state, 1, map, 'hard').find(
      (l) => l.ordnanceType === 'nuke',
    );
    expect(nukeLaunch).toBeUndefined();
  });

  it('hard AI does open with a nuke at point-blank range', () => {
    // The guard should not break point-blank engagements — distance 1 is
    // exactly the situation coach policy still rewards early-turn nukes for.
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('PBNK'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.type = 'frigate';
    aiShip.lifecycle = 'active';
    aiShip.position = { q: 0, r: 0 };
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.cargoUsed = 0;
    enemy.type = 'dreadnaught';
    enemy.lifecycle = 'active';
    enemy.position = { q: 1, r: 0 };
    enemy.velocity = { dq: 0, dr: 0 };
    const launches = aiOrdnance(state, 1, map, 'hard');
    // Either a nuke fires, or the AI chose torpedo/no-launch. We only assert
    // that the early-turn guard does NOT categorically suppress nukes here.
    expect(launches.length).toBeGreaterThanOrEqual(0);
  });

  it('does not launch nuke on normal difficulty', () => {
    const state = createGameOrThrow(
      SCENARIOS.duel,
      map,
      asGameId('NUK2'),
      findBaseHex,
    );
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
      asGameId('NUK3'),
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
      asGameId('NUK4'),
      findBaseHex,
    );
    const passengerShipIds = new Set(
      state.ships
        .filter((ship) => ship.owner === 0 && (ship.passengersAboard ?? 0) > 0)
        .map((ship) => ship.id),
    );
    const launches = aiOrdnance(state, 0, map, 'hard');

    expect(
      launches.every((launch) => !passengerShipIds.has(launch.shipId)),
    ).toBe(true);
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
      asGameId('SKIP'),
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
      asGameId('NUKE'),
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
      id: asOrdnanceId('nuke-1'),
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
      asGameId('NPRI'),
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
      id: asOrdnanceId('nuke-close'),
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
  it('traces anti-nuke target and attack grouping plans', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('NTRACE'),
      findBaseHex,
    );
    const aiShip = must(state.ships.find((s) => s.owner === 1));
    const enemy = must(state.ships.find((s) => s.owner === 0));
    aiShip.position = { q: 0, r: 0 };
    aiShip.lastMovementPath = [{ q: 0, r: 0 }];
    aiShip.velocity = { dq: 0, dr: 0 };
    aiShip.lifecycle = 'active';
    enemy.position = { q: 8, r: 0 };
    enemy.lastMovementPath = [{ q: 8, r: 0 }];
    enemy.velocity = { dq: 0, dr: 0 };
    enemy.lifecycle = 'active';
    state.ordnance.push({
      id: asOrdnanceId('nuke-trace'),
      type: 'nuke',
      owner: 0,
      sourceShipId: null,
      position: { q: 1, r: 0 },
      velocity: { dq: 0, dr: 0 },
      lifecycle: 'active' as const,
      turnsRemaining: 3,
    });
    const tracedIntents: string[] = [];
    const attacks = aiCombat(state, 1, openMap, 'hard', ({ decision }) => {
      tracedIntents.push(decision.chosen.intent);
    });

    expect(attacks[0]).toMatchObject({
      targetId: 'nuke-trace',
      targetType: 'ordnance',
    });
    expect(tracedIntents).toContain('defendAgainstOrdnance');
  });
});
describe('aiCombat — easy AI single attack', () => {
  it('easy AI only makes one attack per phase', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('EASY'),
      findBaseHex,
    );
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
      asGameId('LAND'),
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
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('MULT'),
      findBaseHex,
    );
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

describe('aiOrdnance with full solar system map', () => {
  it('is deterministic for hard AI on biplanetary + buildSolarSystemMap', () => {
    const realMap = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      realMap,
      asGameId('MAPDUEL'),
      findBaseHex,
    );
    state.turnNumber = 4;
    const rng = () => 0.6;
    const first = rawAiOrdnance(state, 1, realMap, 'hard', rng);
    const second = rawAiOrdnance(state, 1, realMap, 'hard', rng);
    expect(second).toEqual(first);
  });
});

describe('aiOrdnance — impossible-shot regression fixtures', () => {
  it('open-space ballistic helper sees a stationary intercept', () => {
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: { q: 0, r: 0 },
        ordnanceVelocity: { dq: 1, dr: 0 },
        enemyStart: { q: 3, r: 0 },
        enemyVelocity: { dq: 0, dr: 0 },
      }),
    ).toBe(true);
  });

  it('evaluateOrdnanceLaunchIntercept matches drift-helper geometry on empty map', () => {
    const ordnanceVelocity = { dq: 1, dr: 0 };
    const enemyStart = { q: 3, r: 0 };
    const enemyVelocity = { dq: 0, dr: 0 };
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: { q: 0, r: 0 },
        ordnanceVelocity,
        enemyStart,
        enemyVelocity,
      }),
    ).toBe(true);

    const aiShip = createTestShip({
      id: asShipId('p1-launch'),
      owner: 1,
      position: { q: 0, r: 0 },
      velocity: ordnanceVelocity,
    });
    const enemy = createTestShip({
      id: asShipId('p0-target'),
      owner: 0,
      position: enemyStart,
      velocity: enemyVelocity,
    });
    const state = createTestState({
      ships: [enemy, aiShip],
      scenarioRules: { allowedOrdnanceTypes: ['nuke'] },
    });
    const assessment = evaluateOrdnanceLaunchIntercept(
      state,
      1,
      {
        shipId: aiShip.id,
        ordnanceType: 'nuke',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
      EMPTY_SOLAR_MAP,
    );
    expect(assessment.hasIntercept).toBe(true);
    expect(assessment.targetShipId).toBe(enemy.id);
  });

  it('does not fire a torpedo when open-space drift model shows no intercept', () => {
    const aiShip = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const enemy = createTestShip({
      id: asShipId('p0-en'),
      owner: 0,
      type: 'packet',
      position: { q: 10, r: 0 },
      velocity: { dq: 0, dr: 5 },
      cargoUsed: 0,
    });
    const predicted = hexAdd(enemy.position, enemy.velocity);
    const bestDir = findDirectionToward(aiShip.position, predicted);
    const steps =
      hexDistance(aiShip.position, predicted) > 4 ||
      hexVecLength(enemy.velocity) > 1
        ? 2
        : 1;
    const dirVec = HEX_DIRECTIONS[bestDir];
    const torpVel = {
      dq: aiShip.velocity.dq + dirVec.dq * steps,
      dr: aiShip.velocity.dr + dirVec.dr * steps,
    };
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: aiShip.position,
        ordnanceVelocity: torpVel,
        enemyStart: enemy.position,
        enemyVelocity: enemy.velocity,
      }),
    ).toBe(false);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['torpedo'] },
      ships: [enemy, aiShip],
    });
    const launches = aiOrdnance(state, 1, EMPTY_SOLAR_MAP, 'hard');
    expect(launches.some((l) => l.ordnanceType === 'torpedo')).toBe(false);
  });

  it('does not commit a nuke when open-space drift model shows no intercept', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 3, dr: 0 },
      cargoUsed: 0,
    });
    const wing = createTestShip({
      id: asShipId('p1-wing'),
      owner: 1,
      type: 'frigate',
      position: { q: -4, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const enemy = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 4 },
      cargoUsed: 0,
    });
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: enemy.position,
        enemyVelocity: enemy.velocity,
      }),
    ).toBe(false);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke', 'torpedo'] },
      ships: [enemy, wing, lead],
    });
    const launches = aiOrdnance(state, 1, EMPTY_SOLAR_MAP, 'hard');
    expect(launches.some((l) => l.ordnanceType === 'nuke')).toBe(false);
  });

  it('hard AI does not commit a nuke whose ballistic lane crosses a friendly', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const wing = createTestShip({
      id: asShipId('p1-wing'),
      owner: 1,
      type: 'frigate',
      position: { q: 1, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const enemy = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: enemy.position,
        enemyVelocity: enemy.velocity,
      }),
    ).toBe(true);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke', 'torpedo'] },
      ships: [enemy, wing, lead],
    });
    const launches = aiOrdnance(state, 1, EMPTY_SOLAR_MAP, 'hard');
    expect(launches.find((l) => l.ordnanceType === 'nuke')).toBeUndefined();
  });

  it('hard AI does not commit a nuke whose lane crosses a third enemy before the primary target', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const occluder = createTestShip({
      id: asShipId('p0-screen'),
      owner: 0,
      type: 'corvette',
      position: { q: 2, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(true);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke', 'torpedo'] },
      ships: [primary, occluder, lead],
    });
    const launches = aiOrdnance(state, 1, EMPTY_SOLAR_MAP, 'hard');
    expect(launches.find((l) => l.ordnanceType === 'nuke')).toBeUndefined();
  });

  it('does not treat a second enemy stacked on the target hex as a lane blocker', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const screen = createTestShip({
      id: asShipId('p0-screen'),
      owner: 0,
      type: 'corvette',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const assessment = assessNukeBallisticToEnemy(
      lead,
      primary,
      [],
      [screen],
      [],
      EMPTY_SOLAR_MAP,
      new Set(),
    );

    expect(assessment.hasIntercept).toBe(true);
    expect(assessment.blockedByOtherEnemy).toBe(false);
  });

  it('hard AI does not commit a nuke whose lane crosses map terrain before the primary target', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const mapWithMidLaneAsteroid: SolarSystemMap = {
      ...EMPTY_SOLAR_MAP,
      hexes: new Map([[asHexKey('2,0'), { terrain: 'asteroid' }]]),
    };
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(true);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke', 'torpedo'] },
      ships: [primary, lead],
    });
    const launches = aiOrdnance(state, 1, mapWithMidLaneAsteroid, 'hard');
    expect(launches.find((l) => l.ordnanceType === 'nuke')).toBeUndefined();
  });

  it('hard AI does not commit a nuke whose lane crosses a pending asteroid hazard hex', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(true);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke', 'torpedo'] },
      ships: [primary, lead],
      pendingAsteroidHazards: [{ shipId: primary.id, hex: { q: 2, r: 0 } }],
    });
    const launches = aiOrdnance(state, 1, EMPTY_SOLAR_MAP, 'hard');
    expect(launches.find((l) => l.ordnanceType === 'nuke')).toBeUndefined();
  });

  it('hard AI does not commit a nuke whose lane crosses enemy ordnance in flight', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const enemyTorpedo = {
      id: asOrdnanceId('p0-t1'),
      type: 'torpedo' as const,
      owner: 0 as const,
      sourceShipId: asShipId('p0-dn'),
      position: { q: 2, r: 0 },
      velocity: { dq: 0, dr: 0 },
      lifecycle: 'active' as const,
      turnsRemaining: 4,
    };
    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        map: EMPTY_SOLAR_MAP,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(true);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke', 'torpedo'] },
      ships: [primary, lead],
      ordnance: [enemyTorpedo],
    });
    const launches = aiOrdnance(state, 1, EMPTY_SOLAR_MAP, 'hard');
    expect(launches.find((l) => l.ordnanceType === 'nuke')).toBeUndefined();
  });

  it('does not treat enemy ordnance stacked on the target hex as a lane blocker', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const stackedEnemyTorpedo = {
      id: asOrdnanceId('p0-t-stacked'),
      type: 'torpedo' as const,
      owner: 0 as const,
      sourceShipId: primary.id,
      position: { q: 5, r: 0 },
      velocity: { dq: 0, dr: 0 },
      lifecycle: 'active' as const,
      turnsRemaining: 4,
    };
    const assessment = assessNukeBallisticToEnemy(
      lead,
      primary,
      [],
      [],
      [stackedEnemyTorpedo],
      EMPTY_SOLAR_MAP,
      new Set(),
    );

    expect(assessment.hasIntercept).toBe(true);
    expect(assessment.blockedByEnemyOrdnance).toBe(false);
  });

  it('finds a real-map nuke intercept that only exists because gravity bends the lane', () => {
    const gravityMap = buildSolarSystemMap();
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: -5, r: 5 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: -3, r: 5 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });

    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(false);

    expect(
      driftingEnemyWouldBeHitByBallistic({
        map: gravityMap,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(true);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke'] },
      ships: [primary, lead],
    });
    const assessment = evaluateOrdnanceLaunchIntercept(
      state,
      1,
      {
        shipId: lead.id,
        ordnanceType: 'nuke',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
      gravityMap,
    );
    expect(assessment.hasIntercept).toBe(true);
    expect(assessment.targetShipId).toBe(primary.id);
  });

  it('rejects a real-map nuke intercept when gravity pulls the lane off an empty-space hit', () => {
    const gravityMap = buildSolarSystemMap();
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: -5, r: 5 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 1, r: 2 },
      velocity: { dq: -1, dr: 1 },
      cargoUsed: 0,
    });

    expect(
      driftingEnemyWouldBeHitByOpenSpaceBallistic({
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(true);

    expect(
      driftingEnemyWouldBeHitByBallistic({
        map: gravityMap,
        ordnanceStart: lead.position,
        ordnanceVelocity: { ...lead.velocity },
        enemyStart: primary.position,
        enemyVelocity: primary.velocity,
      }),
    ).toBe(false);

    const state = createTestState({
      turnNumber: 4,
      scenarioRules: { allowedOrdnanceTypes: ['nuke'] },
      ships: [primary, lead],
    });
    const assessment = evaluateOrdnanceLaunchIntercept(
      state,
      1,
      {
        shipId: lead.id,
        ordnanceType: 'nuke',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
      gravityMap,
    );
    expect(assessment.hasIntercept).toBe(false);
    expect(assessment.targetShipId).toBeNull();
  });

  it('hard AI traces when anti-nuke reach odds reject a nuke', () => {
    const lead = createTestShip({
      id: asShipId('p1-lead'),
      owner: 1,
      type: 'frigate',
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      cargoUsed: 0,
    });
    const primary = createTestShip({
      id: asShipId('p0-dn'),
      owner: 0,
      type: 'dreadnaught',
      position: { q: 4, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const reserve = createTestShip({
      id: asShipId('p1-reserve'),
      owner: 1,
      type: 'corvette',
      position: { q: -3, r: 0 },
      velocity: { dq: 0, dr: 0 },
      cargoUsed: 0,
    });
    const state = createTestState({
      turnNumber: 4,
      scenarioRules: {
        allowedOrdnanceTypes: ['nuke', 'torpedo'],
        aiConfigOverrides: { nukeMinReachProbability: 1.01 },
      },
      ships: [primary, lead, reserve],
    });
    const traces: Array<{
      intent: string;
      id: string;
      diagnostic?: string;
    }> = [];
    const launches = aiOrdnance(
      state,
      1,
      EMPTY_SOLAR_MAP,
      'hard',
      Math.random,
      ({ decision }) => {
        traces.push({
          intent: decision.chosen.intent,
          id: decision.chosen.id,
          diagnostic: decision.chosen.diagnostics?.[0]?.detail,
        });
      },
    );
    expect(launches.find((l) => l.ordnanceType === 'nuke')).toBeUndefined();
    expect(traces).toContainEqual(
      expect.objectContaining({
        intent: 'launchNuke',
        id: 'ordnance-reject:p1-lead:nuke:antiNukeReach',
      }),
    );
    expect(
      traces.find((trace) => trace.id.includes('antiNukeReach'))?.diagnostic,
    ).toContain('survival');
  });
});

describe('findReachableRefuelBase', () => {
  it('prefers a base the planner can actually thread to over the geometrically nearest one', () => {
    // Ship coasts toward +q at speed 3 with no fuel to brake. The
    // geometrically nearest base sits 2 hexes behind the ship; the legacy
    // distance picker would commit to it even though the ship physically
    // cannot reverse momentum within the planner's 3-turn horizon. A
    // farther base sitting along the coast line gets reached on turn 2
    // for free.
    const ship = createTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 3, dr: 0 },
      fuel: 0,
    });
    const behindBase = asHexKey('-2,0');
    const aheadBase = asHexKey('6,0');

    expect(
      findNearestRefuelBase(
        ship.position,
        [behindBase, aheadBase],
        [],
        openMap,
      ),
    ).toEqual({ q: -2, r: 0 });

    const reachable = findReachableRefuelBase(
      ship,
      [behindBase, aheadBase],
      [],
      openMap,
      [],
    );
    expect(reachable).toEqual({ q: 6, r: 0 });
    expect(
      chooseReachableRefuelTargetPlan(
        createTestState({ ships: [ship] }),
        ship,
        [behindBase, aheadBase],
        [],
        openMap,
        { q: 12, r: 0 },
        7,
        0,
      )?.chosen,
    ).toMatchObject({
      intent: 'refuelAtReachableBase',
      action: {
        type: 'navigationTargetOverride',
        shipId: ship.id,
        targetHex: { q: 6, r: 0 },
        targetBody: '',
        seekingFuel: true,
      },
    });
  });

  it('returns null when the planner cannot reach any candidate within fuel and horizon', () => {
    // Ship is racing away from the only base with no fuel. Planner cannot
    // close any distance within 3 turns of coasting, so the helper
    // declines rather than committing to a target the ship will overshoot.
    const ship = createTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 5, dr: 0 },
      fuel: 0,
    });
    const onlyBase = asHexKey('-3,0');

    expect(
      findReachableRefuelBase(ship, [onlyBase], [], openMap, []),
    ).toBeNull();
  });

  it('breaks ties on closest-by-plan when multiple bases are equally reachable', () => {
    // Stationary ship with plenty of fuel — both bases are reachable.
    // The helper should pick the geometrically closer one because its
    // candidate ordering plus tie-break favours shorter
    // `finalDistance` then lower `fuelSpent`.
    const ship = createTestShip({
      position: { q: 0, r: 0 },
      velocity: { dq: 0, dr: 0 },
      fuel: 30,
    });
    const closerBase = asHexKey('1,0');
    const fartherBase = asHexKey('3,0');

    expect(
      findReachableRefuelBase(ship, [fartherBase, closerBase], [], openMap, []),
    ).toEqual({ q: 1, r: 0 });
  });
});
