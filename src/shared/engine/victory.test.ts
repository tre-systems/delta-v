import { describe, expect, it } from 'vitest';
import { SHIP_STATS } from '../constants';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { GameState, MovementEvent, Ship, SolarSystemMap } from '../types';
import { createGame } from './game-engine';
import {
  advanceTurn,
  checkCapture,
  checkGameEnd,
  checkImmediateVictory,
  checkInspection,
  checkOrbitalBaseResupply,
  checkRamming,
  updateCheckpoints,
  updateDetection,
  updateEscapeMoralVictory,
} from './victory';

let map: SolarSystemMap;

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'test-ship',
  type: 'corvette',
  owner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  landed: false,
  destroyed: false,
  detected: true,
  pendingGravityEffects: [],
  damage: { disabledTurns: 0 },
  ...overrides,
});

const setupState = (): GameState => {
  map = buildSolarSystemMap();
  return createGame(SCENARIOS.biplanetary, map, 'VTEST', findBaseHex);
};

describe('advanceTurn', () => {
  it('decrements disabled turns for active player ships', () => {
    const state = setupState();
    state.activePlayer = 0;
    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.damage.disabledTurns = 3;

    advanceTurn(state);
    expect(ship.damage.disabledTurns).toBe(2);
  });

  it('clears resuppliedThisTurn for active player ships', () => {
    const state = setupState();
    state.activePlayer = 0;
    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.resuppliedThisTurn = true;

    advanceTurn(state);
    expect(ship.resuppliedThisTurn).toBe(false);
  });

  it('switches active player and increments turn when player 1 finishes', () => {
    const state = setupState();
    state.activePlayer = 1;
    const turnBefore = state.turnNumber;

    advanceTurn(state);
    expect(state.activePlayer).toBe(0);
    expect(state.turnNumber).toBe(turnBefore + 1);
  });

  it('switches to player 1 without incrementing turn when player 0 finishes', () => {
    const state = setupState();
    state.activePlayer = 0;
    const turnBefore = state.turnNumber;

    advanceTurn(state);
    expect(state.activePlayer).toBe(1);
    expect(state.turnNumber).toBe(turnBefore);
  });

  it('sets phase to astrogation', () => {
    const state = setupState();
    state.phase = 'combat';
    advanceTurn(state);
    expect(state.phase).toBe('astrogation');
  });

  it('skips destroyed ships', () => {
    const state = setupState();
    state.activePlayer = 0;
    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.destroyed = true;
    ship.damage.disabledTurns = 3;

    advanceTurn(state);
    // Destroyed ship should not have its disabled turns decremented
    expect(ship.damage.disabledTurns).toBe(3);
  });

  it('spawns reinforcements on the scheduled turn', () => {
    const state = setupState();
    state.activePlayer = 1; // will switch to 0 and increment turn
    state.turnNumber = 2; // will become 3
    state.scenarioRules.reinforcements = [
      {
        turn: 3,
        playerId: 0,
        ships: [{ type: 'corvette', position: { q: 5, r: 5 }, velocity: { dq: 0, dr: 0 } }],
      },
    ];
    const shipsBefore = state.ships.length;
    advanceTurn(state);
    expect(state.ships.length).toBe(shipsBefore + 1);
    const newShip = state.ships[state.ships.length - 1];
    expect(newShip.type).toBe('corvette');
    expect(newShip.owner).toBe(0);
    expect(newShip.fuel).toBe(SHIP_STATS.corvette.fuel);
  });

  it('does not spawn reinforcements on wrong turn', () => {
    const state = setupState();
    state.activePlayer = 1;
    state.turnNumber = 1; // will become 2
    state.scenarioRules.reinforcements = [
      {
        turn: 5,
        playerId: 0,
        ships: [{ type: 'corvette', position: { q: 5, r: 5 }, velocity: { dq: 0, dr: 0 } }],
      },
    ];
    const shipsBefore = state.ships.length;
    advanceTurn(state);
    expect(state.ships.length).toBe(shipsBefore);
  });

  it('applies fleet conversion on scheduled turn', () => {
    const state = setupState();
    state.activePlayer = 1;
    state.turnNumber = 4; // will become 5
    state.scenarioRules.fleetConversion = { turn: 5, fromPlayer: 1, toPlayer: 0 };
    const p1Ships = state.ships.filter((s) => s.owner === 1 && !s.destroyed);
    advanceTurn(state);
    for (const ship of p1Ships) {
      expect(ship.owner).toBe(0);
    }
  });

  it('fleet conversion respects shipTypes filter', () => {
    const state = setupState();
    state.ships.push(makeShip({ id: 'extra-frigate', type: 'frigate', owner: 1 }));
    state.activePlayer = 1;
    state.turnNumber = 2; // will become 3
    state.scenarioRules.fleetConversion = { turn: 3, fromPlayer: 1, toPlayer: 0, shipTypes: ['frigate'] };
    advanceTurn(state);
    const frigate = state.ships.find((s) => s.id === 'extra-frigate')!;
    expect(frigate.owner).toBe(0);
    // Original corvettes should stay with player 1
    const p1Corvettes = state.ships.filter((s) => s.type === 'corvette' && s.id !== 'extra-frigate');
    for (const ship of p1Corvettes) {
      if (ship.owner === 1) expect(ship.owner).toBe(1);
    }
  });
});

