import { beforeEach, describe, expect, it } from 'vitest';
import { must } from '../assert';
import { resolveBaseDefense } from '../combat';
import { ORDNANCE_MASS, SHIP_STATS, type ShipType } from '../constants';
import { asHexKey, hexDistance, hexEqual, hexKey } from '../hex';
import { asGameId, asOrdnanceId, asShipId } from '../ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  findBaseHexes,
  SCENARIOS,
} from '../map-data';
import type {
  AstrogationOrder,
  EngineError,
  GameState,
  Ordnance,
  OrdnanceLaunch,
  PlayerId,
  SolarSystemMap,
} from '../types';
import {
  beginCombatPhase,
  createGameOrThrow,
  type MovementResult,
  processAstrogation,
  processCombat,
  processOrdnance,
  type StateUpdateResult,
  skipCombat,
  skipOrdnance,
} from './game-engine';
import { applyCheckpoints, checkImmediateVictory } from './victory';

let map: SolarSystemMap;
let initialState: GameState;
const getErrorMessage = (error: EngineError): string => error.message;
const openMap: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -50, maxQ: 50, minR: -50, maxR: 50 },
};
beforeEach(() => {
  map = buildSolarSystemMap();
  initialState = createGameOrThrow(
    SCENARIOS.biplanetary,
    map,
    asGameId('TEST1'),
    findBaseHex,
  );
});
const expectMovement = (
  result: MovementResult | StateUpdateResult,
): MovementResult => {
  if (!('movements' in result)) {
    throw new Error('Expected movement result');
  }
  return result;
};
const resolveAstrogationMovement = (
  state: GameState,
  playerId: PlayerId,
  orders: AstrogationOrder[],
): MovementResult => {
  const result = processAstrogation(state, playerId, orders, map, Math.random);
  if ('error' in result) {
    throw new Error(getErrorMessage(result.error));
  }
  if ('movements' in result) {
    return result;
  }
  const followUp = skipOrdnance(result.state, playerId, map, Math.random);
  if ('error' in followUp) {
    throw new Error(getErrorMessage(followUp.error));
  }
  return expectMovement(followUp);
};
// createGame tests moved to game-creation.test.ts
describe('processAstrogation', () => {
  it('rejects orders from wrong player', () => {
    const result = processAstrogation(initialState, 1, [], map, Math.random);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toBe('Not your turn');
    }
  });
  it('rejects orders in wrong phase', () => {
    initialState.phase = 'combat';
    const result = processAstrogation(initialState, 0, [], map, Math.random);
    expect('error' in result).toBe(true);
  });
  it('accepts valid no-burn order for landed ship', () => {
    const orders: AstrogationOrder[] = [
      {
        shipId: initialState.ships[0].id,
        burn: null,
        overload: null,
      },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const movement = expectMovement(result);
      expect(movement.movements).toHaveLength(1);
      expect(movement.movements[0].fuelSpent).toBe(0);
      expect(movement.engineEvents).toContainEqual({
        type: 'astrogationOrdersCommitted',
        playerId: 0,
        orders,
      });
    }
  });
  it('accepts valid burn order and moves ship', () => {
    const ship = initialState.ships[0];
    const startPos = { ...ship.position };
    const orders: AstrogationOrder[] = [
      {
        shipId: ship.id,
        burn: 0, // E
        overload: null,
      },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const movement = expectMovement(result);
      expect(movement.movements[0].fuelSpent).toBe(1);
      // Ship should have moved
      expect(hexEqual(result.state.ships[0].position, startPos)).toBe(false);
      // Ship should no longer be landed
      expect(result.state.ships[0].lifecycle).toBe('active');
    }
  });
  it('applies gravity on the turn after a ship enters a gravity hex', () => {
    const ship = initialState.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: -8, r: -4 };
    ship.velocity = { dq: 0, dr: -1 };
    const first = resolveAstrogationMovement(initialState, 0, [
      { shipId: ship.id, burn: null, overload: null },
    ]);
    const afterFirstMove = must(
      first.state.ships.find((s) => s.id === ship.id),
    );
    expect(afterFirstMove.position).toEqual({ q: -8, r: -5 });
    expect(afterFirstMove.pendingGravityEffects).toHaveLength(1);
    expect(afterFirstMove.pendingGravityEffects?.[0].bodyName).toBe('Mars');
    first.state.phase = 'astrogation';
    first.state.activePlayer = 0;
    const second = resolveAstrogationMovement(first.state, 0, [
      { shipId: ship.id, burn: null, overload: null },
    ]);
    const afterSecondMove = must(
      second.state.ships.find((s) => s.id === ship.id),
    );
    expect(afterSecondMove.position).toEqual({ q: -9, r: -6 });
  });
  it('defers asteroid hazards until combat begins', () => {
    const hazardMap: SolarSystemMap = {
      hexes: new Map([[asHexKey('1,0'), { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      hazardMap,
      asGameId('AST01'),
      findBaseHex,
    );
    const ship = state.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: -1, r: 0 };
    ship.velocity = { dq: 2, dr: 0 };
    const first = processAstrogation(
      state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      hazardMap,
      Math.random,
    );
    expect('error' in first).toBe(false);
    if ('error' in first) return;
    let movement: MovementResult;
    if ('movements' in first) {
      movement = first;
    } else {
      const skipped = skipOrdnance(first.state, 0, hazardMap, Math.random);
      if ('error' in skipped) throw new Error(getErrorMessage(skipped.error));
      movement = expectMovement(skipped);
    }
    expect(
      movement.events.filter((e) => e.type === 'asteroidHit'),
    ).toHaveLength(0);
    expect(movement.state.pendingAsteroidHazards).toHaveLength(1);
    expect(movement.state.phase).toBe('combat');
    const combatStart = beginCombatPhase(
      movement.state,
      0,
      hazardMap,
      () => 0.5,
    );
    expect('error' in combatStart).toBe(false);
    if ('error' in combatStart || !('results' in combatStart)) return;
    expect(combatStart.results).toHaveLength(1);
    expect(combatStart.results[0].attackType).toBe('asteroidHazard');
    expect(combatStart.state.pendingAsteroidHazards).toHaveLength(0);
  });
  it('does not queue an asteroid hazard when movement only runs along a single asteroid hex edge', () => {
    const edgeMap: SolarSystemMap = {
      hexes: new Map([[asHexKey('1,0'), { terrain: 'asteroid' }]]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      edgeMap,
      asGameId('ASTEDGE0'),
      findBaseHex,
    );
    const ship = state.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: 0, r: 0 };
    ship.velocity = { dq: 2, dr: -1 };
    const result = processAstrogation(
      state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      edgeMap,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    let movement: MovementResult;
    if ('movements' in result) {
      movement = result;
    } else {
      const skipped = skipOrdnance(result.state, 0, edgeMap, Math.random);
      if ('error' in skipped) throw new Error(getErrorMessage(skipped.error));
      movement = expectMovement(skipped);
    }
    expect(movement.state.pendingAsteroidHazards).toHaveLength(0);
  });
  it('counts a shared hexside between two asteroid hexes as one asteroid encounter', () => {
    const edgeMap: SolarSystemMap = {
      hexes: new Map([
        [asHexKey('1,0'), { terrain: 'asteroid' }],
        [asHexKey('1,-1'), { terrain: 'asteroid' }],
      ]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      edgeMap,
      asGameId('ASTEDGE1'),
      findBaseHex,
    );
    const ship = state.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: 0, r: 0 };
    ship.velocity = { dq: 2, dr: -1 };
    const result = processAstrogation(
      state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      edgeMap,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    let movement: MovementResult;
    if ('movements' in result) {
      movement = result;
    } else {
      const skipped = skipOrdnance(result.state, 0, edgeMap, Math.random);
      if ('error' in skipped) throw new Error(getErrorMessage(skipped.error));
      movement = expectMovement(skipped);
    }
    expect(movement.state.pendingAsteroidHazards).toHaveLength(1);
  });
  it('rejects invalid burn direction', () => {
    const orders: AstrogationOrder[] = [
      {
        shipId: initialState.ships[0].id,
        burn: 7, // invalid
        overload: null,
      },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(true);
  });
  it('accepts overload order for warship and spends 2 fuel', () => {
    const ship = initialState.ships[0]; // corvette, canOverload = true
    ship.lifecycle = 'active';
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 0, r: 0 };
    const orders: AstrogationOrder[] = [
      {
        shipId: ship.id,
        burn: 0, // E
        overload: 1, // NE
      },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const movement = expectMovement(result);
      expect(movement.movements[0].fuelSpent).toBe(2);
    }
  });
  it('rejects invalid overload direction', () => {
    const ship = initialState.ships[0];
    ship.lifecycle = 'active';
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 0, r: 0 };
    const orders: AstrogationOrder[] = [
      {
        shipId: ship.id,
        burn: 0,
        overload: 7, // invalid
      },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(true);
  });
  it('enters combat phase after astrogation when enemies exist', () => {
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.lifecycle = 'active';
    ship0.position = { q: 0, r: 0 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship0.cargoUsed = SHIP_STATS[ship0.type].cargo;
    ship1.lifecycle = 'active';
    ship1.position = { q: 2, r: 0 };
    ship1.velocity = { dq: 0, dr: 0 };
    const result = processAstrogation(
      initialState,
      0,
      [{ shipId: ship0.id, burn: null, overload: null }],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result || !('movements' in result)) return;
    expect(result.state.phase).toBe('combat');
    expect(result.state.activePlayer).toBe(0);
  });
  it('queues movement and enters ordnance before movement for launch-capable ships', () => {
    const escapeState = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ORDPH'),
      findBaseHex,
    );
    const ship = escapeState.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: 15, r: 0 };
    ship.velocity = { dq: 1, dr: 0 };
    const result = processAstrogation(
      escapeState,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result || 'movements' in result) return;
    expect(result.state.phase).toBe('ordnance');
    expect(result.state.pendingAstrogationOrders).not.toBeNull();
    expect(result.state.ships[0].position).toEqual({
      q: 15,
      r: 0,
    });
  });
  it('switches active player after skipping combat', () => {
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.lifecycle = 'active';
    ship0.position = { q: 0, r: 0 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship0.cargoUsed = SHIP_STATS[ship0.type].cargo;
    ship1.lifecycle = 'active';
    ship1.position = { q: 2, r: 0 };
    ship1.velocity = { dq: 0, dr: 0 };
    const result = processAstrogation(
      initialState,
      0,
      [{ shipId: ship0.id, burn: null, overload: null }],
      openMap,
      Math.random,
    );
    if ('error' in result) return;
    // Skip combat to advance turn
    const combatResult = skipCombat(result.state, 0, openMap, Math.random);
    expect('error' in combatResult).toBe(false);
    if ('error' in combatResult) return;
    expect(combatResult.state.activePlayer).toBe(1);
    expect(combatResult.state.phase).toBe('astrogation');
  });
  it('increments turn number after both players complete turns', () => {
    for (const [idx, ship] of initialState.ships.entries()) {
      ship.lifecycle = 'active';
      ship.position = { q: idx * 3, r: 0 };
      ship.velocity = { dq: 0, dr: 0 };
      ship.cargoUsed = SHIP_STATS[ship.type].cargo;
    }
    // Player 0's turn: astrogation + skip combat
    const orders0: AstrogationOrder[] = [
      {
        shipId: initialState.ships[0].id,
        burn: null,
        overload: null,
      },
    ];
    const result0 = processAstrogation(
      initialState,
      0,
      orders0,
      openMap,
      Math.random,
    );
    expect('error' in result0).toBe(false);
    if ('error' in result0) return;
    const skip0 = skipCombat(result0.state, 0, openMap, Math.random);
    expect('error' in skip0).toBe(false);
    if ('error' in skip0) return;
    expect(skip0.state.turnNumber).toBe(1); // Still turn 1
    // Player 1's turn: astrogation + skip combat
    const orders1: AstrogationOrder[] = [
      {
        shipId: skip0.state.ships[1].id,
        burn: null,
        overload: null,
      },
    ];
    const result1 = processAstrogation(
      skip0.state,
      1,
      orders1,
      openMap,
      Math.random,
    );
    expect('error' in result1).toBe(false);
    if ('error' in result1) return;
    const skip1 = skipCombat(result1.state, 1, openMap, Math.random);
    expect('error' in skip1).toBe(false);
    if ('error' in skip1) return;
    expect(skip1.state.turnNumber).toBe(2); // Now turn 2
    expect(skip1.state.activePlayer).toBe(0); // Back to player 0
  });
});
describe('resupply on landing', () => {
  it('refuels ship when landing at a base', () => {
    // Take off first (uses 1 fuel)
    const ship = initialState.ships[0];
    const orders: AstrogationOrder[] = [
      { shipId: ship.id, burn: 0, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    const movedShip = result.state.ships[0];
    expect(movedShip.fuel).toBe(19); // Used 1 fuel for takeoff
    // Now simulate a legal orbital landing at the friendly Mars base.
    const marsBase = must(findBaseHex(map, 'Mars'));
    movedShip.position = { q: marsBase.q, r: marsBase.r + 1 };
    movedShip.velocity = { dq: 0, dr: -1 };
    movedShip.lifecycle = 'active';
    movedShip.fuel = 5; // Low fuel
    movedShip.pendingGravityEffects = [
      {
        hex: { q: marsBase.q, r: marsBase.r + 1 },
        direction: 3,
        bodyName: 'Mars',
        strength: 'full',
        ignored: false,
      },
    ];
    // Switch to player 0's turn
    result.state.activePlayer = 0;
    result.state.phase = 'astrogation';
    const landingOrders: AstrogationOrder[] = [
      { shipId: movedShip.id, burn: 0, overload: null },
    ];
    const landResult = processAstrogation(
      result.state,
      0,
      landingOrders,
      map,
      Math.random,
    );
    if ('error' in landResult) return;
    const landedShip = landResult.state.ships[0];
    expect(landedShip.lifecycle).toBe('landed');
    const stats = SHIP_STATS[landedShip.type];
    expect(landedShip.fuel).toBe(stats.fuel);
    expect(landedShip.damage.disabledTurns).toBe(0);
  });
  it('does not resupply when landing at an unowned base', () => {
    const ship = initialState.ships[0];
    const orders: AstrogationOrder[] = [
      { shipId: ship.id, burn: 0, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    const movedShip = result.state.ships[0];
    const marsBase = must(findBaseHex(map, 'Mars'));
    const venusBase = must(findBaseHex(map, 'Venus'));
    result.state.players[0].bases = [hexKey(venusBase)];
    movedShip.position = { q: marsBase.q, r: marsBase.r + 1 };
    movedShip.velocity = { dq: 0, dr: -1 };
    movedShip.lifecycle = 'active';
    movedShip.fuel = 5;
    movedShip.pendingGravityEffects = [
      {
        hex: { q: marsBase.q, r: marsBase.r + 1 },
        direction: 3,
        bodyName: 'Mars',
        strength: 'full',
        ignored: false,
      },
    ];
    result.state.activePlayer = 0;
    result.state.phase = 'astrogation';
    const landResult = processAstrogation(
      result.state,
      0,
      [{ shipId: movedShip.id, burn: 0, overload: null }],
      map,
      Math.random,
    );
    if ('error' in landResult) return;
    const landedShip = landResult.state.ships[0];
    expect(landedShip.lifecycle).toBe('landed');
    expect(landedShip.fuel).toBe(4);
  });
});
describe('victory conditions', () => {
  it('landing on target body wins the game', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = initialState.ships[0];
    initialState.players[0].targetBody = 'Mars';
    ship.position = { q: marsBase.q, r: marsBase.r + 1 };
    ship.velocity = { dq: 0, dr: -1 };
    ship.lifecycle = 'active';
    ship.pendingGravityEffects = [
      {
        hex: { q: marsBase.q, r: marsBase.r + 1 },
        direction: 3,
        bodyName: 'Mars',
        strength: 'full',
        ignored: false,
      },
    ];
    const orders: AstrogationOrder[] = [
      { shipId: ship.id, burn: 0, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    const landedShip = result.state.ships[0];
    expect(landedShip.lifecycle).toBe('landed');
    expect(result.state.phase).toBe('gameOver');
    expect(result.state.outcome?.winner).toBe(0);
    expect(result.state.outcome?.reason).toContain('Mars');
  });
});
describe('Escape scenario', () => {
  let escapeState: GameState;
  beforeEach(() => {
    escapeState = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ESC01'),
      findBaseHex,
    );
  });
  it('creates correct number of ships per player', () => {
    const p0Ships = escapeState.ships.filter((s) => s.owner === 0);
    const p1Ships = escapeState.ships.filter((s) => s.owner === 1);
    expect(p0Ships).toHaveLength(3); // 3 transports
    expect(p1Ships).toHaveLength(2); // 1 corvette + 1 corsair (per rules)
  });
  it('pilgrim transports start landed at Terra base', () => {
    const p0Ships = escapeState.ships.filter((s) => s.owner === 0);
    for (const ship of p0Ships) {
      expect(ship.type).toBe('transport');
      expect(ship.lifecycle).toBe('landed');
    }
  });
  it('enforcer ships start not landed', () => {
    const p1Ships = escapeState.ships.filter((s) => s.owner === 1);
    for (const ship of p1Ships) {
      expect(ship.lifecycle).toBe('active');
    }
  });
  it('enforcer ship types are corvettes and corsair', () => {
    const p1Ships = escapeState.ships.filter((s) => s.owner === 1);
    const types = p1Ships.map((s) => s.type).sort();
    expect(types).toEqual(['corsair', 'corvette']);
  });
  it('pilgrim player has escapeWins = true', () => {
    expect(escapeState.players[0].escapeWins).toBe(true);
    expect(escapeState.players[1].escapeWins).toBe(false);
  });
  it('ship escaping map bounds wins for pilgrim', () => {
    // The fugitive ship must escape to win
    const fugitive = must(
      escapeState.ships.find((s) => s.identity?.hasFugitives),
    );
    fugitive.position = { q: 0, r: map.bounds.minR - 5 };
    fugitive.velocity = { dq: 0, dr: -2 };
    fugitive.lifecycle = 'active';
    const orders: AstrogationOrder[] = escapeState.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: null, overload: null }));
    const result = processAstrogation(escapeState, 0, orders, map, Math.random);
    if ('error' in result) return;
    expect(result.state.phase).toBe('gameOver');
    expect(result.state.outcome?.winner).toBe(0);
    expect(result.state.outcome?.reason).toContain('escaped beyond Jupiter');
  });
  it('destroying all pilgrim ships wins for enforcer', () => {
    // Destroy all pilgrim ships
    for (const ship of escapeState.ships) {
      if (ship.owner === 0) {
        ship.lifecycle = 'destroyed';
      }
    }
    // Enforcer makes a move — checkGameEnd should trigger (fugitive destroyed)
    const enforcerShip = must(escapeState.ships.find((s) => s.owner === 1));
    escapeState.activePlayer = 1;
    const orders: AstrogationOrder[] = [
      { shipId: enforcerShip.id, burn: null, overload: null },
    ];
    const result = processAstrogation(escapeState, 1, orders, map, Math.random);
    if ('error' in result) return;
    expect(result.state.phase).toBe('gameOver');
    expect(result.state.outcome?.winner).toBe(1);
    // All pilgrim ships destroyed — generic fleet elimination
    expect(result.state.outcome?.reason).toBeTruthy();
  });
  it('handles multiple ships with same orders', () => {
    const orders: AstrogationOrder[] = escapeState.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: 1, overload: null })); // All burn NE
    const result = resolveAstrogationMovement(escapeState, 0, orders);
    expect(result.movements).toHaveLength(3);
    for (const m of result.movements) {
      expect(m.fuelSpent).toBe(1);
    }
  });
});
describe('ordnance system', () => {
  it('launches a mine from cargo', () => {
    // Take off first to get ship airborne
    const ship = initialState.ships[0]; // corvette, cargo=5
    ship.lifecycle = 'active';
    ship.velocity = { dq: 1, dr: 0 };
    ship.position = { q: 0, r: 0 };
    // Advance to ordnance phase
    const orders: AstrogationOrder[] = [
      { shipId: ship.id, burn: null, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    // If ordnance phase was entered
    if (result.state.phase === 'ordnance') {
      const launches: OrdnanceLaunch[] = [
        {
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ];
      const ordResult = processOrdnance(
        result.state,
        0,
        launches,
        map,
        Math.random,
      );
      expect('error' in ordResult).toBe(false);
      if (!('error' in ordResult)) {
        // Mine should exist
        expect(ordResult.state.ordnance).toHaveLength(1);
        expect(ordResult.state.ordnance[0].type).toBe('mine');
        // Cargo used should increase
        const movedShip = must(
          ordResult.state.ships.find((s) => s.id === ship.id),
        );
        expect(movedShip.cargoUsed).toBe(ORDNANCE_MASS.mine);
      }
    }
  });
  it('assigns a fresh ordnance id even when earlier ids are still present', () => {
    const state = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      asGameId('ORD02'),
      findBaseHex,
    );
    const ship = must(state.ships.find((s) => s.type === 'packet'));
    ship.lifecycle = 'active';
    ship.velocity = { dq: 1, dr: 0 };
    ship.position = { q: 0, r: 0 };
    state.phase = 'ordnance';
    state.activePlayer = 0;
    state.pendingAstrogationOrders = [
      { shipId: ship.id, burn: 0, overload: null },
    ];
    state.ordnance = [
      {
        id: asOrdnanceId('ord0'),
        type: 'torpedo',
        owner: 0,
        sourceShipId: null,
        position: { q: -1, r: 0 },
        velocity: { dq: 1, dr: 0 },
        turnsRemaining: 4,
        lifecycle: 'active' as const,
      },
      {
        id: asOrdnanceId('ord3'),
        type: 'nuke',
        owner: 1,
        sourceShipId: null,
        position: { q: 2, r: 0 },
        velocity: { dq: -1, dr: 0 },
        turnsRemaining: 4,
        lifecycle: 'active' as const,
      },
    ];
    const result = processOrdnance(
      state,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.engineEvents).toContainEqual({
        type: 'ordnanceLaunchesCommitted',
        playerId: 0,
        launches: [
          {
            shipId: ship.id,
            ordnanceType: 'mine',
            torpedoAccel: null,
            torpedoAccelSteps: null,
          },
        ],
      });
      expect(
        result.ordnanceMovements.some((move) => move.ordnanceId === 'ord4'),
      ).toBe(true);
    }
  });
  it('rejects mine launch when landed', () => {
    const ship = initialState.ships[0];
    // Ship is landed, force ordnance phase
    initialState.phase = 'ordnance';
    const launches: OrdnanceLaunch[] = [
      {
        shipId: ship.id,
        ordnanceType: 'mine',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
    ];
    const result = processOrdnance(initialState, 0, launches, map, Math.random);
    expect('error' in result).toBe(true);
  });
  it('rejects torpedo from non-warship', () => {
    const blockadeState = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      asGameId('ORD01'),
      findBaseHex,
    );
    const transport = must(
      blockadeState.ships.find((s) => s.type === 'packet'),
    );
    transport.lifecycle = 'active';
    transport.velocity = { dq: 1, dr: 0 };
    blockadeState.phase = 'ordnance';
    blockadeState.activePlayer = 0;
    const launches: OrdnanceLaunch[] = [
      {
        shipId: transport.id,
        ordnanceType: 'torpedo',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
    ];
    const result = processOrdnance(
      blockadeState,
      0,
      launches,
      map,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('warship');
    }
  });
  it('rejects launch when cargo full', () => {
    const ship = initialState.ships[0]; // corvette, cargo=5
    ship.lifecycle = 'active';
    ship.velocity = { dq: 1, dr: 0 };
    ship.position = { q: 0, r: 0 };
    ship.cargoUsed = 5; // all cargo used
    initialState.phase = 'ordnance';
    const launches: OrdnanceLaunch[] = [
      {
        shipId: ship.id,
        ordnanceType: 'mine',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
    ];
    const result = processOrdnance(initialState, 0, launches, map, Math.random);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('cargo');
    }
  });
  it('skipOrdnance advances to combat phase', () => {
    initialState.phase = 'ordnance';
    const result = skipOrdnance(initialState, 0, map, Math.random);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      // Should advance past ordnance
      expect(result.state.phase).not.toBe('ordnance');
    }
  });
  it("does not move enemy ordnance during the active player's movement phase", () => {
    initialState.phase = 'ordnance';
    initialState.ordnance = [
      {
        id: asOrdnanceId('enemy-mine'),
        type: 'mine',
        owner: 1,
        sourceShipId: null,
        position: { q: 0, r: 0 },
        velocity: { dq: 1, dr: 0 },
        turnsRemaining: 5,
        lifecycle: 'active' as const,
        pendingGravityEffects: [],
      },
    ];
    const result = skipOrdnance(initialState, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.ordnance).toEqual([
      expect.objectContaining({
        id: asOrdnanceId('enemy-mine'),
        position: { q: 0, r: 0 },
        turnsRemaining: 5,
      }),
    ]);
  });
  it('ordnance moves with gravity and self-destructs after 5 turns', () => {
    initialState.ordnance = [
      {
        id: asOrdnanceId('ord0'),
        type: 'mine',
        owner: 0,
        sourceShipId: null,
        position: { q: 0, r: 0 },
        velocity: { dq: 1, dr: 0 },
        turnsRemaining: 1, // will self-destruct this turn
        lifecycle: 'active' as const,
      },
    ];
    const ship = initialState.ships[0];
    ship.lifecycle = 'active';
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 5, r: 5 };
    const orders: AstrogationOrder[] = [
      { shipId: ship.id, burn: null, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    // Ordnance should have been removed (self-destructed)
    expect(result.state.ordnance).toHaveLength(0);
  });
  it('detonates a stationary mine when a ship passes through its hex', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('MINEPATH'),
      findBaseHex,
    );
    const ship = state.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: -1, r: 0 };
    ship.velocity = { dq: 2, dr: 0 };
    state.ordnance.push({
      id: asOrdnanceId('mine-path'),
      type: 'mine',
      owner: 1,
      sourceShipId: null,
      position: { q: 0, r: 0 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 5,
      lifecycle: 'active' as const,
      pendingGravityEffects: [],
    });

    const first = processAstrogation(
      state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      openMap,
      Math.random,
    );
    expect('error' in first).toBe(false);
    if ('error' in first) return;

    const result =
      'movements' in first
        ? first
        : skipOrdnance(first.state, 0, openMap, Math.random);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const movement = expectMovement(result);

    expect(
      movement.events.some(
        (event) =>
          event.type === 'mineDetonation' && event.ordnanceId === 'mine-path',
      ),
    ).toBe(true);
    expect(movement.state.ordnance).toHaveLength(0);
  });
  it('detonates a friendly mine when its source ship re-enters the mine hex', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('MINEOWN'),
      findBaseHex,
    );
    const ship = state.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: -1, r: 0 };
    ship.velocity = { dq: 2, dr: 0 };
    state.ordnance.push({
      id: asOrdnanceId('mine-own'),
      type: 'mine',
      owner: 0,
      sourceShipId: ship.id,
      position: { q: 0, r: 0 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 4,
      lifecycle: 'active' as const,
      pendingGravityEffects: [],
    });

    const first = processAstrogation(
      state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      openMap,
      Math.random,
    );
    expect('error' in first).toBe(false);
    if ('error' in first) return;

    const result =
      'movements' in first
        ? first
        : skipOrdnance(first.state, 0, openMap, Math.random);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const movement = expectMovement(result);

    expect(
      movement.events.some(
        (event) =>
          event.type === 'mineDetonation' && event.ordnanceId === 'mine-own',
      ),
    ).toBe(true);
    expect(movement.ordnanceMovements).toContainEqual(
      expect.objectContaining({
        ordnanceId: 'mine-own',
        from: { q: 0, r: 0 },
        to: { q: 0, r: 0 },
        path: [{ q: 0, r: 0 }],
        detonated: true,
      }),
    );
    expect(movement.state.ordnance).toHaveLength(0);
  });
  it('detonates ordnance on its final turn before expiry and stops animation at impact', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('MINELAST'),
      findBaseHex,
    );
    const mover = state.ships[0];
    mover.lifecycle = 'active';
    mover.position = { q: -10, r: 0 };
    mover.velocity = { dq: 0, dr: 0 };
    const target = state.ships[1];
    target.lifecycle = 'active';
    target.position = { q: 1, r: 0 };
    target.velocity = { dq: 0, dr: 0 };
    state.ordnance.push({
      id: asOrdnanceId('mine-last-turn'),
      type: 'mine',
      owner: 0,
      sourceShipId: null,
      position: { q: 0, r: 0 },
      velocity: { dq: 2, dr: 0 },
      turnsRemaining: 1,
      lifecycle: 'active' as const,
      pendingGravityEffects: [],
    });

    const first = processAstrogation(
      state,
      0,
      [{ shipId: mover.id, burn: null, overload: null }],
      openMap,
      Math.random,
    );
    expect('error' in first).toBe(false);
    if ('error' in first) return;

    const result =
      'movements' in first
        ? first
        : skipOrdnance(first.state, 0, openMap, Math.random);

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const movement = expectMovement(result);
    const ordnanceMove = movement.ordnanceMovements.find(
      (entry) => entry.ordnanceId === 'mine-last-turn',
    );

    expect(
      movement.events.some(
        (event) =>
          event.type === 'mineDetonation' &&
          event.ordnanceId === 'mine-last-turn' &&
          event.shipId === target.id,
      ),
    ).toBe(true);
    expect(
      movement.engineEvents.some(
        (event) =>
          event.type === 'ordnanceExpired' &&
          event.ordnanceId === 'mine-last-turn',
      ),
    ).toBe(false);
    expect(ordnanceMove).toMatchObject({
      to: { q: 1, r: 0 },
      path: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      detonated: true,
    });
    expect(movement.state.ordnance).toHaveLength(0);
  });
  it('ordnance defers gravity until the turn after entry', () => {
    const gravityMap: SolarSystemMap = {
      hexes: new Map([
        [
          asHexKey('1,0'),
          {
            terrain: 'space',
            gravity: { direction: 3, strength: 'full', bodyName: 'TestWorld' },
          },
        ],
      ]),
      bodies: [],
      bounds: { minQ: -10, maxQ: 10, minR: -10, maxR: 10 },
    };
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      gravityMap,
      asGameId('ORDGR'),
      findBaseHex,
    );
    state.ordnance = [
      {
        id: asOrdnanceId('ord0'),
        type: 'mine',
        owner: 0,
        sourceShipId: null,
        position: { q: 1, r: 1 },
        velocity: { dq: 0, dr: -1 },
        turnsRemaining: 5,
        lifecycle: 'active' as const,
        pendingGravityEffects: [],
      },
    ];
    const ship = state.ships[0];
    ship.lifecycle = 'active';
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 5, r: 5 };
    const firstResult = processAstrogation(
      state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      gravityMap,
      Math.random,
    );
    expect('error' in firstResult).toBe(false);
    if ('error' in firstResult) return;
    let first: MovementResult;
    if ('movements' in firstResult) {
      first = firstResult;
    } else {
      const skipped = skipOrdnance(
        firstResult.state,
        0,
        gravityMap,
        Math.random,
      );
      if ('error' in skipped) throw new Error(getErrorMessage(skipped.error));
      first = expectMovement(skipped);
    }
    expect(first.state.ordnance).toHaveLength(1);
    expect(first.state.ordnance[0].position).toEqual({ q: 1, r: 0 });
    expect(first.state.ordnance[0].pendingGravityEffects).toHaveLength(1);
    first.state.phase = 'astrogation';
    first.state.activePlayer = 0;
    const secondResult = processAstrogation(
      first.state,
      0,
      [{ shipId: ship.id, burn: null, overload: null }],
      gravityMap,
      Math.random,
    );
    expect('error' in secondResult).toBe(false);
    if ('error' in secondResult) return;
    let second: MovementResult;
    if ('movements' in secondResult) {
      second = secondResult;
    } else {
      const skipped = skipOrdnance(
        secondResult.state,
        0,
        gravityMap,
        Math.random,
      );
      if ('error' in skipped) throw new Error(getErrorMessage(skipped.error));
      second = expectMovement(skipped);
    }
    expect(second.state.ordnance).toHaveLength(1);
    expect(second.state.ordnance[0].position).toEqual({ q: 0, r: -1 });
  });
  it('torpedoes detonate on friendly ships in their path', () => {
    const ship = initialState.ships[0];
    ship.type = 'frigate';
    ship.lifecycle = 'active';
    ship.position = { q: 15, r: 0 };
    ship.velocity = { dq: 1, dr: 0 };
    initialState.phase = 'ordnance';
    initialState.ships.push({
      id: asShipId('friendly-target'),
      type: 'packet',
      owner: 0,
      originalOwner: 0,
      position: { q: 17, r: 0 },
      velocity: { dq: 0, dr: 0 },
      fuel: 10,
      cargoUsed: 0,
      lifecycle: 'active' as const,
      control: 'own' as const,
      heroismAvailable: false,
      overloadUsed: false,
      nukesLaunchedSinceResupply: 0,
      detected: true,
      resuppliedThisTurn: false,
      damage: { disabledTurns: 0 },
    });
    const result = processOrdnance(
      initialState,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'torpedo',
          torpedoAccel: 0,
          torpedoAccelSteps: null,
        },
      ],
      map,
      () => 0.4,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const hits = result.events.filter(
      (e) => e.type === 'torpedoHit' && e.shipId === 'friendly-target',
    );
    expect(hits).toHaveLength(1);
  });
  it('torpedoes can use a 2-hex launch boost', () => {
    const ship = initialState.ships[0];
    ship.type = 'frigate';
    ship.lifecycle = 'active';
    ship.position = { q: 10, r: 0 };
    ship.velocity = { dq: 1, dr: 0 };
    initialState.phase = 'ordnance';
    const result = processOrdnance(
      initialState,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'torpedo',
          torpedoAccel: 0,
          torpedoAccelSteps: 2,
        },
      ],
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.ordnance[0].velocity).toEqual({ dq: 3, dr: 0 });
  });
  it('torpedoes detonate when entering asteroid hexes', () => {
    const asteroidKey = Array.from(map.hexes.entries()).find(
      ([, hex]) => hex.terrain === 'asteroid',
    )?.[0];
    expect(asteroidKey).toBeTruthy();
    if (!asteroidKey) return;
    const [aq, ar] = asteroidKey.split(',').map(Number);
    const ship = initialState.ships[0];
    ship.type = 'frigate';
    ship.lifecycle = 'active';
    ship.position = { q: aq - 2, r: ar };
    ship.velocity = { dq: 1, dr: 0 };
    initialState.phase = 'ordnance';
    const result = processOrdnance(
      initialState,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'torpedo',
          torpedoAccel: 0,
          torpedoAccelSteps: null,
        },
      ],
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.ordnance).toHaveLength(0);
    expect(result.ordnanceMovements[0].detonated).toBe(true);
  });
  it('tracks asteroid destruction in game state without mutating the map', () => {
    const asteroidKey = Array.from(map.hexes.entries()).find(([key, hex]) => {
      if (hex.terrain !== 'asteroid') {
        return false;
      }

      const [q, r] = key.split(',').map(Number);
      const westHex = map.hexes.get(hexKey({ q: q - 1, r }));

      return (
        westHex?.terrain == null ||
        (westHex.terrain === 'space' &&
          westHex.body == null &&
          westHex.base == null)
      );
    })?.[0];
    expect(asteroidKey).toBeTruthy();
    if (!asteroidKey) return;
    const [aq, ar] = asteroidKey.split(',').map(Number);
    const ship = initialState.ships[0];
    ship.lifecycle = 'active';
    ship.position = { q: aq - 1, r: ar };
    ship.velocity = { dq: 1, dr: 0 };
    ship.type = 'frigate';
    initialState.phase = 'ordnance';
    const result = processOrdnance(
      initialState,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.destroyedAsteroids).toContain(asteroidKey);
    expect(result.engineEvents).toContainEqual({
      type: 'asteroidDestroyed',
      hex: { q: aq, r: ar },
    });
    expect(result.engineEvents).toContainEqual({
      type: 'ordnanceDetonated',
      ordnanceId: 'ord0',
      ordnanceType: 'nuke',
      hex: { q: aq, r: ar },
      roll: 0,
      damageType: 'none',
      disabledTurns: 0,
    });
    expect(result.engineEvents).toContainEqual({
      type: 'ordnanceDestroyed',
      ordnanceId: 'ord0',
      cause: 'nuke',
    });
    expect(map.hexes.get(asteroidKey)?.terrain).toBe('asteroid');
  });
});
describe('detection / fog of war', () => {
  it('ships start as undetected', () => {
    for (const ship of initialState.ships) {
      expect(ship.detected).toBe(false);
    }
  });
  it('detects ships within ship detection range after movement', () => {
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.lifecycle = 'active';
    ship0.position = { q: 0, r: 0 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.lifecycle = 'active';
    ship1.position = { q: 2, r: 0 }; // within range 3
    ship1.velocity = { dq: 0, dr: 0 };
    ship1.detected = false; // pretend undetected
    const orders: AstrogationOrder[] = [
      { shipId: ship0.id, burn: null, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    // Ship1 should be detected (within range 3 of ship0)
    const detectedShip = must(
      result.state.ships.find((s) => s.id === ship1.id),
    );
    expect(detectedShip.detected).toBe(true);
  });
  it('does not detect ships beyond detection range', () => {
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.lifecycle = 'active';
    ship0.position = { q: -20, r: -20 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.lifecycle = 'active';
    ship1.position = { q: 20, r: 20 }; // far from ship0 and any bases
    ship1.velocity = { dq: 0, dr: 0 };
    ship1.detected = false; // start undetected
    const orders: AstrogationOrder[] = [
      { shipId: ship0.id, burn: null, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    const detectedShip = must(
      result.state.ships.find((s) => s.id === ship1.id),
    );
    expect(detectedShip.detected).toBe(false);
  });
  it('detected ships stay detected after moving out of range (rulebook p.8)', () => {
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.lifecycle = 'active';
    ship0.position = { q: 0, r: 0 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.lifecycle = 'active';
    ship1.position = { q: 10, r: 0 }; // beyond range
    ship1.velocity = { dq: 0, dr: 0 };
    ship1.detected = true; // was previously detected
    const orders: AstrogationOrder[] = [
      { shipId: ship0.id, burn: null, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    // Remains detected regardless of range (rulebook p.8)
    const detectedShip = must(
      result.state.ships.find((s) => s.id === ship1.id),
    );
    expect(detectedShip.detected).toBe(true);
  });
});
describe('base defense fire', () => {
  it('fires at enemy ships in gravity hex adjacent to base', () => {
    // Find a base and its adjacent gravity hex
    const marsBase = must(findBaseHex(map, 'Mars'));
    expect(marsBase).not.toBeNull();
    // Find gravity hex adjacent to this base
    let gravHex: {
      q: number;
      r: number;
    } | null = null;
    for (const [key, hex] of map.hexes) {
      if (!hex.gravity || hex.gravity.bodyName !== 'Mars') continue;
      const [gq, gr] = key.split(',').map(Number);
      if (hexDistance({ q: gq, r: gr }, marsBase) === 1) {
        gravHex = { q: gq, r: gr };
        break;
      }
    }
    if (!gravHex) return; // Skip if map layout doesn't have this
    // Place enemy ship in the gravity hex
    const state = {
      ships: [
        {
          id: asShipId('enemy'),
          type: 'corvette' as ShipType,
          owner: 1 as PlayerId,
          originalOwner: 1 as PlayerId,
          position: gravHex,
          velocity: { dq: 0, dr: 0 },
          fuel: 20,
          cargoUsed: 0,
          lifecycle: 'active' as const,
          control: 'own' as const,
          heroismAvailable: false,
          overloadUsed: false,
          nukesLaunchedSinceResupply: 0,
          detected: true,
          resuppliedThisTurn: false,
          damage: { disabledTurns: 0 },
        },
      ],
      players: [
        { bases: [hexKey(marsBase)] },
        { bases: [hexKey(must(findBaseHex(map, 'Venus')))] },
      ],
    };
    // Fixed RNG for deterministic result
    const results = resolveBaseDefense(state, 0, map, () => 0.5);
    // Should have fired at the enemy ship
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].targetId).toBe('enemy');
    expect(results[0].odds).toBe('2:1');
    expect(results[0].rangeMod).toBe(0);
    expect(results[0].velocityMod).toBe(0);
  });
  it('does not fire at landed ships', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const state = {
      ships: [
        {
          id: asShipId('enemy'),
          type: 'corvette' as ShipType,
          owner: 1 as PlayerId,
          originalOwner: 1 as PlayerId,
          position: marsBase,
          velocity: { dq: 0, dr: 0 },
          fuel: 20,
          cargoUsed: 0,
          lifecycle: 'landed' as const,
          control: 'own' as const,
          heroismAvailable: false,
          overloadUsed: false,
          nukesLaunchedSinceResupply: 0,
          detected: true,
          resuppliedThisTurn: false,
          damage: { disabledTurns: 0 },
        },
      ],
      players: [
        { bases: [hexKey(marsBase)] },
        { bases: [hexKey(must(findBaseHex(map, 'Venus')))] },
      ],
    };
    const results = resolveBaseDefense(state, 0, map, Math.random);
    expect(results).toHaveLength(0);
  });
  it('does not fire from neutral bases outside the active player owned set', () => {
    const mercuryBase = must(findBaseHex(map, 'Mercury'));
    let gravHex: {
      q: number;
      r: number;
    } | null = null;
    for (const [key, hex] of map.hexes) {
      if (!hex.gravity || hex.gravity.bodyName !== 'Mercury') continue;
      const [gq, gr] = key.split(',').map(Number);
      if (hexDistance({ q: gq, r: gr }, mercuryBase) === 1) {
        gravHex = { q: gq, r: gr };
        break;
      }
    }
    expect(gravHex).not.toBeNull();
    if (!gravHex) return;
    const results = resolveBaseDefense(
      {
        ships: [
          {
            id: asShipId('enemy'),
            type: 'corvette',
            owner: 1,
            originalOwner: 1,
            position: gravHex,
            velocity: { dq: 0, dr: 0 },
            fuel: 20,
            cargoUsed: 0,
            lifecycle: 'active' as const,
            control: 'own' as const,
            heroismAvailable: false,
            overloadUsed: false,
            nukesLaunchedSinceResupply: 0,
            detected: true,
            resuppliedThisTurn: false,
            damage: { disabledTurns: 0 },
          },
        ],
        players: [
          { bases: [hexKey(must(findBaseHex(map, 'Mars')))] },
          { bases: [hexKey(must(findBaseHex(map, 'Venus')))] },
        ],
      },
      0,
      map,
      () => 0.5,
    );
    expect(results).toHaveLength(0);
  });
  it('only fires from the owned base when both players share a world', () => {
    const [westBase, eastBase] = findBaseHexes(map, 'Mercury').sort(
      (a, b) => a.q - b.q,
    );
    const defenseState = {
      ships: [
        {
          id: asShipId('enemy-east'),
          type: 'corvette' as ShipType,
          owner: 1 as PlayerId,
          originalOwner: 1 as PlayerId,
          position: { q: eastBase.q, r: eastBase.r + 1 },
          velocity: { dq: 0, dr: 0 },
          fuel: 20,
          cargoUsed: 0,
          lifecycle: 'active' as const,
          control: 'own' as const,
          heroismAvailable: false,
          overloadUsed: false,
          nukesLaunchedSinceResupply: 0,
          detected: true,
          resuppliedThisTurn: false,
          damage: { disabledTurns: 0 },
        },
      ],
      players: [{ bases: [hexKey(westBase)] }, { bases: [hexKey(eastBase)] }],
    };
    expect(resolveBaseDefense(defenseState, 0, map, () => 0.5)).toHaveLength(0);
    defenseState.ships[0].position = {
      q: westBase.q,
      r: westBase.r + 1,
    };
    const results = resolveBaseDefense(defenseState, 0, map, () => 0.5);
    expect(results).toHaveLength(1);
    expect(results[0].attackerIds).toEqual([`base:${hexKey(westBase)}`]);
  });
  it('fires at enemy nukes with range and velocity modifiers', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const state = {
      ships: [],
      ordnance: [
        {
          id: asOrdnanceId('enemy-nuke'),
          type: 'nuke',
          owner: 1,
          sourceShipId: null,
          position: { q: marsBase.q + 2, r: marsBase.r },
          velocity: { dq: 3, dr: 0 },
          turnsRemaining: 5,
          lifecycle: 'active' as const,
          pendingGravityEffects: [],
        },
      ] as Ordnance[],
      destroyedBases: [],
      players: [
        { bases: [hexKey(marsBase)] },
        { bases: [hexKey(must(findBaseHex(map, 'Venus')))] },
      ],
    };
    const results = resolveBaseDefense(state, 0, map, () => 0.99);
    expect(results).toHaveLength(1);
    expect(results[0].targetId).toBe('enemy-nuke');
    expect(results[0].targetType).toBe('ordnance');
    expect(results[0].rangeMod).toBe(2);
    expect(results[0].velocityMod).toBe(1);
    expect(results[0].damageType).toBe('eliminated');
  });
});
describe('ramming', () => {
  it('ships on same hex after movement trigger ramming damage', () => {
    // Position both ships to collide at the same hex
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.lifecycle = 'active';
    ship0.position = { q: 5, r: 5 };
    ship0.velocity = { dq: 1, dr: 0 };
    ship1.lifecycle = 'active';
    ship1.position = { q: 7, r: 5 };
    ship1.velocity = { dq: -1, dr: 0 };
    // Both heading toward q:6, r:5
    const orders: AstrogationOrder[] = [
      { shipId: ship0.id, burn: null, overload: null },
    ];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if ('error' in result) return;
    const movement = expectMovement(result);
    // Check if the ship ended up on the same hex as the enemy
    const s0 = result.state.ships[0];
    const s1 = result.state.ships[1];
    if (hexEqual(s0.position, s1.position)) {
      // Should have ram events
      const ramEvents = movement.events.filter((e) => e.type === 'ramming');
      expect(ramEvents.length).toBeGreaterThan(0);
    }
  });
});
describe('nuke ordnance', () => {
  it('launches nuke from warship with sufficient cargo', () => {
    // Corvette has cargo=5, nuke needs 20. Use a frigate (cargo=40) instead.
    const ship = initialState.ships[0];
    ship.type = 'frigate'; // canOverload=true, cargo=40
    ship.lifecycle = 'active';
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 15, r: 0 };
    initialState.phase = 'ordnance';
    const launches: OrdnanceLaunch[] = [
      {
        shipId: ship.id,
        ordnanceType: 'nuke',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
    ];
    const result = processOrdnance(initialState, 0, launches, map, Math.random);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.state.ordnance).toHaveLength(1);
      expect(result.state.ordnance[0].type).toBe('nuke');
      const movedShip = must(result.state.ships.find((s) => s.id === ship.id));
      expect(movedShip.cargoUsed).toBe(ORDNANCE_MASS.nuke);
    }
  });
  it('allows nuke from non-warship with enough cargo', () => {
    const escState = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('NUK01'),
      findBaseHex,
    );
    const transport = escState.ships[0]; // transport
    transport.lifecycle = 'active';
    transport.position = { q: 15, r: 0 };
    transport.velocity = { dq: 1, dr: 0 };
    escState.phase = 'ordnance';
    const launches: OrdnanceLaunch[] = [
      {
        shipId: transport.id,
        ordnanceType: 'nuke',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
    ];
    const result = processOrdnance(escState, 0, launches, map, Math.random);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.state.ordnance[0].type).toBe('nuke');
  });
  it('rejects a second nuke launch from a non-warship without resupply', () => {
    const escState = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('NUK02'),
      findBaseHex,
    );
    const transport = escState.ships[0];
    transport.lifecycle = 'active';
    transport.velocity = { dq: 1, dr: 0 };
    escState.phase = 'ordnance';
    const first = processOrdnance(
      escState,
      0,
      [
        {
          shipId: transport.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      map,
      Math.random,
    );
    expect('error' in first).toBe(false);
    if ('error' in first) return;
    first.state.phase = 'ordnance';
    first.state.activePlayer = 0;
    const second = processOrdnance(
      first.state,
      0,
      [
        {
          shipId: transport.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      map,
      Math.random,
    );
    expect('error' in second).toBe(true);
    if ('error' in second) {
      expect(getErrorMessage(second.error)).toContain('one nuke');
    }
  });
  it('destroyed bases stay destroyed and stop defending', () => {
    const marsBase = must(findBaseHex(map, 'Mars'));
    const ship = initialState.ships[0];
    ship.type = 'frigate';
    ship.lifecycle = 'active';
    ship.position = { q: marsBase.q - 1, r: marsBase.r };
    ship.velocity = { dq: 1, dr: 0 };
    initialState.phase = 'ordnance';
    const result = processOrdnance(
      initialState,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'nuke',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const destroyedMarsBaseKey = result.state.destroyedBases.find(
      (key) => map.hexes.get(key)?.base?.bodyName === 'Mars',
    );
    expect(destroyedMarsBaseKey).toBeTruthy();
    if (!destroyedMarsBaseKey) return;
    const [dbq, dbr] = destroyedMarsBaseKey.split(',').map(Number);
    const destroyedMarsBase = { q: dbq, r: dbr };
    let gravHex: {
      q: number;
      r: number;
    } | null = null;
    for (const [key, hex] of map.hexes) {
      if (!hex.gravity || hex.gravity.bodyName !== 'Mars') continue;
      const [gq, gr] = key.split(',').map(Number);
      if (hexDistance({ q: gq, r: gr }, destroyedMarsBase) === 1) {
        gravHex = { q: gq, r: gr };
        break;
      }
    }
    expect(gravHex).not.toBeNull();
    if (!gravHex) return;
    const defenseResults = resolveBaseDefense(
      {
        ships: [
          {
            id: asShipId('enemy'),
            type: 'corvette',
            owner: 1,
            originalOwner: 1,
            position: gravHex,
            velocity: { dq: 0, dr: 0 },
            fuel: 20,
            cargoUsed: 0,
            lifecycle: 'active' as const,
            control: 'own' as const,
            heroismAvailable: false,
            overloadUsed: false,
            nukesLaunchedSinceResupply: 0,
            detected: true,
            resuppliedThisTurn: false,
            damage: { disabledTurns: 0 },
          },
        ],
        ordnance: [],
        destroyedBases: result.state.destroyedBases,
        players: [
          { bases: [destroyedMarsBaseKey] },
          { bases: [hexKey(must(findBaseHex(map, 'Venus')))] },
        ],
      },
      0,
      map,
      () => 0.99,
    );
    expect(defenseResults).toHaveLength(0);
  });
});
describe('ordnance validation', () => {
  it('rejects multiple launches from the same ship', () => {
    const ship = initialState.ships[0];
    ship.type = 'frigate';
    ship.lifecycle = 'active';
    ship.fuel = 20;
    initialState.phase = 'ordnance';
    initialState.pendingAstrogationOrders = [
      { shipId: ship.id, burn: 0, overload: null },
    ];
    const launches: OrdnanceLaunch[] = [
      {
        shipId: ship.id,
        ordnanceType: 'mine',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
      {
        shipId: ship.id,
        ordnanceType: 'mine',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
    ];
    const result = processOrdnance(initialState, 0, launches, map, Math.random);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('one ordnance per turn');
    }
  });
  it('rejects reusing the same attacker across combat declarations', () => {
    const fleetState = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('ATK01'),
      findBaseHex,
    );
    fleetState.phase = 'combat';
    fleetState.activePlayer = 0;
    const attacker = must(
      fleetState.ships.find((s) => s.owner === 0 && s.type === 'frigate'),
    );
    const ally = must(
      fleetState.ships.find((s) => s.owner === 0 && s.id !== attacker.id),
    );
    const enemyA = must(fleetState.ships.find((s) => s.owner === 1));
    const enemyB = must(fleetState.ships.filter((s) => s.owner === 1)[1]);
    attacker.lifecycle = 'active';
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    ally.lifecycle = 'active';
    ally.position = { q: 1, r: 0 };
    ally.lastMovementPath = [{ q: 1, r: 0 }];
    enemyA.lifecycle = 'active';
    enemyA.detected = true;
    enemyA.position = { q: 2, r: 0 };
    enemyA.lastMovementPath = [{ q: 2, r: 0 }];
    enemyB.lifecycle = 'active';
    enemyB.detected = true;
    enemyB.position = { q: 3, r: 0 };
    enemyB.lastMovementPath = [{ q: 3, r: 0 }];
    const result = processCombat(
      fleetState,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: enemyA.id,
          targetType: 'ship',
          attackStrength: null,
        },
        {
          attackerIds: [attacker.id, ally.id],
          targetId: enemyB.id,
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('only once');
    }
  });
  it('allows split fire against multiple ships in the same hex when total strength is allocated legally', () => {
    const fleetState = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('ATK01B'),
      findBaseHex,
    );
    fleetState.phase = 'combat';
    fleetState.activePlayer = 0;
    const attacker = must(
      fleetState.ships.find((s) => s.owner === 0 && s.type === 'frigate'),
    );
    const enemyShips = fleetState.ships.filter((s) => s.owner === 1);
    const [enemyA, enemyB] = enemyShips;
    attacker.lifecycle = 'active';
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    enemyA.lifecycle = 'active';
    enemyA.detected = true;
    enemyA.position = { q: 2, r: 0 };
    enemyA.lastMovementPath = [{ q: 2, r: 0 }];
    enemyB.lifecycle = 'active';
    enemyB.detected = true;
    enemyB.position = { q: 2, r: 0 };
    enemyB.lastMovementPath = [{ q: 2, r: 0 }];
    const result = processCombat(
      fleetState,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: enemyA.id,
          targetType: 'ship',
          attackStrength: 4,
        },
        {
          attackerIds: [attacker.id],
          targetId: enemyB.id,
          targetType: 'ship',
          attackStrength: 4,
        },
      ],
      openMap,
      () => 0.5,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.attackStrength === 4)).toBe(true);
  });
  it('rejects attacking the same target more than once per combat phase', () => {
    const fleetState = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('ATK02'),
      findBaseHex,
    );
    fleetState.phase = 'combat';
    fleetState.activePlayer = 1;
    // Use P1's corsairs (all combat-capable) as attackers
    const attackers = fleetState.ships.filter((s) => s.owner === 1);
    const enemies = fleetState.ships.filter((s) => s.owner === 0);
    for (const [idx, ship] of attackers.entries()) {
      ship.lifecycle = 'active';
      ship.position = { q: idx, r: 0 };
      ship.lastMovementPath = [{ ...ship.position }];
    }
    for (const [idx, ship] of enemies.entries()) {
      ship.lifecycle = 'active';
      ship.detected = true;
      ship.position = { q: idx + 1, r: 0 };
      ship.lastMovementPath = [{ ...ship.position }];
    }
    const result = processCombat(
      fleetState,
      1,
      [
        {
          attackerIds: [attackers[0].id],
          targetId: enemies[0].id,
          targetType: 'ship',
          attackStrength: null,
        },
        {
          attackerIds: [attackers[1].id],
          targetId: enemies[0].id,
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('attacked only once');
    }
  });
  it('rejects attacks without line of sight through a body', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('ATK03'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    const target = state.ships[1];
    attacker.lifecycle = 'active';
    target.lifecycle = 'active';
    target.detected = true;
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    target.position = { q: 2, r: 0 };
    target.lastMovementPath = [{ q: 2, r: 0 }];
    const losMap: SolarSystemMap = {
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
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: target.id,
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      losMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('line of sight');
    }
  });
  it('rejects landed ships as attackers', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('ATK04'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    const target = state.ships[1];
    attacker.lifecycle = 'landed';
    target.lifecycle = 'active';
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    target.position = { q: 1, r: 0 };
    target.lastMovementPath = [{ q: 1, r: 0 }];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: target.id,
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('Invalid attacker');
    }
  });
  it('rejects declared attack strength above the selected ships total', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('ATK04B'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    const target = state.ships[1];
    attacker.lifecycle = 'active';
    target.lifecycle = 'active';
    target.detected = true;
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    target.position = { q: 1, r: 0 };
    target.lastMovementPath = [{ q: 1, r: 0 }];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: target.id,
          targetType: 'ship',
          attackStrength: 3,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('attack strength');
    }
  });
  it('uses declared reduced attack strength in combat resolution', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('ATK04C'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    const target = state.ships[1];
    attacker.type = 'dreadnaught';
    attacker.lifecycle = 'active';
    target.lifecycle = 'active';
    target.detected = true;
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    target.position = { q: 0, r: 0 };
    target.lastMovementPath = [{ q: 0, r: 0 }];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: target.id,
          targetType: 'ship',
          attackStrength: 2,
        },
      ],
      openMap,
      () => 0.5,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.results[0].attackStrength).toBe(2);
    expect(result.results[0].odds).toBe('1:1');
  });
  it('allows combat attacks against enemy nukes', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('ATK05'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    attacker.lifecycle = 'active';
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    attacker.velocity = { dq: 0, dr: 0 };
    state.ordnance.push({
      id: asOrdnanceId('enemy-nuke'),
      type: 'nuke',
      owner: 1,
      sourceShipId: null,
      position: { q: 1, r: 0 },
      velocity: { dq: 0, dr: 0 },
      turnsRemaining: 5,
      lifecycle: 'active' as const,
      pendingGravityEffects: [],
    });
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: asOrdnanceId('enemy-nuke'),
          targetType: 'ordnance',
          attackStrength: null,
        },
      ],
      openMap,
      () => 0.8,
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].attackType).toBe('antiNuke');
    expect(result.results[0].targetType).toBe('ordnance');
    expect(result.results[0].damageType).toBe('eliminated');
    expect(
      result.state.ordnance.find((o) => o.id === 'enemy-nuke'),
    ).toBeUndefined();
  });
});
describe('mutual destruction', () => {
  it('awards win to defender when all ships destroyed simultaneously', () => {
    // Simulate mutual destruction: destroy all ships for both players
    for (const ship of initialState.ships) {
      ship.lifecycle = 'destroyed';
    }
    initialState.activePlayer = 0;
    initialState.phase = 'astrogation';
    // Run a no-op astrogation to trigger checkGameEnd
    const orders: AstrogationOrder[] = initialState.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: null, overload: null }));
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    if (!('error' in result)) {
      expect(result.state.phase).toBe('gameOver');
      // Defender (player 1) should win since active player (0) was the attacker
      expect(result.state.outcome?.winner).toBe(1);
      expect(result.state.outcome?.reason).toContain('Mutual destruction');
    }
  });
});
describe('Blockade Runner scenario', () => {
  let blockadeState: GameState;
  beforeEach(() => {
    blockadeState = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      asGameId('BLK01'),
      findBaseHex,
    );
  });
  it('creates 1 ship per player', () => {
    const p0Ships = blockadeState.ships.filter((s) => s.owner === 0);
    const p1Ships = blockadeState.ships.filter((s) => s.owner === 1);
    expect(p0Ships).toHaveLength(1);
    expect(p1Ships).toHaveLength(1);
  });
  it('runner is a packet ship', () => {
    const runner = must(blockadeState.ships.find((s) => s.owner === 0));
    expect(runner.type).toBe('packet');
  });
  it('blocker is a corvette', () => {
    const blocker = must(blockadeState.ships.find((s) => s.owner === 1));
    expect(blocker.type).toBe('corvette');
  });
  it('runner targets Mars', () => {
    expect(blockadeState.players[0].targetBody).toBe('Mars');
  });
  it('blocker starts unlanded in space', () => {
    const blocker = must(blockadeState.ships.find((s) => s.owner === 1));
    expect(blocker.lifecycle).toBe('active');
  });
});
describe('Fleet Action scenario', () => {
  let fleetState: GameState;
  beforeEach(() => {
    fleetState = createGameOrThrow(
      SCENARIOS.fleetAction,
      map,
      asGameId('FLT01'),
      findBaseHex,
    );
  });
  it('starts in fleet building phase with credits', () => {
    expect(fleetState.phase).toBe('fleetBuilding');
    expect(fleetState.players[0].credits).toBe(600);
    expect(fleetState.players[1].credits).toBe(400);
  });
  it('fleet 1 is based at Mars, fleet 2 at Venus', () => {
    expect(fleetState.players[0].homeBody).toBe('Mars');
    expect(fleetState.players[1].homeBody).toBe('Venus');
  });
  it('no target body — pure combat scenario', () => {
    expect(fleetState.players[0].targetBody).toBe('');
    expect(fleetState.players[1].targetBody).toBe('');
  });
});
describe('Edge cases', () => {
  it('no-burn orders for all ships produces valid movement', () => {
    const orders: AstrogationOrder[] = initialState.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: null, overload: null }));
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
  });
  it('skip ordnance when no ordnance exists', () => {
    initialState.phase = 'ordnance';
    const result = skipOrdnance(initialState, 0, map, Math.random);
    expect('error' in result).toBe(false);
  });
  it('skip combat when no enemies are nearby', () => {
    initialState.phase = 'combat';
    const result = skipCombat(initialState, 0, map, Math.random);
    expect('error' in result).toBe(false);
  });
  it('wrong player cannot submit orders', () => {
    // Player 0 is active, try submitting as player 1
    const orders: AstrogationOrder[] = initialState.ships
      .filter((s) => s.owner === 1)
      .map((s) => ({ shipId: s.id, burn: null, overload: null }));
    const result = processAstrogation(
      initialState,
      1,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(true);
  });
  it('destroyed ships are skipped in movement', () => {
    const ship = initialState.ships[0];
    ship.lifecycle = 'destroyed';
    const orders: AstrogationOrder[] = [];
    const result = processAstrogation(
      initialState,
      0,
      orders,
      map,
      Math.random,
    );
    expect('error' in result).toBe(false);
  });
  it('fleet action ends when one side is eliminated', () => {
    const fleetState = createGameOrThrow(
      SCENARIOS.fleetAction,
      map,
      asGameId('FLT02'),
      findBaseHex,
    );
    // Destroy all of player 1's ships
    for (const s of fleetState.ships.filter((s) => s.owner === 1)) {
      s.lifecycle = 'destroyed';
    }
    // Run a no-op astrogation to trigger checkGameEnd
    const orders: AstrogationOrder[] = fleetState.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: null, overload: null }));
    const result = processAstrogation(fleetState, 0, orders, map, Math.random);
    if (!('error' in result)) {
      expect(result.state.phase).toBe('gameOver');
      expect(result.state.outcome?.winner).toBe(0);
      expect(result.state.outcome?.reason).toBe('Fleet eliminated!');
    }
  });
  it('blockade runner wins by landing on Mars', () => {
    const blockadeState = createGameOrThrow(
      SCENARIOS.blockade,
      map,
      asGameId('BLK02'),
      findBaseHex,
    );
    blockadeState.activePlayer = 0;
    const runner = must(blockadeState.ships.find((s) => s.owner === 0));
    const marsBase = must(findBaseHex(map, 'Mars'));
    runner.position = { q: marsBase.q, r: marsBase.r + 1 };
    runner.velocity = { dq: 0, dr: -1 };
    runner.lifecycle = 'active';
    runner.pendingGravityEffects = [
      {
        hex: { q: marsBase.q, r: marsBase.r + 1 },
        direction: 3,
        bodyName: 'Mars',
        strength: 'full',
        ignored: false,
      },
    ];
    // Process a legal orbital landing burn.
    const orders: AstrogationOrder[] = blockadeState.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: 0, overload: null }));
    const result = resolveAstrogationMovement(blockadeState, 0, orders);
    expect(result.state.phase).toBe('gameOver');
    expect(result.state.outcome?.winner).toBe(0);
    expect(result.state.outcome?.reason).toContain('Mars');
  });
});
describe('landed ship immunity', () => {
  it('rejects gun combat attacks against landed ships', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('LAND01'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    const target = state.ships[1];
    attacker.lifecycle = 'active';
    target.lifecycle = 'landed';
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    target.position = { q: 1, r: 0 };
    target.lastMovementPath = [{ q: 1, r: 0 }];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: target.id,
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('Target not active');
    }
  });
  it('landed ships are immune to mines', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('LAND02'),
      findBaseHex,
    );
    state.activePlayer = 0;
    const target = state.ships[1];
    target.lifecycle = 'landed';
    target.position = { q: 5, r: 0 };
    target.lastMovementPath = [{ q: 5, r: 0 }];
    // Place a mine that will move through the landed ship's hex
    state.ordnance.push({
      id: asOrdnanceId('mine1'),
      type: 'mine',
      owner: 0,
      sourceShipId: null,
      position: { q: 4, r: 0 },
      velocity: { dq: 1, dr: 0 },
      turnsRemaining: 5,
      lifecycle: 'active' as const,
      pendingGravityEffects: [],
    });
    const attacker = state.ships[0];
    attacker.lifecycle = 'active';
    attacker.position = { q: -10, r: 0 };
    attacker.lastMovementPath = [{ q: -10, r: 0 }];
    attacker.velocity = { dq: 0, dr: 0 };
    resolveAstrogationMovement(state, 0, [
      { shipId: attacker.id, burn: null, overload: null },
    ]);
    // Mine should not have hit the landed ship
    expect(target.lifecycle).toBe('landed');
    expect(target.damage.disabledTurns).toBe(0);
  });
  it('landed ships are NOT immune to nukes', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('LAND03'),
      findBaseHex,
    );
    state.activePlayer = 0;
    const target = state.ships[1];
    target.lifecycle = 'landed';
    target.position = { q: 5, r: 0 };
    target.lastMovementPath = [{ q: 5, r: 0 }];
    // Place a nuke that will move through the landed ship's hex
    state.ordnance.push({
      id: asOrdnanceId('nuke1'),
      type: 'nuke',
      owner: 0,
      sourceShipId: null,
      position: { q: 4, r: 0 },
      velocity: { dq: 1, dr: 0 },
      turnsRemaining: 5,
      lifecycle: 'active' as const,
      pendingGravityEffects: [],
    });
    const attacker = state.ships[0];
    attacker.lifecycle = 'active';
    attacker.position = { q: -10, r: 0 };
    attacker.lastMovementPath = [{ q: -10, r: 0 }];
    attacker.velocity = { dq: 0, dr: 0 };
    const result = resolveAstrogationMovement(state, 0, [
      { shipId: attacker.id, burn: null, overload: null },
    ]);
    // Nuke should have destroyed the landed ship
    const updatedTarget = must(
      result.state.ships.find((s) => s.id === target.id),
    );
    expect(updatedTarget.lifecycle).toBe('destroyed');
  });
  it('landed ships are immune to ramming', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('LAND04'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    const target = state.ships[1];
    attacker.lifecycle = 'active';
    target.lifecycle = 'landed';
    // Place both ships on the same hex (simulates post-movement overlap)
    attacker.position = { q: 5, r: 0 };
    attacker.lastMovementPath = [
      { q: 4, r: 0 },
      { q: 5, r: 0 },
    ];
    attacker.velocity = { dq: 1, dr: 0 };
    target.position = { q: 5, r: 0 };
    target.lastMovementPath = [{ q: 5, r: 0 }];
    // Skip combat — ramming was already checked during movement
    // Instead, test directly: put them on the same hex and use resolveAstrogationMovement
    // Reset to astrogation phase to move the attacker through the target's hex
    state.phase = 'astrogation';
    attacker.position = { q: 4, r: 0 };
    attacker.lastMovementPath = [{ q: 4, r: 0 }];
    resolveAstrogationMovement(state, 0, [
      { shipId: attacker.id, burn: null, overload: null },
    ]);
    // Landed target should be immune to ramming
    expect(target.lifecycle).toBe('landed');
    expect(target.damage.disabledTurns).toBe(0);
    // Attacker also should not take ramming damage (ramming skipped entirely)
    expect(attacker.lifecycle).toBe('active');
  });
});
describe('resupply restrictions', () => {
  it('ships that resupply cannot attack in the same turn', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('RESUP01'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const attacker = state.ships[0];
    const target = state.ships[1];
    attacker.lifecycle = 'active';
    attacker.resuppliedThisTurn = true;
    target.lifecycle = 'active';
    attacker.position = { q: 0, r: 0 };
    attacker.lastMovementPath = [{ q: 0, r: 0 }];
    target.position = { q: 1, r: 0 };
    target.lastMovementPath = [{ q: 1, r: 0 }];
    const result = processCombat(
      state,
      0,
      [
        {
          attackerIds: [attacker.id],
          targetId: target.id,
          targetType: 'ship',
          attackStrength: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('Invalid attacker');
    }
  });
  it('ships that resupply cannot launch ordnance in the same turn', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('RESUP02'),
      findBaseHex,
    );
    state.phase = 'ordnance';
    state.activePlayer = 0;
    state.pendingAstrogationOrders = [];
    const ship = state.ships[0];
    ship.lifecycle = 'active';
    ship.resuppliedThisTurn = true;
    ship.position = { q: 0, r: 0 };
    const result = processOrdnance(
      state,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('resupply');
    }
  });
  it('resupply flag is cleared on next turn', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('RESUP03'),
      findBaseHex,
    );
    state.phase = 'combat';
    state.activePlayer = 0;
    const ship = state.ships[0];
    ship.resuppliedThisTurn = true;
    // Skip combat to advance turn
    const result = skipCombat(state, 0, openMap, Math.random);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const updated = must(result.state.ships.find((s) => s.id === ship.id));
      expect(updated.resuppliedThisTurn).toBe(false);
    }
  });
});
describe('mine launch restrictions', () => {
  it('rejects mine launch when ship has no burn committed', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('MINE01'),
      findBaseHex,
    );
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = state.ships[0];
    ship.type = 'frigate'; // cargo 40, enough for mine mass 10
    ship.lifecycle = 'active';
    ship.position = { q: 0, r: 0 };
    ship.velocity = { dq: 1, dr: 0 };
    // Pending orders with no burn
    state.pendingAstrogationOrders = [
      { shipId: ship.id, burn: null, overload: null },
    ];
    const result = processOrdnance(
      state,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('change course');
    }
  });
  it('allows mine launch when ship has a burn committed', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      openMap,
      asGameId('MINE02'),
      findBaseHex,
    );
    state.phase = 'ordnance';
    state.activePlayer = 0;
    const ship = state.ships[0];
    ship.type = 'frigate'; // cargo 40, enough for mine mass 10
    ship.lifecycle = 'active';
    ship.position = { q: 0, r: 0 };
    ship.velocity = { dq: 1, dr: 0 };
    state.pendingAstrogationOrders = [
      { shipId: ship.id, burn: 2, overload: null },
    ];
    const result = processOrdnance(
      state,
      0,
      [
        {
          shipId: ship.id,
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(false);
  });
});
describe('nuke planetary devastation', () => {
  it('nuke reaching a planet devastates the entry hex side', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('NUKE01'),
      findBaseHex,
    );
    state.activePlayer = 0;
    // Find Mercury's center and a gravity hex next to it
    const mercuryCenter = map.bodies.find((b) => b.name === 'Mercury')?.center;
    // Mercury is a single-hex body with 1 gravity ring — find a gravity hex
    let gravHex: {
      q: number;
      r: number;
    } | null = null;
    for (const [key, hex] of map.hexes) {
      if (hex.gravity?.bodyName === 'Mercury') {
        const [q, r] = key.split(',').map(Number);
        gravHex = { q, r };
        break;
      }
    }
    expect(gravHex).not.toBeNull();
    // Place a nuke heading toward Mercury body from the gravity hex
    const vel = {
      dq: must(mercuryCenter).q - must(gravHex).q,
      dr: must(mercuryCenter).r - must(gravHex).r,
    };
    state.ordnance.push({
      id: asOrdnanceId('nuke-planet'),
      type: 'nuke',
      owner: 0,
      sourceShipId: null,
      position: { ...must(gravHex) },
      velocity: vel,
      turnsRemaining: 5,
      lifecycle: 'active' as const,
      pendingGravityEffects: [],
    });
    // Place a ship on the gravity hex (it should be destroyed by devastation)
    const victim = state.ships[1];
    victim.lifecycle = 'active';
    victim.position = { ...must(gravHex) };
    victim.lastMovementPath = [{ ...must(gravHex) }];
    victim.velocity = { dq: 0, dr: 0 };
    // Place player 0's ship far away
    const attacker = state.ships[0];
    attacker.lifecycle = 'active';
    attacker.position = { q: -30, r: -30 };
    attacker.lastMovementPath = [{ q: -30, r: -30 }];
    attacker.velocity = { dq: 0, dr: 0 };
    const result = resolveAstrogationMovement(state, 0, [
      { shipId: attacker.id, burn: null, overload: null },
    ]);
    // The nuke should have devastated the gravity hex, destroying the victim
    const updatedVictim = must(
      result.state.ships.find((s) => s.id === victim.id),
    );
    expect(updatedVictim.lifecycle).toBe('destroyed');
    // And any base on that hex should be destroyed
    const gravKey = hexKey(must(gravHex));
    if (map.hexes.get(gravKey)?.base) {
      expect(result.state.destroyedBases).toContain(gravKey);
    }
  });
});
describe('hidden identity (Escape scenario)', () => {
  it('assigns fugitives to exactly one ship in hidden-identity scenarios', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST1'),
      findBaseHex,
    );
    const fugitiveShips = state.ships.filter((s) => s.identity?.hasFugitives);
    expect(fugitiveShips).toHaveLength(1);
    // Must be a player 0 (pilgrim) ship
    expect(fugitiveShips[0].owner).toBe(0);
  });
  it('does not assign fugitives in non-hidden-identity scenarios', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('TEST1'),
      findBaseHex,
    );
    const fugitiveShips = state.ships.filter((s) => s.identity?.hasFugitives);
    expect(fugitiveShips).toHaveLength(0);
  });
  it('reveals a hidden transport after an enforcer matches course with it', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST1'),
      findBaseHex,
    );
    const fugitive = must(state.ships.find((s) => s.identity?.hasFugitives));
    const inspector = must(state.ships.find((s) => s.owner === 1));
    fugitive.lifecycle = 'active';
    fugitive.position = { q: 0, r: 0 };
    fugitive.velocity = { dq: 0, dr: 0 };
    if (fugitive.identity) fugitive.identity.revealed = false;
    inspector.position = { q: 0, r: 0 };
    inspector.velocity = { dq: 0, dr: 0 };
    inspector.lifecycle = 'active';
    state.activePlayer = 1;
    const result = resolveAstrogationMovement(
      state,
      1,
      state.ships
        .filter((s) => s.owner === 1)
        .map((s) => ({ shipId: s.id, burn: null, overload: null })),
    );
    const updatedFugitive = must(
      result.state.ships.find((s) => s.id === fugitive.id),
    );
    expect(updatedFugitive.identity?.revealed).toBe(true);
  });
  it('fugitive ship escape triggers victory', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST1'),
      findBaseHex,
    );
    const fugitive = must(state.ships.find((s) => s.identity?.hasFugitives));
    fugitive.lifecycle = 'active';
    fugitive.position = { q: 0, r: map.bounds.minR - 5 };
    fugitive.velocity = { dq: 0, dr: -2 };
    state.activePlayer = 0;
    const orders = state.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: null, overload: null }));
    const result = processAstrogation(state, 0, orders, map, Math.random);
    if ('error' in result) throw new Error(getErrorMessage(result.error));
    expect(result.state.outcome?.winner).toBe(0);
    expect(result.state.outcome?.reason).toContain('escaped beyond Jupiter');
  });
  it('non-fugitive ship escape does not trigger victory', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST1'),
      findBaseHex,
    );
    const nonFugitive = must(
      state.ships.find((s) => s.owner === 0 && !s.identity?.hasFugitives),
    );
    nonFugitive.lifecycle = 'active';
    nonFugitive.position = { q: 0, r: map.bounds.minR - 5 };
    nonFugitive.velocity = { dq: 0, dr: -2 };
    state.activePlayer = 0;
    const orders = state.ships
      .filter((s) => s.owner === 0)
      .map((s) => ({ shipId: s.id, burn: null, overload: null }));
    const result = processAstrogation(state, 0, orders, map, Math.random);
    if ('error' in result) throw new Error(getErrorMessage(result.error));
    // Should not win -- the fugitive ship hasn't escaped
    expect(result.state.outcome).toBeNull();
  });
  it('destroying the fugitive ship triggers opponent victory', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST1'),
      findBaseHex,
    );
    const fugitive = must(state.ships.find((s) => s.identity?.hasFugitives));
    fugitive.lifecycle = 'destroyed';
    state.phase = 'combat';
    state.activePlayer = 1;
    const result = skipCombat(state, 1, map, Math.random);
    if ('error' in result) throw new Error(getErrorMessage(result.error));
    expect(result.state.outcome?.winner).toBe(1);
    expect(result.state.outcome?.reason).toContain('fugitive transport');
  });
  it('returning a captured fugitive transport to base gives the enforcers a decisive victory', () => {
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('TEST1'),
      findBaseHex,
    );
    const fugitive = must(state.ships.find((s) => s.identity?.hasFugitives));
    const enforcerBase = must(state.players[1].bases[0]);
    const [q, r] = enforcerBase.split(',').map(Number);
    fugitive.owner = 1;
    fugitive.control = 'captured';
    fugitive.lifecycle = 'landed';
    fugitive.position = { q, r };
    state.phase = 'combat';
    state.activePlayer = 1;
    const result = skipCombat(state, 1, map, Math.random);
    if ('error' in result) throw new Error(getErrorMessage(result.error));
    expect(result.state.outcome?.winner).toBe(1);
    expect(result.state.outcome?.reason).toContain('returned to base');
  });
});
describe('capture mechanics', () => {
  it('captures a disabled enemy ship when matching position and velocity', () => {
    const state: GameState = {
      gameId: asGameId('TEST'),
      scenario: 'duel',
      scenarioRules: {},
      escapeMoralVictoryAchieved: false,
      turnNumber: 1,
      phase: 'astrogation',
      activePlayer: 0,
      ships: [
        {
          id: asShipId('captor'),
          type: 'corvette',
          owner: 0,
          originalOwner: 0,
          position: { q: 5, r: 0 },
          velocity: { dq: 1, dr: 0 },
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
          pendingGravityEffects: [],
        },
        {
          id: asShipId('target'),
          type: 'corvette',
          owner: 1,
          originalOwner: 1,
          position: { q: 6, r: 0 },
          velocity: { dq: 1, dr: 0 },
          fuel: 20,
          cargoUsed: 0,
          resuppliedThisTurn: false,
          lifecycle: 'active' as const,
          control: 'own' as const,
          heroismAvailable: false,
          overloadUsed: false,
          nukesLaunchedSinceResupply: 0,
          detected: true,
          damage: { disabledTurns: 3 },
          pendingGravityEffects: [],
        },
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
      outcome: null,
    };
    // Only active player's ships move. Captor at (4,0) vel (1,0) → ends at (5,0) vel (1,0).
    // Target already at (5,0) vel (1,0) — doesn't move during opponent's turn.
    state.ships[0].position = { q: 4, r: 0 };
    state.ships[0].velocity = { dq: 1, dr: 0 };
    state.ships[1].position = { q: 5, r: 0 };
    state.ships[1].velocity = { dq: 1, dr: 0 };
    const result = processAstrogation(
      state,
      0,
      [{ shipId: asShipId('captor'), burn: null, overload: null }],
      openMap,
      Math.random,
    );
    if ('error' in result) throw new Error(getErrorMessage(result.error));
    const mr = 'movements' in result ? result : null;
    expect(mr).not.toBeNull();
    const target = must(result.state.ships.find((s) => s.id === 'target'));
    expect(target.control).toBe('captured');
    expect(target.owner).toBe(0); // ownership transferred
    // Check capture event
    if (mr) {
      const captureEvent = mr.events.find((e) => e.type === 'capture');
      expect(captureEvent).toBeDefined();
      expect(captureEvent?.shipId).toBe('target');
      expect(captureEvent?.capturedBy).toBe('captor');
    }
  });
  it('does not capture a non-disabled ship', () => {
    const state: GameState = {
      gameId: asGameId('TEST'),
      scenario: 'duel',
      scenarioRules: {},
      escapeMoralVictoryAchieved: false,
      turnNumber: 1,
      phase: 'astrogation',
      activePlayer: 0,
      ships: [
        {
          id: asShipId('captor'),
          type: 'corvette',
          owner: 0,
          originalOwner: 0,
          position: { q: 5, r: 0 },
          velocity: { dq: 1, dr: 0 },
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
          pendingGravityEffects: [],
        },
        {
          id: asShipId('target'),
          type: 'corvette',
          owner: 1,
          originalOwner: 1,
          position: { q: 5, r: 0 },
          velocity: { dq: 1, dr: 0 },
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
          pendingGravityEffects: [],
        },
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
      outcome: null,
    };
    const result = processAstrogation(
      state,
      0,
      [{ shipId: asShipId('captor'), burn: null, overload: null }],
      openMap,
      Math.random,
    );
    if ('error' in result) throw new Error(getErrorMessage(result.error));
    const target = must(result.state.ships.find((s) => s.id === 'target'));
    expect(target.control).toBe('own');
    expect(target.owner).toBe(1); // unchanged
  });
  it('does not capture with mismatched velocity', () => {
    const state: GameState = {
      gameId: asGameId('TEST'),
      scenario: 'duel',
      scenarioRules: {},
      escapeMoralVictoryAchieved: false,
      turnNumber: 1,
      phase: 'astrogation',
      activePlayer: 0,
      ships: [
        {
          id: asShipId('captor'),
          type: 'corvette',
          owner: 0,
          originalOwner: 0,
          position: { q: 5, r: 0 },
          velocity: { dq: 1, dr: 0 },
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
          pendingGravityEffects: [],
        },
        {
          id: asShipId('target'),
          type: 'corvette',
          owner: 1,
          originalOwner: 1,
          position: { q: 5, r: 0 },
          velocity: { dq: 2, dr: 0 },
          fuel: 20,
          cargoUsed: 0,
          resuppliedThisTurn: false,
          lifecycle: 'active' as const,
          control: 'own' as const,
          heroismAvailable: false,
          overloadUsed: false,
          nukesLaunchedSinceResupply: 0,
          detected: true,
          damage: { disabledTurns: 3 },
          pendingGravityEffects: [],
        },
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
      outcome: null,
    };
    const result = processAstrogation(
      state,
      0,
      [{ shipId: asShipId('captor'), burn: null, overload: null }],
      openMap,
      Math.random,
    );
    if ('error' in result) throw new Error(getErrorMessage(result.error));
    const target = must(result.state.ships.find((s) => s.id === 'target'));
    expect(target.control).toBe('own');
    expect(target.owner).toBe(1);
  });
  it('captured ships cannot receive astrogation orders', () => {
    const state = createGameOrThrow(
      SCENARIOS.biplanetary,
      map,
      asGameId('CAPT_ASTRO'),
      findBaseHex,
    );
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.control = 'captured';
    state.phase = 'astrogation';
    state.activePlayer = 0;
    const result = processAstrogation(
      state,
      0,
      [{ shipId: ship.id, burn: 1, overload: null }],
      map,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('cannot receive');
    }
  });
  it('captured ships cannot launch ordnance', () => {
    const state: GameState = {
      gameId: asGameId('TEST'),
      scenario: 'duel',
      scenarioRules: {},
      escapeMoralVictoryAchieved: false,
      turnNumber: 1,
      phase: 'ordnance',
      activePlayer: 0,
      ships: [
        {
          id: asShipId('captured'),
          type: 'corvette',
          owner: 0,
          originalOwner: 1,
          position: { q: 5, r: 0 },
          velocity: { dq: 1, dr: 0 },
          fuel: 20,
          cargoUsed: 0,
          resuppliedThisTurn: false,
          lifecycle: 'active' as const,
          control: 'captured' as const,
          heroismAvailable: false,
          overloadUsed: false,
          nukesLaunchedSinceResupply: 0,
          detected: true,
          damage: { disabledTurns: 0 },
          pendingGravityEffects: [],
        },
      ],
      ordnance: [],
      pendingAstrogationOrders: [
        { shipId: asShipId('captured'), burn: null, overload: null },
      ],
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
      outcome: null,
    };
    const result = processOrdnance(
      state,
      0,
      [
        {
          shipId: asShipId('captured'),
          ordnanceType: 'mine',
          torpedoAccel: null,
          torpedoAccelSteps: null,
        },
      ],
      openMap,
      Math.random,
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(getErrorMessage(result.error)).toContain('Captured');
    }
  });
});
// Fleet building tests moved to fleet-building.test.ts
describe('Grand Tour', () => {
  let tourState: GameState;
  beforeEach(() => {
    tourState = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('TOUR1'),
      findBaseHex,
    );
  });
  it('initializes checkpoint tracking', () => {
    expect(tourState.scenarioRules.checkpointBodies).toEqual([
      'Sol',
      'Mercury',
      'Venus',
      'Terra',
      'Mars',
      'Jupiter',
      'Io',
      'Callisto',
    ]);
    expect(tourState.scenarioRules.combatDisabled).toBe(true);
    expect(tourState.players[0].visitedBodies).toBeDefined();
    expect(tourState.players[0].totalFuelSpent).toBe(0);
    expect(tourState.players[1].visitedBodies).toBeDefined();
    expect(tourState.players[1].totalFuelSpent).toBe(0);
  });
  it('pre-marks starting body as visited', () => {
    // Player 0 starts at Luna, Player 1 at Mars
    expect(tourState.players[0].visitedBodies).toContain('Luna');
    expect(tourState.players[1].visitedBodies).toContain('Mars');
  });
  it('gives both players shared bases for fuel', () => {
    const terraBaseKeys = findBaseHexes(map, 'Terra').map((h) => hexKey(h));
    const venusBaseKeys = findBaseHexes(map, 'Venus').map((h) => hexKey(h));
    const marsBaseKeys = findBaseHexes(map, 'Mars').map((h) => hexKey(h));
    const callistoBaseKeys = findBaseHexes(map, 'Callisto').map((h) =>
      hexKey(h),
    );
    for (const key of [
      ...terraBaseKeys,
      ...venusBaseKeys,
      ...marsBaseKeys,
      ...callistoBaseKeys,
    ]) {
      expect(tourState.players[0].bases).toContain(key);
      expect(tourState.players[1].bases).toContain(key);
    }
  });
  it('updates checkpoints when path crosses gravity hexes', () => {
    const mercuryGravityHex = [...map.hexes.entries()].find(
      ([, hex]) => hex.gravity?.bodyName === 'Mercury',
    );
    expect(mercuryGravityHex).toBeDefined();
    const [keyStr] = must(mercuryGravityHex);
    const [q, r] = keyStr.split(',').map(Number);
    applyCheckpoints(tourState, 0, [{ q, r }], map);
    expect(tourState.players[0].visitedBodies).toContain('Mercury');
    expect(tourState.players[1].visitedBodies).not.toContain('Mercury');
  });
  it('does not duplicate visited bodies', () => {
    const mercuryGravityHex = [...map.hexes.entries()].find(
      ([, hex]) => hex.gravity?.bodyName === 'Mercury',
    );
    const [keyStr] = must(mercuryGravityHex);
    const [q, r] = keyStr.split(',').map(Number);
    applyCheckpoints(tourState, 0, [{ q, r }], map);
    applyCheckpoints(tourState, 0, [{ q, r }], map);
    const count = tourState.players[0].visitedBodies?.filter(
      (b) => b === 'Mercury',
    ).length;
    expect(count).toBe(1);
  });
  it('wins when all checkpoints visited and landed at home', () => {
    // Mark all checkpoints as visited for player 0
    tourState.players[0].visitedBodies = [
      ...must(tourState.scenarioRules.checkpointBodies),
    ];
    // Land the ship at a Luna base
    const ship = must(tourState.ships.find((s) => s.owner === 0));
    const homeBase = findBaseHexes(map, 'Luna')[0];
    ship.position = homeBase;
    ship.lifecycle = 'landed';
    checkImmediateVictory(tourState, map);
    expect(tourState.outcome?.winner).toBe(0);
    expect(tourState.outcome?.reason).toContain('Grand Tour complete');
  });
  it('does not win with incomplete checkpoints', () => {
    tourState.players[0].visitedBodies = ['Luna', 'Mercury', 'Venus'];
    const ship = must(tourState.ships.find((s) => s.owner === 0));
    const homeBase = findBaseHexes(map, 'Luna')[0];
    ship.position = homeBase;
    ship.lifecycle = 'landed';
    checkImmediateVictory(tourState, map);
    expect(tourState.outcome).toBeNull();
  });
  it('does not win at wrong home body', () => {
    tourState.players[0].visitedBodies = [
      ...must(tourState.scenarioRules.checkpointBodies),
    ];
    const ship = must(tourState.ships.find((s) => s.owner === 0));
    const marsBase = findBaseHexes(map, 'Mars')[0];
    ship.position = marsBase;
    ship.lifecycle = 'landed';
    checkImmediateVictory(tourState, map);
    expect(tourState.outcome).toBeNull();
  });
  it('skips combat phase when combatDisabled', () => {
    const ship0 = must(tourState.ships.find((s) => s.owner === 0));
    const ship1 = must(tourState.ships.find((s) => s.owner === 1));
    ship0.position = { q: 0, r: 0 };
    ship0.lifecycle = 'active';
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.position = { q: 1, r: 0 };
    ship1.lifecycle = 'active';
    ship1.velocity = { dq: 0, dr: 0 };
    processAstrogation(
      tourState,
      0,
      [{ shipId: ship0.id, burn: null, overload: null }],
      map,
      Math.random,
    );
    expect(tourState.phase).not.toBe('combat');
  });
  it('tracks fuel consumption', () => {
    const ship = must(tourState.ships.find((s) => s.owner === 0));
    ship.lifecycle = 'active';
    ship.velocity = { dq: 0, dr: 0 };
    tourState.phase = 'astrogation';
    tourState.activePlayer = 0;
    const initialFuel = tourState.players[0].totalFuelSpent;
    const result = resolveAstrogationMovement(tourState, 0, [
      { shipId: ship.id, burn: 0, overload: null },
    ]);
    expect(result.state.players[0].totalFuelSpent).toBe(must(initialFuel) + 1);
  });
});
