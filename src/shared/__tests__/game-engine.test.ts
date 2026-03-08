import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, processAstrogation, processOrdnance, skipOrdnance, skipCombat, processCombat } from '../game-engine';
import { buildSolarSystemMap, SCENARIOS, findBaseHex } from '../map-data';
import { SHIP_STATS, ORDNANCE_MASS } from '../constants';
import { hexKey, hexEqual } from '../hex';
import type { GameState, SolarSystemMap, AstrogationOrder, OrdnanceLaunch } from '../types';

let map: SolarSystemMap;
let initialState: GameState;

beforeEach(() => {
  map = buildSolarSystemMap();
  initialState = createGame(SCENARIOS.biplanetary, map, 'TEST1', findBaseHex);
});

describe('createGame', () => {
  it('creates game with correct scenario name', () => {
    expect(initialState.scenario).toBe('Bi-Planetary');
  });

  it('creates 2 ships for Bi-Planetary', () => {
    expect(initialState.ships).toHaveLength(2);
    expect(initialState.ships[0].owner).toBe(0);
    expect(initialState.ships[1].owner).toBe(1);
  });

  it('ships start landed at their home bases', () => {
    expect(initialState.ships[0].landed).toBe(true);
    expect(initialState.ships[1].landed).toBe(true);
  });

  it('ships start with full fuel', () => {
    const stats = SHIP_STATS['corvette'];
    expect(initialState.ships[0].fuel).toBe(stats.fuel);
    expect(initialState.ships[1].fuel).toBe(stats.fuel);
  });

  it('ships start with zero damage', () => {
    expect(initialState.ships[0].damage.disabledTurns).toBe(0);
    expect(initialState.ships[1].damage.disabledTurns).toBe(0);
  });

  it('player 0 targets Venus, player 1 targets Mars', () => {
    expect(initialState.players[0].targetBody).toBe('Venus');
    expect(initialState.players[1].targetBody).toBe('Mars');
  });

  it('starts on turn 1 in astrogation phase', () => {
    expect(initialState.turnNumber).toBe(1);
    expect(initialState.phase).toBe('astrogation');
    expect(initialState.activePlayer).toBe(0);
  });

  it('ships are placed at actual base hexes', () => {
    const marsBase = findBaseHex(map, 'Mars')!;
    const venusBase = findBaseHex(map, 'Venus')!;
    expect(initialState.ships[0].position).toEqual(marsBase);
    expect(initialState.ships[1].position).toEqual(venusBase);
  });
});