describe('updateCheckpoints', () => {
  it('records visited checkpoint bodies from path', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.grandTour, map, 'CP01', findBaseHex);
    const player = state.players[0];
    const initialVisited = [...(player.visitedBodies ?? [])];
    expect(initialVisited).not.toContain('Sol');

    // Find a hex that belongs to a checkpoint body
    const solHex = map.bodies.find((b) => b.name === 'Sol')!.center;

    updateCheckpoints(state, 0, [solHex], map);
    expect(player.visitedBodies).toContain('Sol');
  });

  it('does not record duplicate visits', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.grandTour, map, 'CP02', findBaseHex);
    const solHex = map.bodies.find((b) => b.name === 'Sol')!.center;

    updateCheckpoints(state, 0, [solHex], map);
    updateCheckpoints(state, 0, [solHex], map);
    expect(state.players[0].visitedBodies?.filter((b) => b === 'Sol')).toHaveLength(1);
  });

  it('is a no-op when no checkpoint bodies configured', () => {
    const state = setupState();
    // biplanetary has no checkpointBodies
    updateCheckpoints(state, 0, [{ q: 0, r: 0 }], map);
    // Should not throw
  });

  it('records body from gravity hex', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.grandTour, map, 'CP03', findBaseHex);

    // Find a gravity hex for Mars
    let marsGravHex: { q: number; r: number } | null = null;
    for (const [key, hex] of map.hexes) {
      if (hex.gravity?.bodyName === 'Mars') {
        const [q, r] = key.split(',').map(Number);
        marsGravHex = { q, r };
        break;
      }
    }
    expect(marsGravHex).not.toBeNull();

    updateCheckpoints(state, 0, [marsGravHex!], map);
    expect(state.players[0].visitedBodies).toContain('Mars');
  });
});

