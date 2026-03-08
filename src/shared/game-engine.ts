import type {
  GameState, Ship, AstrogationOrder, ShipMovement, SolarSystemMap,
  ScenarioDefinition, CombatAttack, CombatResult, MovementEvent,
} from './types';
import { computeCourse } from './movement';
import { SHIP_STATS } from './constants';
import { hexKey, hexVecLength } from './hex';
import {
  resolveCombat, canAttack, lookupOtherDamage, applyDamage, rollD6,
  type CombatResolution,
} from './combat';

export interface MovementResult {
  movements: ShipMovement[];
  events: MovementEvent[];
  state: GameState;
}

export interface CombatPhaseResult {
  results: CombatResult[];
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
      const shouldLand = def.startLanded !== false;

      let position: { q: number; r: number };
      let landed: boolean;

      if (shouldLand) {
        const baseHex = findBaseHex(map, scenario.players[p].homeBody);
        position = baseHex ?? def.position;
        landed = true;
      } else {
        position = { ...def.position };
        landed = false;
      }

      ships.push({
        id: `p${p}s${s}`,
        type: def.type,
        owner: p,
        position,
        velocity: { ...def.velocity },
        fuel: stats?.fuel ?? 20,
        landed,
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
      { connected: true, ready: true, targetBody: scenario.players[0].targetBody, escapeWins: scenario.players[0].escapeWins },
      { connected: true, ready: true, targetBody: scenario.players[1].targetBody, escapeWins: scenario.players[1].escapeWins },
    ],
    winner: null,
    winReason: null,
  };
}

/**
 * Process astrogation orders for the active player.
 * Moves ships, checks asteroid hazards, then advances to combat phase.
 */
export function processAstrogation(
  state: GameState,
  playerId: number,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
  rng?: () => number,
): MovementResult | { error: string } {
  if (state.phase !== 'astrogation') {
    return { error: 'Not in astrogation phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const movements: ShipMovement[] = [];
  const events: MovementEvent[] = [];

  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    if (ship.destroyed) continue;

    // Disabled ships drift — they cannot maneuver
    const isDisabled = ship.damage.disabledTurns > 0;

    const order = orders.find(o => o.shipId === ship.id);
    const burn = isDisabled ? null : (order?.burn ?? null);

    // Validate burn direction
    if (burn !== null && (burn < 0 || burn > 5)) {
      return { error: 'Invalid burn direction' };
    }
    if (burn !== null && ship.fuel <= 0) {
      return { error: 'No fuel remaining' };
    }

    // Validate overload
    const overload = isDisabled ? null : (order?.overload ?? null);
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
      applyResupply(ship, map);
    }

    if (course.crashed) {
      ship.destroyed = true;
      ship.velocity = { dq: 0, dr: 0 };
    }

    // Asteroid hazard: roll for each asteroid hex entered at speed > 1
    if (!ship.destroyed) {
      checkAsteroidHazards(ship, course.path, map, events, rng);
    }
  }

  // Check victory/loss after movement
  checkGameEnd(state, map);

  if (state.winner === null) {
    // Advance to combat phase (skip if no enemies in range)
    const hasTargets = hasCombatTargets(state);
    if (hasTargets) {
      state.phase = 'combat';
    } else {
      // Skip combat, go to resupply/end turn
      advanceTurn(state);
    }
  }

  return { movements, events, state };
}

/**
 * Process combat attacks for the active player.
 */