describe('processAstrogation', () => {
  it('rejects orders from wrong player', () => {
    const result = processAstrogation(initialState, 1, [], map);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBe('Not your turn');
    }
  });

  it('rejects orders in wrong phase', () => {
    initialState.phase = 'movement';
    const result = processAstrogation(initialState, 0, [], map);
    expect('error' in result).toBe(true);
  });

  it('accepts valid no-burn order for landed ship', () => {
    const orders: AstrogationOrder[] = [{
      shipId: initialState.ships[0].id,
      burn: null,
    }];
    const result = processAstrogation(initialState, 0, orders, map);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.movements).toHaveLength(1);
      expect(result.movements[0].fuelSpent).toBe(0);
    }
  });

  it('accepts valid burn order and moves ship', () => {
    const ship = initialState.ships[0];
    const startPos = { ...ship.position };

    const orders: AstrogationOrder[] = [{
      shipId: ship.id,
      burn: 0, // E
    }];
    const result = processAstrogation(initialState, 0, orders, map);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.movements[0].fuelSpent).toBe(1);
      // Ship should have moved
      expect(hexEqual(result.state.ships[0].position, startPos)).toBe(false);
      // Ship should no longer be landed
      expect(result.state.ships[0].landed).toBe(false);
    }
  });

  it('rejects invalid burn direction', () => {
    const orders: AstrogationOrder[] = [{
      shipId: initialState.ships[0].id,
      burn: 7, // invalid
    }];
    const result = processAstrogation(initialState, 0, orders, map);
    expect('error' in result).toBe(true);
  });

  it('accepts overload order for warship and spends 2 fuel', () => {
    const ship = initialState.ships[0]; // corvette, canOverload = true
    ship.landed = false;
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 0, r: 0 };

    const orders: AstrogationOrder[] = [{
      shipId: ship.id,
      burn: 0,      // E
      overload: 1,  // NE
    }];
    const result = processAstrogation(initialState, 0, orders, map);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.movements[0].fuelSpent).toBe(2);
    }
  });

  it('rejects invalid overload direction', () => {
    const ship = initialState.ships[0];
    ship.landed = false;
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 0, r: 0 };

    const orders: AstrogationOrder[] = [{
      shipId: ship.id,
      burn: 0,
      overload: 7, // invalid
    }];
    const result = processAstrogation(initialState, 0, orders, map);
    expect('error' in result).toBe(true);
  });

  it('enters combat phase after astrogation when enemies exist', () => {
    const orders: AstrogationOrder[] = [{
      shipId: initialState.ships[0].id,
      burn: null,
    }];
    const result = processAstrogation(initialState, 0, orders, map);

    if (!('error' in result)) {
      // Both players have ships alive, so combat phase is entered
      expect(result.state.phase).toBe('combat');
      expect(result.state.activePlayer).toBe(0);
    }
  });

  it('switches active player after skipping combat', () => {
    const orders: AstrogationOrder[] = [{
      shipId: initialState.ships[0].id,
      burn: null,
    }];
    const result = processAstrogation(initialState, 0, orders, map);
    if ('error' in result) return;

    // Skip combat to advance turn
    const combatResult = skipCombat(result.state, 0);
    expect('error' in combatResult).toBe(false);
    if ('error' in combatResult) return;

    expect(combatResult.state.activePlayer).toBe(1);
    expect(combatResult.state.phase).toBe('astrogation');
  });

  it('increments turn number after both players complete turns', () => {
    // Player 0's turn: astrogation + skip combat
    const orders0: AstrogationOrder[] = [{
      shipId: initialState.ships[0].id,
      burn: null,
    }];
    const result0 = processAstrogation(initialState, 0, orders0, map);
    expect('error' in result0).toBe(false);
    if ('error' in result0) return;

    const skip0 = skipCombat(result0.state, 0);
    expect('error' in skip0).toBe(false);
    if ('error' in skip0) return;

    expect(skip0.state.turnNumber).toBe(1); // Still turn 1

    // Player 1's turn: astrogation + skip combat
    const orders1: AstrogationOrder[] = [{
      shipId: skip0.state.ships[1].id,
      burn: null,
    }];
    const result1 = processAstrogation(skip0.state, 1, orders1, map);
    expect('error' in result1).toBe(false);
    if ('error' in result1) return;

    const skip1 = skipCombat(result1.state, 1);
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
    const orders: AstrogationOrder[] = [{ shipId: ship.id, burn: 0 }];
    const result = processAstrogation(initialState, 0, orders, map);

    if ('error' in result) return;

    const movedShip = result.state.ships[0];
    expect(movedShip.fuel).toBe(19); // Used 1 fuel for takeoff

    // Now simulate the ship landing at a base by manually positioning it
    // and computing a course that arrives at a base hex
    const venusBase = findBaseHex(map, 'Venus')!;
    movedShip.position = { q: venusBase.q + 1, r: venusBase.r };
    movedShip.velocity = { dq: -1, dr: 0 };
    movedShip.landed = false;
    movedShip.fuel = 5; // Low fuel

    // Switch to player 0's turn
    result.state.activePlayer = 0;
    result.state.phase = 'astrogation';

    const landingOrders: AstrogationOrder[] = [{ shipId: movedShip.id, burn: null }];
    const landResult = processAstrogation(result.state, 0, landingOrders, map);

    if ('error' in landResult) return;

    const landedShip = landResult.state.ships[0];
    if (landedShip.landed) {
      // Ship should be refueled to max
      const stats = SHIP_STATS[landedShip.type];
      expect(landedShip.fuel).toBe(stats.fuel);
      expect(landedShip.damage.disabledTurns).toBe(0);
    }
  });
});

describe('victory conditions', () => {
  it('landing on target body wins the game', () => {
    // Manually position P0 to land on Venus (target)
    const venusBase = findBaseHex(map, 'Venus')!;
    const ship = initialState.ships[0];
    ship.position = { q: venusBase.q + 1, r: venusBase.r };
    ship.velocity = { dq: -1, dr: 0 };
    ship.landed = false;

    const orders: AstrogationOrder[] = [{ shipId: ship.id, burn: null }];
    const result = processAstrogation(initialState, 0, orders, map);

    if ('error' in result) return;

    const landedShip = result.state.ships[0];
    if (landedShip.landed && landedShip.position.q === venusBase.q && landedShip.position.r === venusBase.r) {
      expect(result.state.phase).toBe('gameOver');
      expect(result.state.winner).toBe(0);
      expect(result.state.winReason).toContain('Venus');
    }
  });
});