describe('checkImmediateVictory', () => {
  it('is a no-op when no map provided', () => {
    const state = setupState();
    checkImmediateVictory(state);
    expect(state.winner).toBeNull();
  });

  it('awards checkpoint race victory when all bodies visited and landed at home', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.grandTour, map, 'GT01', findBaseHex);
    const ship = state.ships.find((s) => s.owner === 0)!;

    // Visit all checkpoint bodies
    state.players[0].visitedBodies = [...(state.scenarioRules.checkpointBodies ?? [])];

    // Land at home body (Terra for player 0)
    ship.landed = true;
    // Find a base hex for Terra
    const terraBase = findBaseHex(map, 'Terra')!;
    ship.position = terraBase;

    checkImmediateVictory(state, map);
    expect(state.winner).toBe(0);
    expect(state.winReason).toContain('Grand Tour');
    expect(state.phase).toBe('gameOver');
  });

  it('does not award checkpoint victory without visiting all bodies', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.grandTour, map, 'GT02', findBaseHex);
    const ship = state.ships.find((s) => s.owner === 0)!;

    state.players[0].visitedBodies = ['Sol', 'Mars']; // Not all visited

    ship.landed = true;
    const terraBase = findBaseHex(map, 'Terra')!;
    ship.position = terraBase;

    checkImmediateVictory(state, map);
    expect(state.winner).toBeNull();
  });

  it('awards escape victory with decisive win when fugitive has spare fuel', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'ESC1', findBaseHex);
    const fugitive = state.ships.find((s) => s.owner === 0 && s.hasFugitives);

    if (fugitive) {
      // Place far enough north to escape
      fugitive.position = { q: 0, r: map.bounds.minR - 10 };
      fugitive.velocity = { dq: 0, dr: -3 };
      fugitive.fuel = 20; // Plenty of fuel

      checkImmediateVictory(state, map);
      expect(state.winner).toBe(0);
      expect(state.winReason).toContain('decisive');
    }
  });

  it('awards escape victory with marginal win when fugitive has low fuel', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'ESC2', findBaseHex);
    const fugitive = state.ships.find((s) => s.owner === 0 && s.hasFugitives);

    if (fugitive) {
      fugitive.position = { q: 0, r: map.bounds.minR - 10 };
      fugitive.velocity = { dq: 0, dr: -3 };
      fugitive.fuel = 1; // Not enough to stop

      checkImmediateVictory(state, map);
      expect(state.winner).toBe(0);
      expect(state.winReason).toContain('marginal');
    }
  });

  it('does not award escape to non-fugitive ship when fugitive scenario exists', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'ESC3', findBaseHex);
    const nonFugitive = state.ships.find((s) => s.owner === 0 && !s.hasFugitives);

    if (nonFugitive) {
      // Place the non-fugitive beyond the edge
      nonFugitive.position = { q: 0, r: map.bounds.minR - 10 };
      nonFugitive.velocity = { dq: 0, dr: -3 };

      checkImmediateVictory(state, map);
      // Should not win since this ship doesn't have fugitives
      expect(state.winner).toBeNull();
    }
  });
});

describe('checkGameEnd', () => {
  it('awards enforcer victory when fugitive is destroyed (no moral victory)', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'GE01', findBaseHex);
    const fugitive = state.ships.find((s) => s.hasFugitives);

    if (fugitive) {
      fugitive.destroyed = true;
      state.escapeMoralVictoryAchieved = false;

      checkGameEnd(state, map);
      expect(state.winner).toBe(1 - fugitive.owner);
      expect(state.winReason).toContain('Enforcers marginal');
    }
  });

  it('awards pilgrim moral victory when fugitive destroyed but enforcer was disabled', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'GE02', findBaseHex);
    const fugitive = state.ships.find((s) => s.hasFugitives);

    if (fugitive) {
      fugitive.destroyed = true;
      state.escapeMoralVictoryAchieved = true;

      checkGameEnd(state, map);
      expect(state.winner).toBe(fugitive.owner);
      expect(state.winReason).toContain('moral victory');
    }
  });

  it('detects mutual destruction', () => {
    const state = setupState();
    state.activePlayer = 0;

    for (const ship of state.ships) {
      ship.destroyed = true;
    }

    checkGameEnd(state, map);
    expect(state.winner).toBe(1); // Last attacker (active player 0) loses
    expect(state.winReason).toContain('Mutual destruction');
  });

  it('detects fleet elimination of player 0', () => {
    const state = setupState();
    for (const ship of state.ships) {
      if (ship.owner === 0) ship.destroyed = true;
    }

    checkGameEnd(state, map);
    expect(state.winner).toBe(1);
    expect(state.winReason).toContain('Fleet eliminated');
  });

  it('detects fleet elimination of player 1', () => {
    const state = setupState();
    for (const ship of state.ships) {
      if (ship.owner === 1) ship.destroyed = true;
    }

    checkGameEnd(state, map);
    expect(state.winner).toBe(0);
    expect(state.winReason).toContain('Fleet eliminated');
  });
});