export function processCombat(
  state: GameState,
  playerId: number,
  attacks: CombatAttack[],
  map?: SolarSystemMap,
  rng?: () => number,
): CombatPhaseResult | { error: string } {
  if (state.phase !== 'combat') {
    return { error: 'Not in combat phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const results: CombatResult[] = [];

  for (const attack of attacks) {
    const attackers = attack.attackerIds
      .map(id => state.ships.find(s => s.id === id))
      .filter((s): s is Ship => s !== undefined && s.owner === playerId);

    const target = state.ships.find(s => s.id === attack.targetId);
    if (!target || target.owner === playerId) continue;
    if (target.destroyed) continue;

    // Verify at least one attacker can attack
    if (!attackers.some(s => canAttack(s))) continue;

    const resolution = resolveCombat(attackers, target, state.ships, rng);
    results.push(toCombatResult(resolution));
  }

  // Check game end after combat
  checkGameEnd(state, map);

  // Advance turn
  if (state.winner === null) {
    advanceTurn(state);
  }

  return { results, state };
}

/**
 * Skip combat phase (player has no attacks to make).
 */
export function skipCombat(
  state: GameState,
  playerId: number,
): { state: GameState } | { error: string } {
  if (state.phase !== 'combat') {
    return { error: 'Not in combat phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  advanceTurn(state);
  return { state };
}

/**
 * Advance to the next player's turn after combat/resupply.
 * Handles damage recovery and turn counter.
 */
function advanceTurn(state: GameState): void {
  // Resupply phase: recover 1 disabled turn for each ship
  for (const ship of state.ships) {
    if (ship.owner !== state.activePlayer) continue;
    if (ship.destroyed) continue;
    if (ship.damage.disabledTurns > 0) {
      ship.damage.disabledTurns--;
    }
  }

  // Switch active player
  state.activePlayer = 1 - state.activePlayer;
  if (state.activePlayer === 0) {
    state.turnNumber++;
  }
  state.phase = 'astrogation';
}

/**
 * Check if any enemy ships are within potential combat range.
 */
function hasCombatTargets(state: GameState): boolean {
  const player = state.activePlayer;
  const myShips = state.ships.filter(s => s.owner === player && !s.destroyed && canAttack(s));
  const enemyShips = state.ships.filter(s => s.owner !== player && !s.destroyed);

  // In Triplanetary, gun combat has effectively unlimited range but
  // range modifier makes distant attacks very unlikely to succeed.
  // Show combat phase if there are any living enemies.
  return myShips.length > 0 && enemyShips.length > 0;
}

/**
 * Check asteroid hazards along a ship's path.
 * Ships passing through asteroid hexes at speed > 1 must roll on Other Damage table.
 */
function checkAsteroidHazards(
  ship: Ship,
  path: { q: number; r: number }[],
  map: SolarSystemMap,
  events: MovementEvent[],
  rng?: () => number,
): void {
  const speed = hexVecLength(ship.velocity);
  if (speed <= 1) return;

  // Check each hex in the path (skip starting hex)
  for (let i = 1; i < path.length; i++) {
    const hex = map.hexes.get(hexKey(path[i]));
    if (hex?.terrain !== 'asteroid') continue;

    const dieRoll = rollD6(rng);
    const result = lookupOtherDamage(dieRoll);

    events.push({
      type: 'asteroidHit',
      shipId: ship.id,
      hex: path[i],
      dieRoll,
      damageType: result.type,
      disabledTurns: result.disabledTurns,
    });

    const eliminated = applyDamage(ship, result);
    if (eliminated) break;
  }
}

/**
 * Resupply a ship that has landed at a base.
 */
function applyResupply(ship: Ship, map: SolarSystemMap): void {
  const hex = map.hexes.get(hexKey(ship.position));
  if (!hex?.base) return;

  const stats = SHIP_STATS[ship.type];
  if (stats) {
    ship.fuel = stats.fuel;
    ship.damage = { disabledTurns: 0 };
  }
}

/**
 * Check if the game has ended (victory or all ships destroyed).
 */
function checkGameEnd(state: GameState, map?: SolarSystemMap): void {
  // Check victory: landing on target body (needs map)
  if (map) {
    for (const ship of state.ships) {
      if (ship.destroyed || !ship.landed) continue;
      const targetBody = state.players[ship.owner].targetBody;
      if (!targetBody) continue;
      const hex = map.hexes.get(hexKey(ship.position));
      if (hex?.base?.bodyName === targetBody || hex?.body?.name === targetBody) {
        state.winner = ship.owner;
        state.winReason = `Landed on ${targetBody}!`;
        state.phase = 'gameOver';
        return;
      }
    }

    // Check escape victory: ship moved beyond map bounds
    for (const ship of state.ships) {
      if (ship.destroyed) continue;
      if (!state.players[ship.owner].escapeWins) continue;
      if (hasEscaped(ship.position, map.bounds)) {
        state.winner = ship.owner;
        state.winReason = 'Escaped the solar system!';
        state.phase = 'gameOver';
        return;
      }
    }
  }

  // Check loss: all ships destroyed
  for (let p = 0; p < 2; p++) {
    const alive = state.ships.filter(s => s.owner === p && !s.destroyed);
    if (alive.length === 0) {
      state.winner = 1 - p;
      state.winReason = 'All opponent ships destroyed!';
      state.phase = 'gameOver';
      return;
    }
  }
}

/**
 * Check if a ship has escaped the map bounds.
 */
function hasEscaped(
  pos: { q: number; r: number },
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number },
): boolean {
  const margin = 3;
  return pos.q < bounds.minQ - margin || pos.q > bounds.maxQ + margin ||
         pos.r < bounds.minR - margin || pos.r > bounds.maxR + margin;
}

/**
 * Convert internal CombatResolution to network-safe CombatResult.
 */
function toCombatResult(r: CombatResolution): CombatResult {
  return {
    attackerIds: r.attackerIds,
    targetId: r.targetId,
    odds: r.odds,
    attackStrength: r.attackStrength,
    defendStrength: r.defendStrength,
    rangeMod: r.rangeMod,
    velocityMod: r.velocityMod,
    dieRoll: r.dieRoll,
    modifiedRoll: r.modifiedRoll,
    damageType: r.damageResult.type,
    disabledTurns: r.damageResult.disabledTurns,
    counterattack: r.counterattack ? toCombatResult(r.counterattack) : null,
  };
}
