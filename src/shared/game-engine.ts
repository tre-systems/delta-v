import type {
  GameState, Ship, AstrogationOrder, ShipMovement, SolarSystemMap,
  ScenarioDefinition,
} from './types';
import { computeCourse } from './movement';
import { SHIP_STATS } from './constants';
import { hexKey } from './hex';

export interface TurnResult {
  movements: ShipMovement[];
  state: GameState;
}

/**
 * Pure game engine — no IO, no networking, no storage.
 * All game logic lives here so it can be unit tested.
 */
export function createGame(
  scenario: ScenarioDefinition,
  map: SolarSystemMap,
  gameCode: string,
  findBaseHex: (map: SolarSystemMap, bodyName: string) => { q: number; r: number } | null,
): GameState {
  const ships: Ship[] = [];

  for (let p = 0; p < scenario.players.length; p++) {
    for (let s = 0; s < scenario.players[p].ships.length; s++) {
      const def = scenario.players[p].ships[s];
      const stats = SHIP_STATS[def.type];
      const baseHex = findBaseHex(map, scenario.players[p].homeBody);

      ships.push({
        id: `p${p}s${s}`,
        type: def.type,
        owner: p,
        position: baseHex ?? def.position,
        velocity: { ...def.velocity },
        fuel: stats?.fuel ?? 20,
        landed: true,
        destroyed: false,
        damage: { disabledTurns: 0 },
      });
    }
  }

  return {
    gameId: gameCode,
    scenario: scenario.name,
    turnNumber: 1,
    phase: 'astrogation',
    activePlayer: 0,
    ships,
    players: [
      { connected: true, ready: true, targetBody: scenario.players[0].targetBody },
      { connected: true, ready: true, targetBody: scenario.players[1].targetBody },
    ],
    winner: null,
    winReason: null,
  };
}

/**
 * Process astrogation orders for the active player.
 * Returns the updated state and movement results, or an error string.
 */
export function processAstrogation(
  state: GameState,
  playerId: number,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
): TurnResult | { error: string } {
  if (state.phase !== 'astrogation') {
    return { error: 'Not in astrogation phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const movements: ShipMovement[] = [];

  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    if (ship.destroyed) continue;

    const order = orders.find(o => o.shipId === ship.id);
    const burn = order?.burn ?? null;

    // Validate burn direction
    if (burn !== null && (burn < 0 || burn > 5)) {
      return { error: 'Invalid burn direction' };
    }
    if (burn !== null && ship.fuel <= 0) {
      return { error: 'No fuel remaining' };
    }

    // Validate overload
    const overload = order?.overload ?? null;
    if (overload !== null && (overload < 0 || overload > 5)) {
      return { error: 'Invalid overload direction' };
    }

    const course = computeCourse(ship, burn, map, {
      overload,
      weakGravityChoices: order?.weakGravityChoices,
    });

    movements.push({
      shipId: ship.id,
      from: { ...ship.position },
      to: course.destination,
      path: course.path,
      newVelocity: course.newVelocity,
      fuelSpent: course.fuelSpent,
      gravityEffects: course.gravityEffects,
      crashed: course.crashed,
      landedAt: course.landedAt,
    });

    // Apply movement to ship
    ship.position = course.destination;
    ship.velocity = course.newVelocity;
    ship.fuel -= course.fuelSpent;
    ship.landed = course.landedAt !== null;

    if (course.landedAt) {
      ship.velocity = { dq: 0, dr: 0 };
      // Resupply: landing at a friendly base refuels the ship
      applyResupply(ship, course.landedAt, state, map);
    }

    if (course.crashed) {
      ship.destroyed = true;
      ship.velocity = { dq: 0, dr: 0 };
    }
  }

  // Check victory/loss
  checkGameEnd(state, map);

  if (state.winner === null) {
    // Switch active player
    state.activePlayer = 1 - state.activePlayer;
    if (state.activePlayer === 0) {
      state.turnNumber++;
    }
  }

  return { movements, state };
}

/**
 * Resupply a ship that has landed at a base.
 * Only resupplies at friendly (home) bases.
 */
function applyResupply(ship: Ship, landedBodyName: string, state: GameState, map: SolarSystemMap): void {
  const player = state.players[ship.owner];
  const hex = map.hexes.get(hexKey(ship.position));

  // Check if this is a base belonging to the player's home body
  // In Bi-Planetary, bases are neutral — any base resupplies any player
  // For future scenarios with base ownership, check here
  if (!hex?.base) return;

  const stats = SHIP_STATS[ship.type];
  if (stats) {
    ship.fuel = stats.fuel; // Refuel to max
    ship.damage = { disabledTurns: 0 }; // Full repair
  }
}

/**
 * Check if the game has ended (victory or all ships destroyed).
 */
function checkGameEnd(state: GameState, map: SolarSystemMap): void {
  // Check victory: landing on target body
  for (const ship of state.ships) {
    if (ship.destroyed || !ship.landed) continue;
    const targetBody = state.players[ship.owner].targetBody;
    const hex = map.hexes.get(hexKey(ship.position));
    if (hex?.base?.bodyName === targetBody || hex?.body?.name === targetBody) {
      state.winner = ship.owner;
      state.winReason = `Landed on ${targetBody}!`;
      state.phase = 'gameOver';
      return;
    }
  }

  // Check loss: all ships destroyed
  for (let p = 0; p < 2; p++) {
    const alive = state.ships.filter(s => s.owner === p && !s.destroyed);
    if (alive.length === 0) {
      state.winner = 1 - p;
      state.winReason = `Opponent's ship was destroyed!`;
      state.phase = 'gameOver';
      return;
    }
  }
}