describe('updateEscapeMoralVictory', () => {
  it('sets moral victory when an enforcer ship is destroyed', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'MV01', findBaseHex);
    state.escapeMoralVictoryAchieved = false;

    // Destroy an enforcer ship
    const enforcer = state.ships.find((s) => s.owner === 1)!;
    enforcer.destroyed = true;

    updateEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(true);
  });

  it('sets moral victory when an enforcer ship is disabled', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'MV02', findBaseHex);
    state.escapeMoralVictoryAchieved = false;

    const enforcer = state.ships.find((s) => s.owner === 1)!;
    enforcer.damage.disabledTurns = 3;

    updateEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(true);
  });

  it('does not set moral victory when no enforcers damaged', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'MV03', findBaseHex);
    state.escapeMoralVictoryAchieved = false;

    updateEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(false);
  });

  it('is a no-op when already achieved', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'MV04', findBaseHex);
    state.escapeMoralVictoryAchieved = true;

    updateEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(true);
  });

  it('is a no-op for non-escape scenarios', () => {
    const state = setupState();
    state.escapeMoralVictoryAchieved = false;

    updateEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(false);
  });
});

describe('checkRamming', () => {
  it('applies ram damage when opposing ships share a hex', () => {
    const state = setupState();
    const ship0 = state.ships.find((s) => s.owner === 0)!;
    const ship1 = state.ships.find((s) => s.owner === 1)!;

    ship0.position = { q: 5, r: 5 };
    ship0.landed = false;
    ship1.position = { q: 5, r: 5 };
    ship1.landed = false;

    const events: MovementEvent[] = [];
    // Use fixed RNG for deterministic results
    checkRamming(state, events, () => 1);

    // Should generate ramming events for both ships
    expect(events.length).toBe(2);
    expect(events[0].type).toBe('ramming');
    expect(events[1].type).toBe('ramming');
  });

  it('does not ram same-side ships', () => {
    const state = setupState();
    // Add a second player-0 ship
    state.ships.push(makeShip({ id: 'p0s1', owner: 0, position: { q: 5, r: 5 }, landed: false }));
    state.ships[0].position = { q: 5, r: 5 };
    state.ships[0].landed = false;

    const events: MovementEvent[] = [];
    checkRamming(state, events, Math.random);
    expect(events.filter((e) => e.type === 'ramming')).toHaveLength(0);
  });

  it('does not ram landed ships', () => {
    const state = setupState();
    const ship0 = state.ships.find((s) => s.owner === 0)!;
    const ship1 = state.ships.find((s) => s.owner === 1)!;

    ship0.position = { q: 5, r: 5 };
    ship0.landed = true;
    ship1.position = { q: 5, r: 5 };
    ship1.landed = false;

    const events: MovementEvent[] = [];
    checkRamming(state, events, Math.random);
    expect(events.filter((e) => e.type === 'ramming')).toHaveLength(0);
  });

  it('does not ram captured ships', () => {
    const state = setupState();
    const ship0 = state.ships.find((s) => s.owner === 0)!;
    const ship1 = state.ships.find((s) => s.owner === 1)!;

    ship0.position = { q: 5, r: 5 };
    ship0.landed = false;
    ship0.captured = true;
    ship1.position = { q: 5, r: 5 };
    ship1.landed = false;

    const events: MovementEvent[] = [];
    checkRamming(state, events, Math.random);
    expect(events.filter((e) => e.type === 'ramming')).toHaveLength(0);
  });
});

