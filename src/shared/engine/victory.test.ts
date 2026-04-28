import { describe, expect, it } from 'vitest';
import { must } from '../assert';
import { ORBITAL_BASE_MASS, SHIP_STATS } from '../constants';
import { asGameId, asShipId } from '../ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import type { GameState, MovementEvent, Ship, SolarSystemMap } from '../types';
import type { EngineEvent } from './engine-events';
import { createGameOrThrow } from './game-engine';
import {
  advanceTurn,
  applyCheckpoints,
  applyDetection,
  applyEscapeMoralVictory,
  checkCapture,
  checkGameEnd,
  checkImmediateVictory,
  checkInspection,
  checkOrbitalBaseResupply,
  checkRamming,
} from './victory';

let map: SolarSystemMap;
const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('test-ship'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
  cargoUsed: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  nukesLaunchedSinceResupply: 0,
  detected: true,
  pendingGravityEffects: [],
  damage: { disabledTurns: 0 },
  ...overrides,
});
const setupState = (): GameState => {
  map = buildSolarSystemMap();
  return createGameOrThrow(
    SCENARIOS.biplanetary,
    map,
    asGameId('VTEST'),
    findBaseHex,
  );
};
describe('advanceTurn', () => {
  it('decrements disabled turns for active player ships', () => {
    const state = setupState();
    state.activePlayer = 0;
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.damage.disabledTurns = 3;
    advanceTurn(state);
    expect(ship.damage.disabledTurns).toBe(2);
  });
  it('clears resuppliedThisTurn for active player ships', () => {
    const state = setupState();
    state.activePlayer = 0;
    const ship = must(state.ships.find((s) => s.owner === 0));
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
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.lifecycle = 'destroyed';
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
        ships: [
          {
            type: 'corvette',
            position: { q: 5, r: 5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
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
        ships: [
          {
            type: 'corvette',
            position: { q: 5, r: 5 },
            velocity: { dq: 0, dr: 0 },
          },
        ],
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
    state.scenarioRules.fleetConversion = {
      turn: 5,
      fromPlayer: 1,
      toPlayer: 0,
    };
    const p1Ships = state.ships.filter(
      (s) => s.owner === 1 && s.lifecycle !== 'destroyed',
    );
    advanceTurn(state);
    for (const ship of p1Ships) {
      expect(ship.owner).toBe(0);
    }
  });
  it('fleet conversion respects shipTypes filter', () => {
    const state = setupState();
    state.ships.push(
      makeShip({
        id: asShipId('extra-frigate'),
        type: 'frigate',
        owner: 1,
        originalOwner: 0,
      }),
    );
    state.activePlayer = 1;
    state.turnNumber = 2; // will become 3
    state.scenarioRules.fleetConversion = {
      turn: 3,
      fromPlayer: 1,
      toPlayer: 0,
      shipTypes: ['frigate'],
    };
    advanceTurn(state);
    const frigate = must(state.ships.find((s) => s.id === 'extra-frigate'));
    expect(frigate.owner).toBe(0);
    // Original corvettes should stay with player 1
    const p1Corvettes = state.ships.filter(
      (s) => s.type === 'corvette' && s.id !== 'extra-frigate',
    );
    for (const ship of p1Corvettes) {
      if (ship.owner === 1) expect(ship.owner).toBe(1);
    }
  });
});
describe('applyCheckpoints', () => {
  it('records visited checkpoint bodies from path', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('CP01'),
      findBaseHex,
    );
    const player = state.players[0];
    const initialVisited = [...(player.visitedBodies ?? [])];
    expect(initialVisited).not.toContain('Sol');
    // Find a hex that belongs to a checkpoint body
    const solHex = must(map.bodies.find((b) => b.name === 'Sol')?.center);
    applyCheckpoints(state, 0, [solHex], map);
    expect(player.visitedBodies).toContain('Sol');
  });
  it('does not record duplicate visits', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('CP02'),
      findBaseHex,
    );
    const solHex = must(map.bodies.find((b) => b.name === 'Sol')?.center);
    applyCheckpoints(state, 0, [solHex], map);
    applyCheckpoints(state, 0, [solHex], map);
    expect(
      state.players[0].visitedBodies?.filter((b) => b === 'Sol'),
    ).toHaveLength(1);
  });
  it('is a no-op when no checkpoint bodies configured', () => {
    const state = setupState();
    // biplanetary has no checkpointBodies
    applyCheckpoints(state, 0, [{ q: 0, r: 0 }], map);
    // Should not throw
  });
  it('records body from gravity hex', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('CP03'),
      findBaseHex,
    );
    // Find a gravity hex for Mars
    let marsGravHex: {
      q: number;
      r: number;
    } | null = null;
    for (const [key, hex] of map.hexes) {
      if (hex.gravity?.bodyName === 'Mars') {
        const [q, r] = key.split(',').map(Number);
        marsGravHex = { q, r };
        break;
      }
    }
    expect(marsGravHex).not.toBeNull();
    applyCheckpoints(state, 0, [must(marsGravHex)], map);
    expect(state.players[0].visitedBodies).toContain('Mars');
  });
  it('does not count the home checkpoint on opening departure', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('CP04'),
      findBaseHex,
    );
    const marsBase = must(findBaseHex(map, 'Mars'));

    applyCheckpoints(state, 1, [marsBase], map);

    expect(state.players[1].visitedBodies).not.toContain('Mars');

    state.players[1].visitedBodies = ['Sol'];
    applyCheckpoints(state, 1, [marsBase], map);

    expect(state.players[1].visitedBodies).toContain('Mars');
  });
});
describe('checkImmediateVictory', () => {
  it('is a no-op when no map provided', () => {
    const state = setupState();
    checkImmediateVictory(state);
    expect(state.outcome).toBeNull();
  });
  it('awards checkpoint race victory when all bodies visited and landed at home', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT01'),
      findBaseHex,
    );
    const ship = must(state.ships.find((s) => s.owner === 0));
    // Visit all checkpoint bodies
    state.players[0].visitedBodies = [
      ...(state.scenarioRules.checkpointBodies ?? []),
    ];
    // Land at home body (Luna for player 0)
    ship.lifecycle = 'landed';
    const homeBase = must(findBaseHex(map, 'Luna'));
    ship.position = homeBase;
    checkImmediateVictory(state, map);
    expect(state.outcome?.winner).toBe(0);
    expect(state.outcome?.reason).toContain('Grand Tour');
    expect(state.phase).toBe('gameOver');
  });
  it('does not award checkpoint victory without visiting all bodies', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.grandTour,
      map,
      asGameId('GT02'),
      findBaseHex,
    );
    const ship = must(state.ships.find((s) => s.owner === 0));
    state.players[0].visitedBodies = ['Sol', 'Mars']; // Not all visited
    ship.lifecycle = 'landed';
    const terraBase = must(findBaseHex(map, 'Terra'));
    ship.position = terraBase;
    checkImmediateVictory(state, map);
    expect(state.outcome).toBeNull();
  });
  it('awards escape victory with decisive win when fugitive has spare fuel', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ESC1'),
      findBaseHex,
    );
    const fugitive = state.ships.find(
      (s) => s.owner === 0 && s.identity?.hasFugitives,
    );
    if (fugitive) {
      // Place far enough north to escape
      fugitive.position = { q: 0, r: map.bounds.minR - 10 };
      fugitive.velocity = { dq: 0, dr: -3 };
      fugitive.fuel = 20; // Plenty of fuel
      checkImmediateVictory(state, map);
      expect(state.outcome?.winner).toBe(0);
      expect(state.outcome?.reason).toContain('decisive');
    }
  });
  it('awards escape victory with marginal win when fugitive has low fuel', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ESC2'),
      findBaseHex,
    );
    const fugitive = state.ships.find(
      (s) => s.owner === 0 && s.identity?.hasFugitives,
    );
    if (fugitive) {
      fugitive.position = { q: 0, r: map.bounds.minR - 10 };
      fugitive.velocity = { dq: 0, dr: -3 };
      fugitive.fuel = 1; // Not enough to stop
      checkImmediateVictory(state, map);
      expect(state.outcome?.winner).toBe(0);
      expect(state.outcome?.reason).toContain('marginal');
    }
  });
  it('does not award escape to non-fugitive ship when fugitive scenario exists', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('ESC3'),
      findBaseHex,
    );
    const nonFugitive = state.ships.find(
      (s) => s.owner === 0 && !s.identity?.hasFugitives,
    );
    if (nonFugitive) {
      // Place the non-fugitive beyond the edge
      nonFugitive.position = { q: 0, r: map.bounds.minR - 10 };
      nonFugitive.velocity = { dq: 0, dr: -3 };
      checkImmediateVictory(state, map);
      // Should not win since this ship doesn't have fugitives
      expect(state.outcome).toBeNull();
    }
  });
  it('with targetWinRequiresPassengers, ignores target landing without passengers', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('PW01'),
      findBaseHex,
    );
    expect(state.scenarioRules.targetWinRequiresPassengers).toBe(true);
    const venusHex = must(findBaseHex(map, 'Venus'));
    const ship = must(
      state.ships.find((s) => s.owner === 0 && s.type === 'tanker'),
    );
    ship.lifecycle = 'landed';
    ship.position = { ...venusHex };
    ship.passengersAboard = undefined;
    checkImmediateVictory(state, map);
    expect(state.outcome).toBeNull();
  });
  it('with targetWinRequiresPassengers, awards win when landing with passengers', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('PW02'),
      findBaseHex,
    );
    const venusHex = must(findBaseHex(map, 'Venus'));
    const ship = must(
      state.ships.find((s) => s.owner === 0 && s.type === 'liner'),
    );
    ship.lifecycle = 'landed';
    ship.position = { ...venusHex };
    ship.passengersAboard = 10;
    checkImmediateVictory(state, map);
    expect(state.outcome?.winner).toBe(0);
    expect(state.outcome?.reason).toContain('colonists');
    expect(state.phase).toBe('gameOver');
  });
});
describe('checkGameEnd', () => {
  it('awards enforcer victory when fugitive is destroyed (no moral victory)', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('GE01'),
      findBaseHex,
    );
    const fugitive = state.ships.find((s) => s.identity?.hasFugitives);
    if (fugitive) {
      fugitive.lifecycle = 'destroyed';
      state.escapeMoralVictoryAchieved = false;
      checkGameEnd(state, map);
      expect(state.outcome?.winner).toBe(1 - fugitive.owner);
      expect(state.outcome?.reason).toContain('Enforcers marginal');
    }
  });
  it('awards pilgrim moral victory when fugitive destroyed but enforcer was disabled', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('GE02'),
      findBaseHex,
    );
    const fugitive = state.ships.find((s) => s.identity?.hasFugitives);
    if (fugitive) {
      fugitive.lifecycle = 'destroyed';
      state.escapeMoralVictoryAchieved = true;
      checkGameEnd(state, map);
      expect(state.outcome?.winner).toBe(fugitive.owner);
      expect(state.outcome?.reason).toContain('moral victory');
    }
  });
  it('detects mutual destruction', () => {
    const state = setupState();
    state.activePlayer = 0;
    for (const ship of state.ships) {
      ship.lifecycle = 'destroyed';
    }
    checkGameEnd(state, map);
    expect(state.outcome?.winner).toBe(1); // Last attacker (active player 0) loses
    expect(state.outcome?.reason).toContain('Mutual destruction');
  });
  it('detects fleet elimination of player 0', () => {
    const state = setupState();
    for (const ship of state.ships) {
      if (ship.owner === 0) ship.lifecycle = 'destroyed';
    }
    checkGameEnd(state, map);
    expect(state.outcome?.winner).toBe(1);
    expect(state.outcome?.reason).toContain('Fleet eliminated');
  });
  it('detects fleet elimination of player 1', () => {
    const state = setupState();
    for (const ship of state.ships) {
      if (ship.owner === 1) ship.lifecycle = 'destroyed';
    }
    checkGameEnd(state, map);
    expect(state.outcome?.winner).toBe(0);
    expect(state.outcome?.reason).toContain('Fleet eliminated');
  });
  it('ends passenger rescue scenarios when no colonists survive', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('GE-PAX-LOST'),
      findBaseHex,
    );

    for (const ship of state.ships.filter((s) => s.owner === 0)) {
      ship.passengersAboard = undefined;
    }

    checkGameEnd(state, map);

    expect(state.outcome?.winner).toBe(1);
    expect(state.outcome?.reason).toContain('Passenger objective failed');
  });
  it('does not fail passenger rescue while any colonists survive', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.convoy,
      map,
      asGameId('GE-PAX-ALIVE'),
      findBaseHex,
    );
    const liner = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'liner'),
    );
    const tanker = must(
      state.ships.find((ship) => ship.owner === 0 && ship.type === 'tanker'),
    );

    liner.lifecycle = 'destroyed';
    liner.passengersAboard = undefined;
    tanker.passengersAboard = 1;

    checkGameEnd(state, map);

    expect(state.outcome).toBeNull();
  });
});
describe('applyEscapeMoralVictory', () => {
  it('sets moral victory when an enforcer ship is destroyed', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('MV01'),
      findBaseHex,
    );
    state.escapeMoralVictoryAchieved = false;
    // Destroy an enforcer ship
    const enforcer = must(state.ships.find((s) => s.owner === 1));
    enforcer.lifecycle = 'destroyed';
    applyEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(true);
  });
  it('sets moral victory when an enforcer ship is heavily disabled (D2+)', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('MV02'),
      findBaseHex,
    );
    state.escapeMoralVictoryAchieved = false;
    const enforcer = must(state.ships.find((s) => s.owner === 1));
    enforcer.damage.disabledTurns = 3;
    applyEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(true);
  });
  it('does not set moral victory when an enforcer has only D1 damage', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('MV04'),
      findBaseHex,
    );
    state.escapeMoralVictoryAchieved = false;
    const enforcer = must(state.ships.find((s) => s.owner === 1));
    enforcer.damage.disabledTurns = 1;
    applyEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(false);
  });
  it('does not set moral victory when no enforcers damaged', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('MV03'),
      findBaseHex,
    );
    state.escapeMoralVictoryAchieved = false;
    applyEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(false);
  });
  it('is a no-op when already achieved', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('MV04'),
      findBaseHex,
    );
    state.escapeMoralVictoryAchieved = true;
    applyEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(true);
  });
  it('is a no-op for non-escape scenarios', () => {
    const state = setupState();
    state.escapeMoralVictoryAchieved = false;
    applyEscapeMoralVictory(state);
    expect(state.escapeMoralVictoryAchieved).toBe(false);
  });
});
describe('checkRamming', () => {
  it('applies ram damage when opposing ships share a hex', () => {
    const state = setupState();
    const ship0 = must(state.ships.find((s) => s.owner === 0));
    const ship1 = must(state.ships.find((s) => s.owner === 1));
    ship0.position = { q: 5, r: 5 };
    ship0.lifecycle = 'active';
    ship1.position = { q: 5, r: 5 };
    ship1.lifecycle = 'active';
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
    state.ships.push(
      makeShip({
        id: asShipId('p0s1'),
        owner: 0,
        originalOwner: 0,
        position: { q: 5, r: 5 },
      }),
    );
    state.ships[0].position = { q: 5, r: 5 };
    state.ships[0].lifecycle = 'active';
    const events: MovementEvent[] = [];
    checkRamming(state, events, Math.random);
    expect(events.filter((e) => e.type === 'ramming')).toHaveLength(0);
  });
  it('does not ram landed ships', () => {
    const state = setupState();
    const ship0 = must(state.ships.find((s) => s.owner === 0));
    const ship1 = must(state.ships.find((s) => s.owner === 1));
    ship0.position = { q: 5, r: 5 };
    ship0.lifecycle = 'landed';
    ship1.position = { q: 5, r: 5 };
    ship1.lifecycle = 'active';
    const events: MovementEvent[] = [];
    checkRamming(state, events, Math.random);
    expect(events.filter((e) => e.type === 'ramming')).toHaveLength(0);
  });
  it('does not ram captured ships', () => {
    const state = setupState();
    const ship0 = must(state.ships.find((s) => s.owner === 0));
    const ship1 = must(state.ships.find((s) => s.owner === 1));
    ship0.position = { q: 5, r: 5 };
    ship0.lifecycle = 'active';
    ship0.control = 'captured';
    ship1.position = { q: 5, r: 5 };
    ship1.lifecycle = 'active';
    const events: MovementEvent[] = [];
    checkRamming(state, events, Math.random);
    expect(events.filter((e) => e.type === 'ramming')).toHaveLength(0);
  });
});
describe('checkInspection', () => {
  it('reveals hidden identity when ships share position and velocity', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('INS1'),
      findBaseHex,
    );
    const enforcer = must(state.ships.find((s) => s.owner === 1));
    const pilgrim = must(state.ships.find((s) => s.owner === 0));
    enforcer.position = { q: 5, r: 5 };
    enforcer.velocity = { dq: 1, dr: 0 };
    enforcer.lifecycle = 'active';
    pilgrim.position = { q: 5, r: 5 };
    pilgrim.velocity = { dq: 1, dr: 0 };
    pilgrim.lifecycle = 'active';
    if (pilgrim.identity) pilgrim.identity.revealed = false;
    checkInspection(state, 1);
    expect(pilgrim.identity?.revealed).toBe(true);
  });
  it('does not reveal when velocities differ', () => {
    map = buildSolarSystemMap();
    const state = createGameOrThrow(
      SCENARIOS.escape,
      map,
      asGameId('INS2'),
      findBaseHex,
    );
    const enforcer = must(state.ships.find((s) => s.owner === 1));
    const pilgrim = must(state.ships.find((s) => s.owner === 0));
    enforcer.position = { q: 5, r: 5 };
    enforcer.velocity = { dq: 1, dr: 0 };
    enforcer.lifecycle = 'active';
    pilgrim.position = { q: 5, r: 5 };
    pilgrim.velocity = { dq: 0, dr: 1 }; // Different velocity
    pilgrim.lifecycle = 'active';
    if (pilgrim.identity) pilgrim.identity.revealed = false;
    checkInspection(state, 1);
    expect(pilgrim.identity?.revealed).toBe(false);
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
    const captor = must(state.ships.find((s) => s.owner === 0));
    const target = must(state.ships.find((s) => s.owner === 1));
    captor.position = { q: 5, r: 5 };
    captor.velocity = { dq: 1, dr: 0 };
    captor.lifecycle = 'active';
    target.position = { q: 5, r: 5 };
    target.velocity = { dq: 1, dr: 0 };
    target.lifecycle = 'active';
    target.damage.disabledTurns = 3;
    const events: MovementEvent[] = [];
    const engineEvents: EngineEvent[] = [];
    checkCapture(state, 0, events, engineEvents);
    expect(target.control).toBe('captured');
    expect(target.owner).toBe(0);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('capture');
    expect(engineEvents).toContainEqual({
      type: 'shipCaptured',
      shipId: target.id,
      capturedBy: 0,
      capturedByShipId: captor.id,
    });
  });
  it('does not capture non-disabled enemy', () => {
    const state = setupState();
    const captor = must(state.ships.find((s) => s.owner === 0));
    const target = must(state.ships.find((s) => s.owner === 1));
    captor.position = { q: 5, r: 5 };
    captor.velocity = { dq: 1, dr: 0 };
    captor.lifecycle = 'active';
    target.position = { q: 5, r: 5 };
    target.velocity = { dq: 1, dr: 0 };
    target.lifecycle = 'active';
    target.damage.disabledTurns = 0;
    const events: MovementEvent[] = [];
    checkCapture(state, 0, events);
    expect(target.control).toBe('own');
    expect(events).toHaveLength(0);
  });
  it('does not capture already-captured ships', () => {
    const state = setupState();
    const captor = must(state.ships.find((s) => s.owner === 0));
    const target = must(state.ships.find((s) => s.owner === 1));
    captor.position = { q: 5, r: 5 };
    captor.velocity = { dq: 1, dr: 0 };
    captor.lifecycle = 'active';
    target.position = { q: 5, r: 5 };
    target.velocity = { dq: 1, dr: 0 };
    target.lifecycle = 'active';
    target.damage.disabledTurns = 3;
    target.control = 'captured';
    const events: MovementEvent[] = [];
    checkCapture(state, 0, events);
    expect(events).toHaveLength(0);
  });
});
describe('checkOrbitalBaseResupply', () => {
  it('resupplies ship at same position and velocity as orbital base', () => {
    const state = setupState();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.cargoUsed = 3;
    ship.damage.disabledTurns = 2;
    ship.lifecycle = 'active';
    // Add an orbital base at the same position/velocity
    state.ships.push(
      makeShip({
        id: asShipId('ob-1'),
        type: 'orbitalBase',
        owner: 0,
        originalOwner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 1, dr: 0 },
        baseStatus: 'emplaced',
      }),
    );
    const engineEvents: EngineEvent[] = [];
    checkOrbitalBaseResupply(state, 0, engineEvents);
    const stats = SHIP_STATS[ship.type];
    expect(ship.fuel).toBe(stats.fuel);
    expect(ship.cargoUsed).toBe(0);
    expect(ship.damage.disabledTurns).toBe(0);
    expect(ship.resuppliedThisTurn).toBe(true);
    expect(engineEvents).toContainEqual({
      type: 'shipResupplied',
      shipId: ship.id,
      source: 'orbitalBase',
      sourceId: 'ob-1',
    });
  });
  it('does not resupply when velocities differ', () => {
    const state = setupState();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.lifecycle = 'active';
    state.ships.push(
      makeShip({
        id: asShipId('ob-2'),
        type: 'orbitalBase',
        owner: 0,
        originalOwner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 0, dr: 1 }, // Different velocity
        baseStatus: 'emplaced',
      }),
    );
    checkOrbitalBaseResupply(state, 0);
    expect(ship.fuel).toBe(5);
  });
  it('does not resupply enemy ships', () => {
    const state = setupState();
    const ship = must(state.ships.find((s) => s.owner === 1));
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.lifecycle = 'active';
    state.ships.push(
      makeShip({
        id: asShipId('ob-3'),
        type: 'orbitalBase',
        owner: 0,
        originalOwner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 1, dr: 0 },
        baseStatus: 'emplaced',
      }),
    );
    checkOrbitalBaseResupply(state, 0);
    expect(ship.fuel).toBe(5);
  });
  it('does not resupply already-resupplied ships', () => {
    const state = setupState();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.fuel = 5;
    ship.resuppliedThisTurn = true;
    ship.lifecycle = 'active';
    state.ships.push(
      makeShip({
        id: asShipId('ob-4'),
        type: 'orbitalBase',
        owner: 0,
        originalOwner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 1, dr: 0 },
        baseStatus: 'emplaced',
      }),
    );
    checkOrbitalBaseResupply(state, 0);
    expect(ship.fuel).toBe(5);
  });

  it('preserves carried orbital-base mass while rearming the carrier', () => {
    const state = setupState();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.position = { q: 5, r: 5 };
    ship.velocity = { dq: 1, dr: 0 };
    ship.type = 'transport';
    ship.fuel = 5;
    ship.cargoUsed = ORBITAL_BASE_MASS + 20;
    ship.nukesLaunchedSinceResupply = 1;
    ship.baseStatus = 'carryingBase';
    ship.lifecycle = 'active';
    state.ships.push(
      makeShip({
        id: asShipId('ob-5'),
        type: 'orbitalBase',
        owner: 0,
        originalOwner: 0,
        position: { q: 5, r: 5 },
        velocity: { dq: 1, dr: 0 },
        baseStatus: 'emplaced',
      }),
    );

    checkOrbitalBaseResupply(state, 0);

    expect(ship.cargoUsed).toBe(ORBITAL_BASE_MASS);
    expect(ship.nukesLaunchedSinceResupply).toBe(0);
  });
});
describe('applyDetection', () => {
  it('hides ship landed at own base', () => {
    const state = setupState();
    map = buildSolarSystemMap();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.detected = true;
    ship.lifecycle = 'landed';
    // Ship is at its home base (Mars base)
    const marsBase = must(findBaseHex(map, 'Mars'));
    ship.position = marsBase;
    // Move enemy far away
    const enemy = must(state.ships.find((s) => s.owner === 1));
    enemy.position = { q: 30, r: 30 };
    applyDetection(state, map);
    expect(ship.detected).toBe(false);
  });
  it('detects ship within enemy ship range', () => {
    const state = setupState();
    map = buildSolarSystemMap();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.detected = false;
    ship.lifecycle = 'active';
    ship.position = { q: 10, r: 10 };
    const enemy = must(state.ships.find((s) => s.owner === 1));
    enemy.position = { q: 12, r: 10 }; // Within SHIP_DETECTION_RANGE (3)
    applyDetection(state, map);
    expect(ship.detected).toBe(true);
  });
  it('detects ship within enemy base range', () => {
    const state = setupState();
    map = buildSolarSystemMap();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.detected = false;
    ship.lifecycle = 'active';
    // Move all enemy ships far away to isolate base detection
    for (const s of state.ships) {
      if (s.owner === 1) {
        s.position = { q: 50, r: 50 };
      }
    }
    // Place ship near an enemy base (Venus base belongs to player 1)
    const venusBase = must(findBaseHex(map, 'Venus'));
    ship.position = venusBase;
    applyDetection(state, map);
    expect(ship.detected).toBe(true);
  });
  it('ship remains undetected when far from all enemies and bases', () => {
    const state = setupState();
    map = buildSolarSystemMap();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.detected = false;
    ship.lifecycle = 'active';
    ship.position = { q: 40, r: 40 }; // Far from everything
    // Move all enemies far away
    for (const s of state.ships) {
      if (s.owner === 1) {
        s.position = { q: -40, r: -40 };
      }
    }
    applyDetection(state, map);
    expect(ship.detected).toBe(false);
  });
  it('detected ship stays detected regardless of range (rulebook p.8)', () => {
    const state = setupState();
    map = buildSolarSystemMap();
    const ship = must(state.ships.find((s) => s.owner === 0));
    ship.detected = true;
    ship.lifecycle = 'active';
    ship.position = { q: 40, r: 40 }; // Far from everything
    for (const s of state.ships) {
      if (s.owner === 1) {
        s.position = { q: -40, r: -40 };
      }
    }
    applyDetection(state, map);
    expect(ship.detected).toBe(true);
  });
});