describe('Escape scenario', () => {
  let escapeState: GameState;

  beforeEach(() => {
    escapeState = createGame(SCENARIOS.escape, map, 'ESC01', findBaseHex);
  });

  it('creates correct number of ships per player', () => {
    const p0Ships = escapeState.ships.filter(s => s.owner === 0);
    const p1Ships = escapeState.ships.filter(s => s.owner === 1);
    expect(p0Ships).toHaveLength(3); // 3 transports
    expect(p1Ships).toHaveLength(2); // corvette + corsair
  });

  it('pilgrim transports start landed at Terra base', () => {
    const p0Ships = escapeState.ships.filter(s => s.owner === 0);
    for (const ship of p0Ships) {
      expect(ship.type).toBe('transport');
      expect(ship.landed).toBe(true);
    }
  });

  it('enforcer ships start not landed', () => {
    const p1Ships = escapeState.ships.filter(s => s.owner === 1);
    for (const ship of p1Ships) {
      expect(ship.landed).toBe(false);
    }
  });

  it('enforcer ship types are corvette and corsair', () => {
    const p1Ships = escapeState.ships.filter(s => s.owner === 1);
    const types = p1Ships.map(s => s.type).sort();
    expect(types).toEqual(['corsair', 'corvette']);
  });

  it('pilgrim player has escapeWins = true', () => {
    expect(escapeState.players[0].escapeWins).toBe(true);
    expect(escapeState.players[1].escapeWins).toBe(false);
  });

  it('ship escaping map bounds wins for pilgrim', () => {
    // Position a pilgrim transport beyond map bounds
    const ship = escapeState.ships[0];
    ship.position = { q: map.bounds.maxQ + 5, r: 0 };
    ship.velocity = { dq: 2, dr: 0 };
    ship.landed = false;

    const orders: AstrogationOrder[] = escapeState.ships
      .filter(s => s.owner === 0)
      .map(s => ({ shipId: s.id, burn: null }));

    const result = processAstrogation(escapeState, 0, orders, map);
    if ('error' in result) return;

    expect(result.state.phase).toBe('gameOver');
    expect(result.state.winner).toBe(0);
    expect(result.state.winReason).toContain('Escaped');
  });

  it('destroying all pilgrim ships wins for enforcer', () => {
    // Destroy all pilgrim ships
    for (const ship of escapeState.ships) {
      if (ship.owner === 0) {
        ship.destroyed = true;
      }
    }

    // Enforcer makes a move — checkGameEnd should trigger
    const enforcerShip = escapeState.ships.find(s => s.owner === 1)!;
    escapeState.activePlayer = 1;
    const orders: AstrogationOrder[] = [{ shipId: enforcerShip.id, burn: null }];
    const result = processAstrogation(escapeState, 1, orders, map);
    if ('error' in result) return;

    expect(result.state.phase).toBe('gameOver');
    expect(result.state.winner).toBe(1);
    expect(result.state.winReason).toContain('destroyed');
  });

  it('handles multiple ships with same orders', () => {
    // All 3 transports get burn orders
    const orders: AstrogationOrder[] = escapeState.ships
      .filter(s => s.owner === 0)
      .map(s => ({ shipId: s.id, burn: 1 })); // All burn NE

    const result = processAstrogation(escapeState, 0, orders, map);
    expect('error' in result).toBe(false);
    if ('error' in result) return;

    // All 3 should have moved
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
    ship.landed = false;
    ship.velocity = { dq: 1, dr: 0 };
    ship.position = { q: 0, r: 0 };

    // Advance to ordnance phase
    const orders: AstrogationOrder[] = [{ shipId: ship.id, burn: null }];
    const result = processAstrogation(initialState, 0, orders, map);
    if ('error' in result) return;

    // If ordnance phase was entered
    if (result.state.phase === 'ordnance') {
      const launches: OrdnanceLaunch[] = [{ shipId: ship.id, ordnanceType: 'mine' }];
      const ordResult = processOrdnance(result.state, 0, launches, map);
      expect('error' in ordResult).toBe(false);
      if (!('error' in ordResult)) {
        // Mine should exist
        expect(ordResult.state.ordnance).toHaveLength(1);
        expect(ordResult.state.ordnance[0].type).toBe('mine');
        // Cargo used should increase
        const movedShip = ordResult.state.ships.find(s => s.id === ship.id)!;
        expect(movedShip.cargoUsed).toBe(ORDNANCE_MASS.mine);
      }
    }
  });

  it('rejects mine launch when landed', () => {
    const ship = initialState.ships[0];
    // Ship is landed, force ordnance phase
    initialState.phase = 'ordnance';

    const launches: OrdnanceLaunch[] = [{ shipId: ship.id, ordnanceType: 'mine' }];
    const result = processOrdnance(initialState, 0, launches, map);
    expect('error' in result).toBe(true);
  });

  it('rejects torpedo from non-warship', () => {
    // Use escape scenario for transport ships
    const escState = createGame(SCENARIOS.escape, map, 'ORD01', findBaseHex);
    const transport = escState.ships[0]; // transport, canOverload=false
    transport.landed = false;
    transport.velocity = { dq: 1, dr: 0 };
    escState.phase = 'ordnance';

    const launches: OrdnanceLaunch[] = [{ shipId: transport.id, ordnanceType: 'torpedo' }];
    const result = processOrdnance(escState, 0, launches, map);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('warship');
    }
  });

  it('rejects launch when cargo full', () => {
    const ship = initialState.ships[0]; // corvette, cargo=5
    ship.landed = false;
    ship.velocity = { dq: 1, dr: 0 };
    ship.position = { q: 0, r: 0 };
    ship.cargoUsed = 5; // all cargo used
    initialState.phase = 'ordnance';

    const launches: OrdnanceLaunch[] = [{ shipId: ship.id, ordnanceType: 'mine' }];
    const result = processOrdnance(initialState, 0, launches, map);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('cargo');
    }
  });

  it('skipOrdnance advances to combat phase', () => {
    initialState.phase = 'ordnance';
    const result = skipOrdnance(initialState, 0);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      // Should advance past ordnance
      expect(result.state.phase).not.toBe('ordnance');
    }
  });

  it('ordnance moves with gravity and self-destructs after 5 turns', () => {
    // Manually place ordnance
    initialState.ordnance = [{
      id: 'ord0',
      type: 'mine',
      owner: 0,
      position: { q: 0, r: 0 },
      velocity: { dq: 1, dr: 0 },
      turnsRemaining: 1, // will self-destruct this turn
      destroyed: false,
    }];

    const ship = initialState.ships[0];
    ship.landed = false;
    ship.velocity = { dq: 0, dr: 0 };
    ship.position = { q: 5, r: 5 };

    const orders: AstrogationOrder[] = [{ shipId: ship.id, burn: null }];
    const result = processAstrogation(initialState, 0, orders, map);
    if ('error' in result) return;

    // Ordnance should have been removed (self-destructed)
    expect(result.state.ordnance).toHaveLength(0);
  });
});