describe('checkInspection', () => {
  it('reveals hidden identity when ships share position and velocity', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'INS1', findBaseHex);
    const enforcer = state.ships.find((s) => s.owner === 1)!;
    const pilgrim = state.ships.find((s) => s.owner === 0)!;

    enforcer.position = { q: 5, r: 5 };
    enforcer.velocity = { dq: 1, dr: 0 };
    enforcer.landed = false;

    pilgrim.position = { q: 5, r: 5 };
    pilgrim.velocity = { dq: 1, dr: 0 };
    pilgrim.landed = false;
    pilgrim.identityRevealed = false;

    checkInspection(state, 1);
    expect(pilgrim.identityRevealed).toBe(true);
  });

  it('does not reveal when velocities differ', () => {
    map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.escape, map, 'INS2', findBaseHex);
    const enforcer = state.ships.find((s) => s.owner === 1)!;
    const pilgrim = state.ships.find((s) => s.owner === 0)!;

    enforcer.position = { q: 5, r: 5 };
    enforcer.velocity = { dq: 1, dr: 0 };
    enforcer.landed = false;

    pilgrim.position = { q: 5, r: 5 };
    pilgrim.velocity = { dq: 0, dr: 1 }; // Different velocity
    pilgrim.landed = false;
    pilgrim.identityRevealed = false;

    checkInspection(state, 1);
    expect(pilgrim.identityRevealed).toBe(false);
  });

  it('is a no-op for non-inspection scenarios', () => {
    const state = setupState();
    checkInspection(state, 0);
    // Should not throw
  });
});

describe('checkCapture', () => {
  it('captures disabled enemy at same position and velocity', () => {
    const state = setupState();
    const captor = state.ships.find((s) => s.owner === 0)!;
    const target = state.ships.find((s) => s.owner === 1)!;

    captor.position = { q: 5, r: 5 };
    captor.velocity = { dq: 1, dr: 0 };
    captor.landed = false;

    target.position = { q: 5, r: 5 };
    target.velocity = { dq: 1, dr: 0 };
    target.landed = false;
    target.damage.disabledTurns = 3;

    const events: MovementEvent[] = [];
    checkCapture(state, 0, events);

    expect(target.captured).toBe(true);
    expect(target.owner).toBe(0);
    expect(target.identityRevealed).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('capture');
  });

  it('does not capture non-disabled enemy', () => {
    const state = setupState();
    const captor = state.ships.find((s) => s.owner === 0)!;
    const target = state.ships.find((s) => s.owner === 1)!;

    captor.position = { q: 5, r: 5 };
    captor.velocity = { dq: 1, dr: 0 };
    captor.landed = false;

    target.position = { q: 5, r: 5 };
    target.velocity = { dq: 1, dr: 0 };
    target.landed = false;
    target.damage.disabledTurns = 0;

    const events: MovementEvent[] = [];
    checkCapture(state, 0, events);

    expect(target.captured).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it('does not capture already-captured ships', () => {
    const state = setupState();
    const captor = state.ships.find((s) => s.owner === 0)!;
    const target = state.ships.find((s) => s.owner === 1)!;

    captor.position = { q: 5, r: 5 };
    captor.velocity = { dq: 1, dr: 0 };
    captor.landed = false;

    target.position = { q: 5, r: 5 };
    target.velocity = { dq: 1, dr: 0 };
    target.landed = false;
    target.damage.disabledTurns = 3;
    target.captured = true;

    const events: MovementEvent[] = [];
    checkCapture(state, 0, events);
    expect(events).toHaveLength(0);
  });
});

describe('checkOrbitalBaseResupply', () => {
  it('resupplies ship at same position and velocity as orbital base', () => {
    const state = setupState();
    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.cargoUsed = 3;
    ship.damage.disabledTurns = 2;
    ship.landed = false;

    // Add an orbital base at the same position/velocity
    state.ships.push(
      makeShip({
        id: 'ob-1',
        type: 'orbitalBase',
        owner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 1, dr: 0 },
        emplaced: true,
        landed: false,
      }),
    );

    checkOrbitalBaseResupply(state, 0);

    const stats = SHIP_STATS[ship.type];
    expect(ship.fuel).toBe(stats.fuel);
    expect(ship.cargoUsed).toBe(0);
    expect(ship.damage.disabledTurns).toBe(0);
    expect(ship.resuppliedThisTurn).toBe(true);
  });

  it('does not resupply when velocities differ', () => {
    const state = setupState();
    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.landed = false;

    state.ships.push(
      makeShip({
        id: 'ob-2',
        type: 'orbitalBase',
        owner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 0, dr: 1 }, // Different velocity
        emplaced: true,
        landed: false,
      }),
    );

    checkOrbitalBaseResupply(state, 0);
    expect(ship.fuel).toBe(5);
  });

  it('does not resupply enemy ships', () => {
    const state = setupState();
    const ship = state.ships.find((s) => s.owner === 1)!;
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.landed = false;

    state.ships.push(
      makeShip({
        id: 'ob-3',
        type: 'orbitalBase',
        owner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 1, dr: 0 },
        emplaced: true,
        landed: false,
      }),
    );

    checkOrbitalBaseResupply(state, 0);
    expect(ship.fuel).toBe(5);
  });

  it('does not resupply already-resupplied ships', () => {
    const state = setupState();
    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.resuppliedThisTurn = true;
    ship.landed = false;

    state.ships.push(
      makeShip({
        id: 'ob-4',
        type: 'orbitalBase',
        owner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 1, dr: 0 },
        emplaced: true,
        landed: false,
      }),
    );

    checkOrbitalBaseResupply(state, 0);
    expect(ship.fuel).toBe(5);
  });
});

describe('updateDetection', () => {
  it('hides ship landed at own base', () => {
    const state = setupState();
    map = buildSolarSystemMap();

    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.detected = true;
    ship.landed = true;
    // Ship is at its home base (Mars base)
    const marsBase = findBaseHex(map, 'Mars')!;
    ship.position = marsBase;

    // Move enemy far away
    const enemy = state.ships.find((s) => s.owner === 1)!;
    enemy.position = { q: 30, r: 30 };

    updateDetection(state, map);
    expect(ship.detected).toBe(false);
  });

  it('detects ship within enemy ship range', () => {
    const state = setupState();
    map = buildSolarSystemMap();

    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.detected = false;
    ship.landed = false;
    ship.position = { q: 10, r: 10 };

    const enemy = state.ships.find((s) => s.owner === 1)!;
    enemy.position = { q: 12, r: 10 }; // Within SHIP_DETECTION_RANGE (3)

    updateDetection(state, map);
    expect(ship.detected).toBe(true);
  });

  it('detects ship within enemy base range', () => {
    const state = setupState();
    map = buildSolarSystemMap();

    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.detected = false;
    ship.landed = false;

    // Move all enemy ships far away to isolate base detection
    for (const s of state.ships) {
      if (s.owner === 1) {
        s.position = { q: 50, r: 50 };
      }
    }

    // Place ship near an enemy base (Venus base belongs to player 1)
    const venusBase = findBaseHex(map, 'Venus')!;
    ship.position = venusBase;

    updateDetection(state, map);
    expect(ship.detected).toBe(true);
  });

  it('ship remains undetected when far from all enemies and bases', () => {
    const state = setupState();
    map = buildSolarSystemMap();

    const ship = state.ships.find((s) => s.owner === 0)!;
    ship.detected = false;
    ship.landed = false;
    ship.position = { q: 40, r: 40 }; // Far from everything

    // Move all enemies far away
    for (const s of state.ships) {
      if (s.owner === 1) {
        s.position = { q: -40, r: -40 };
      }
    }

    updateDetection(state, map);
    expect(ship.detected).toBe(false);
  });
});