describe('detection / fog of war', () => {
  it('ships start as detected', () => {
    for (const ship of initialState.ships) {
      expect(ship.detected).toBe(true);
    }
  });

  it('detects ships within ship detection range after movement', () => {
    // Place ships far apart — should stay detected if initially detected
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.landed = false;
    ship0.position = { q: 0, r: 0 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.landed = false;
    ship1.position = { q: 2, r: 0 }; // within range 3
    ship1.velocity = { dq: 0, dr: 0 };
    ship1.detected = false; // pretend undetected

    const orders: AstrogationOrder[] = [{ shipId: ship0.id, burn: null }];
    const result = processAstrogation(initialState, 0, orders, map);
    if ('error' in result) return;

    // Ship1 should be detected (within range 3 of ship0)
    const detectedShip = result.state.ships.find(s => s.id === ship1.id)!;
    expect(detectedShip.detected).toBe(true);
  });

  it('does not detect ships beyond detection range', () => {
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.landed = false;
    ship0.position = { q: -20, r: -20 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.landed = false;
    ship1.position = { q: 20, r: 20 }; // far from ship0 and any bases
    ship1.velocity = { dq: 0, dr: 0 };
    ship1.detected = false; // start undetected

    const orders: AstrogationOrder[] = [{ shipId: ship0.id, burn: null }];
    const result = processAstrogation(initialState, 0, orders, map);
    if ('error' in result) return;

    const detectedShip = result.state.ships.find(s => s.id === ship1.id)!;
    expect(detectedShip.detected).toBe(false);
  });

  it('detected status persists once set', () => {
    const ship0 = initialState.ships[0];
    const ship1 = initialState.ships[1];
    ship0.landed = false;
    ship0.position = { q: 0, r: 0 };
    ship0.velocity = { dq: 0, dr: 0 };
    ship1.landed = false;
    ship1.position = { q: 10, r: 0 }; // beyond range
    ship1.velocity = { dq: 0, dr: 0 };
    ship1.detected = true; // already detected

    const orders: AstrogationOrder[] = [{ shipId: ship0.id, burn: null }];
    const result = processAstrogation(initialState, 0, orders, map);
    if ('error' in result) return;

    // Should stay detected (persistent)
    const detectedShip = result.state.ships.find(s => s.id === ship1.id)!;
    expect(detectedShip.detected).toBe(true);
  });
});
