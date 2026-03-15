import type {
  GameState, Ship, Ordnance, AstrogationOrder, OrdnanceLaunch,
  ShipMovement, OrdnanceMovement, SolarSystemMap,
  ScenarioDefinition, CombatAttack, CombatResult, MovementEvent,
} from './types';
import { applyPendingGravityEffects, collectEnteredGravityEffects, computeCourse } from './movement';
import { SHIP_STATS, ORDNANCE_MASS, ORDNANCE_LIFETIME, SHIP_DETECTION_RANGE, BASE_DETECTION_RANGE } from './constants';
import { hexKey, hexVecLength, hexDistance, hexAdd, hexSubtract, hexLineDraw, HEX_DIRECTIONS, hexEqual } from './hex';
import {
  resolveCombat, resolveBaseDefense, canAttack, hasLineOfSight, hasLineOfSightToTarget,
  computeGroupRangeModToTarget, computeGroupVelocityModToTarget,
  lookupOtherDamage, lookupGunCombat, applyDamage, rollD6,
  type CombatResolution,
} from './combat';

export interface MovementResult {
  movements: ShipMovement[];
  ordnanceMovements: OrdnanceMovement[];
  events: MovementEvent[];
  state: GameState;
}

export interface StateUpdateResult {
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
        lastMovementPath: [{ ...position }],
        velocity: { ...def.velocity },
        fuel: stats?.fuel ?? 20,
        cargoUsed: 0,
        nukesLaunchedSinceResupply: 0,
        landed,
        destroyed: false,
        detected: true,
        pendingGravityEffects: [],
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
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    players: [
      { connected: true, ready: true, targetBody: scenario.players[0].targetBody, homeBody: scenario.players[0].homeBody, escapeWins: scenario.players[0].escapeWins },
      { connected: true, ready: true, targetBody: scenario.players[1].targetBody, homeBody: scenario.players[1].homeBody, escapeWins: scenario.players[1].escapeWins },
    ],
    winner: null,
    winReason: null,
  };
}

/**
 * Process astrogation orders for the active player.
 * Queues movement orders, then either enters ordnance or resolves movement immediately.
 */
export function processAstrogation(
  state: GameState,
  playerId: number,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
  rng?: () => number,
): MovementResult | StateUpdateResult | { error: string } {
  if (state.phase !== 'astrogation') {
    return { error: 'Not in astrogation phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const validationError = validateAstrogationOrders(state, playerId, orders);
  if (validationError) {
    return { error: validationError };
  }

  state.pendingAstrogationOrders = orders.map(order => ({
    shipId: order.shipId,
    burn: order.burn,
    overload: order.overload ?? null,
    weakGravityChoices: order.weakGravityChoices ? { ...order.weakGravityChoices } : undefined,
  }));

  checkGameEnd(state, map);
  if (state.winner !== null) {
    state.pendingAstrogationOrders = null;
    return { state };
  }

  if (shouldEnterOrdnancePhase(state)) {
    state.phase = 'ordnance';
    return { state };
  }

  return resolveMovementPhase(state, playerId, map, rng);
}

function validateAstrogationOrders(
  state: GameState,
  playerId: number,
  orders: AstrogationOrder[],
): string | null {
  const seenShips = new Set<string>();

  for (const order of orders) {
    if (seenShips.has(order.shipId)) {
      return 'Each ship may receive at most one astrogation order';
    }
    seenShips.add(order.shipId);

    const ship = state.ships.find(s => s.id === order.shipId);
    if (!ship || ship.owner !== playerId || ship.destroyed) {
      return 'Invalid ship for astrogation order';
    }

    const isDisabled = ship.damage.disabledTurns > 0;
    const burn = isDisabled ? null : order.burn;
    const overload = isDisabled ? null : (order.overload ?? null);

    if (burn !== null && (burn < 0 || burn > 5)) {
      return 'Invalid burn direction';
    }
    if (burn !== null && ship.fuel <= 0) {
      return 'No fuel remaining';
    }

    if (overload !== null && (overload < 0 || overload > 5)) {
      return 'Invalid overload direction';
    }
    if (overload !== null) {
      if (burn === null) {
        return 'Overload requires a primary burn';
      }
      const stats = SHIP_STATS[ship.type];
      if (!stats?.canOverload) {
        return 'This ship cannot overload';
      }
      if (ship.fuel < 2) {
        return 'Insufficient fuel for overload';
      }
    }
  }

  return null;
}

function resolveMovementPhase(
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng?: () => number,
): MovementResult {
  const movements: ShipMovement[] = [];
  const ordnanceMovements: OrdnanceMovement[] = [];
  const events: MovementEvent[] = [];
  const queuedOrders = new Map(
    (state.pendingAstrogationOrders ?? []).map(order => [order.shipId, order] as const),
  );
  state.pendingAstrogationOrders = null;

  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    if (ship.destroyed) continue;

    const isDisabled = ship.damage.disabledTurns > 0;
    const order = queuedOrders.get(ship.id);
    const burn = isDisabled ? null : (order?.burn ?? null);
    const overload = isDisabled ? null : (order?.overload ?? null);

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

    ship.position = course.destination;
    ship.lastMovementPath = course.path.map(hex => ({ ...hex }));
    ship.velocity = course.newVelocity;
    ship.fuel -= course.fuelSpent;
    ship.landed = course.landedAt !== null;
    ship.pendingGravityEffects = course.landedAt
      ? []
      : course.enteredGravityEffects.map(effect => ({ ...effect }));

    if (course.landedAt) {
      ship.velocity = { dq: 0, dr: 0 };
      applyResupply(ship, map);
    }

    if (course.crashed) {
      ship.destroyed = true;
      ship.velocity = { dq: 0, dr: 0 };
      ship.pendingGravityEffects = [];
      const crashHex = course.path.find((hex, idx) => idx > 0 && map.hexes.get(hexKey(hex))?.body) ?? course.destination;
      events.push({
        type: 'crash',
        shipId: ship.id,
        hex: crashHex,
        dieRoll: 0,
        damageType: 'eliminated',
        disabledTurns: 0,
      });
    }

    if (!ship.destroyed) {
      queueAsteroidHazards(ship, course.path, course.newVelocity, state, map);
    }
  }

  checkRamming(state, events, rng);
  moveOrdnance(state, map, ordnanceMovements, events, rng);
  updateDetection(state, map);
  checkImmediateVictory(state, map);

  if (state.winner === null) {
    if (shouldEnterCombatPhase(state, map)) {
      state.phase = 'combat';
    } else {
      checkGameEnd(state, map);
      if (state.winner === null) {
        advanceTurn(state);
      }
    }
  }

  return { movements, ordnanceMovements, events, state };
}

/**
 * Resolve automatic combat-step effects that happen before attack declarations.
 */
export function beginCombatPhase(
  state: GameState,
  playerId: number,
  map?: SolarSystemMap,
  rng?: () => number,
): CombatPhaseResult | StateUpdateResult | { error: string } {
  if (state.phase !== 'combat') {
    return { error: 'Not in combat phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const results = resolvePendingAsteroidHazards(state, playerId, rng);
  if (map) {
    checkGameEnd(state, map);
  }
  if (state.winner !== null) {
    return results.length > 0 ? { results, state } : { state };
  }

  if (!shouldRemainInCombatPhase(state, map)) {
    advanceTurn(state);
    return results.length > 0 ? { results, state } : { state };
  }

  return results.length > 0 ? { results, state } : { state };
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

  const results = resolvePendingAsteroidHazards(state, playerId, rng);
  if (state.winner === null) {
    checkGameEnd(state, map);
  }
  if (state.winner !== null) {
    return { results, state };
  }

  const committedAttackers = new Set<string>();
  const committedTargets = new Set<string>();

  for (const attack of attacks) {
    const attackSeen = new Set<string>();
    const attackers: Ship[] = [];

    for (const id of attack.attackerIds) {
      if (attackSeen.has(id) || committedAttackers.has(id)) {
        return { error: 'Each ship may attack only once per combat phase' };
      }

      const ship = state.ships.find(s => s.id === id);
      if (!ship || ship.owner !== playerId || !canAttack(ship)) {
        return { error: 'Invalid attacker selection' };
      }

      attackSeen.add(id);
      attackers.push(ship);
    }

    const targetType = attack.targetType ?? 'ship';
    const targetKey = `${targetType}:${attack.targetId}`;
    if (committedTargets.has(targetKey)) {
      return { error: 'Each ship may be attacked only once per combat phase' };
    }

    for (const attacker of attackers) {
      committedAttackers.add(attacker.id);
    }
    committedTargets.add(targetKey);

    if (targetType === 'ordnance') {
      const target = state.ordnance.find(o => o.id === attack.targetId);
      if (!target || target.owner === playerId || target.destroyed || target.type !== 'nuke') {
        return { error: 'Invalid combat target' };
      }
      if (map && attackers.some(attacker => !hasLineOfSightToTarget(attacker, target, map))) {
        return { error: 'Attacker lacks line of sight to target' };
      }
      results.push(resolveAntiNukeAttack(attackers, target, rng));
      continue;
    }

    const target = state.ships.find(s => s.id === attack.targetId);
    if (!target || target.owner === playerId || target.destroyed) {
      return { error: 'Invalid combat target' };
    }
    if (map && attackers.some(attacker => !hasLineOfSight(attacker, target, map))) {
      return { error: 'Attacker lacks line of sight to target' };
    }

    const resolution = resolveCombat(attackers, target, state.ships, rng, map);
    results.push(toCombatResult(resolution));
  }

  // Base defense fire: active player's bases fire at enemy ships in adjacent gravity hexes
  if (map) {
    const baseResults = resolveBaseDefense(state, playerId, map, rng);
    results.push(...baseResults);
  }

  state.ordnance = state.ordnance.filter(o => !o.destroyed);

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
  map?: SolarSystemMap,
  rng?: () => number,
): { state: GameState; results?: CombatResult[] } | { error: string } {
  if (state.phase !== 'combat') {
    return { error: 'Not in combat phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  const results = resolvePendingAsteroidHazards(state, playerId, rng);
  if (map) {
    checkGameEnd(state, map);
  }
  if (state.winner !== null) {
    return results.length > 0 ? { state, results } : { state };
  }

  // Base defense fire still happens even if player skips
  if (map) {
    const baseResults = resolveBaseDefense(state, playerId, map, rng);
    results.push(...baseResults);
    checkGameEnd(state, map);
  }

  if (state.winner === null) {
    advanceTurn(state);
  }

  return results.length > 0 ? { state, results } : { state };
}

/**
 * Process ordnance launches for the active player.
 * Ships can launch mines/torpedoes/nukes, then the queued movement phase resolves.
 */
export function processOrdnance(
  state: GameState,
  playerId: number,
  launches: OrdnanceLaunch[],
  map: SolarSystemMap,
  rng?: () => number,
): MovementResult | { error: string } {
  if (state.phase !== 'ordnance') {
    return { error: 'Not in ordnance phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  let nextOrdId = state.ordnance.length;
  const launchedShips = new Set<string>();

  for (const launch of launches) {
    // Each ship may launch only 1 item per turn
    if (launchedShips.has(launch.shipId)) {
      return { error: 'Each ship may launch only one ordnance per turn' };
    }

    const ship = state.ships.find(s => s.id === launch.shipId);
    if (!ship || ship.owner !== playerId || ship.destroyed || ship.landed) {
      return { error: 'Invalid ship for ordnance launch' };
    }
    if (ship.damage.disabledTurns > 0) {
      return { error: 'Disabled ships cannot launch ordnance' };
    }

    const mass = ORDNANCE_MASS[launch.ordnanceType];
    if (!mass) return { error: 'Invalid ordnance type' };

    const stats = SHIP_STATS[ship.type];
    if (!stats) return { error: 'Unknown ship type' };

    // Check cargo capacity
    if (ship.cargoUsed + mass > stats.cargo) {
      return { error: 'Insufficient cargo capacity' };
    }

    if (launch.ordnanceType === 'torpedo' && !stats.canOverload) {
      return { error: 'Only warships can launch torpedoes' };
    }
    if (launch.ordnanceType === 'nuke' && !stats.canOverload && (ship.nukesLaunchedSinceResupply ?? 0) >= 1) {
      return { error: 'Non-warships may carry only one nuke between resupplies' };
    }

    // Validate torpedo launch acceleration
    if (launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null) {
      if (launch.torpedoAccel < 0 || launch.torpedoAccel > 5) {
        return { error: 'Invalid torpedo acceleration direction' };
      }
      if (launch.torpedoAccelSteps != null && launch.torpedoAccelSteps !== 1 && launch.torpedoAccelSteps !== 2) {
        return { error: 'Invalid torpedo acceleration distance' };
      }
    } else if (launch.torpedoAccel != null || launch.torpedoAccelSteps != null) {
      return { error: 'Only torpedoes use launch acceleration' };
    }

    // Launch ordnance: inherits ship's velocity
    let velocity = { ...ship.velocity };
    if (launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null) {
      const accelDir = HEX_DIRECTIONS[launch.torpedoAccel];
      const accelSteps = launch.torpedoAccelSteps ?? 1;
      velocity = {
        dq: velocity.dq + accelDir.dq * accelSteps,
        dr: velocity.dr + accelDir.dr * accelSteps,
      };
    }

    state.ordnance.push({
      id: `ord${nextOrdId++}`,
      type: launch.ordnanceType,
      owner: playerId,
      sourceShipId: ship.id,
      position: { ...ship.position },
      velocity,
      turnsRemaining: ORDNANCE_LIFETIME,
      destroyed: false,
      pendingGravityEffects: [],
    });

    ship.cargoUsed += mass;
    if (launch.ordnanceType === 'nuke') {
      ship.nukesLaunchedSinceResupply = (ship.nukesLaunchedSinceResupply ?? 0) + 1;
    }
    launchedShips.add(launch.shipId);
  }

  return resolveMovementPhase(state, playerId, map, rng);
}

/**
 * Skip ordnance phase and resolve the queued movement phase.
 */
export function skipOrdnance(
  state: GameState,
  playerId: number,
  map?: SolarSystemMap,
  rng?: () => number,
): MovementResult | StateUpdateResult | { error: string } {
  if (state.phase !== 'ordnance') {
    return { error: 'Not in ordnance phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  if (!map) {
    if (state.pendingAstrogationOrders) {
      return { error: 'Map required to resolve movement after ordnance' };
    }
    if (hasAnyEnemyShips(state)) {
      state.phase = 'combat';
    } else {
      advanceTurn(state);
    }
    return { state };
  }

  return resolveMovementPhase(state, playerId, map, rng);
}

/**
 * Move all ordnance, then check for detonations against ships and other ordnance.
 */
function moveOrdnance(
  state: GameState,
  map: SolarSystemMap,
  ordnanceMovements: OrdnanceMovement[],
  events: MovementEvent[],
  rng?: () => number,
): void {
  for (const ord of state.ordnance) {
    if (ord.destroyed) continue;

    const from = { ...ord.position };
    const dest = hexAdd(ord.position, ord.velocity);
    const finalDest = applyPendingGravityEffects(dest, ord.pendingGravityEffects);

    const finalPath = hexLineDraw(from, finalDest);
    ord.position = finalDest;
    ord.velocity = hexSubtract(finalDest, from);
    ord.pendingGravityEffects = collectEnteredGravityEffects(finalPath, map);
    ord.turnsRemaining--;

    // Self-destruct
    if (ord.turnsRemaining <= 0) {
      ord.destroyed = true;
    }

    // Crash into celestial bodies
    for (const pathHex of finalPath) {
      const hex = map.hexes.get(hexKey(pathHex));
      if (hex?.body) {
        ord.destroyed = true;
        break;
      }
    }

    const detonated = !ord.destroyed && checkOrdnanceDetonation(ord, state, finalPath, events, map, rng);

    ordnanceMovements.push({
      ordnanceId: ord.id,
      from,
      to: finalDest,
      path: finalPath,
      detonated,
    });

    if (detonated) {
      ord.destroyed = true;
    }
  }

  // Clean up expired ordnance
  state.ordnance = state.ordnance.filter(o => !o.destroyed);
}

/**
 * Check if ordnance detonates by contacting ships along its path.
 * Mines affect all ships in the hex, torpedoes hit single target.
 * Nukes automatically eliminate ships in the detonated hex.
 */
function checkOrdnanceDetonation(
  ord: Ordnance,
  state: GameState,
  path: { q: number; r: number }[],
  events: MovementEvent[],
  map: SolarSystemMap,
  rng?: () => number,
): boolean {
  for (let i = 0; i < path.length; i++) {
    const pathHex = path[i];
    const isLaunchHex = i === 0;
    const key = hexKey(pathHex);
    const mapHex = map.hexes.get(key);
    let forcedDetonation = false;

    if (isAsteroidHex(state, map, pathHex)) {
      if (ord.type === 'nuke') {
        if (!state.destroyedAsteroids.includes(key)) {
          state.destroyedAsteroids.push(key);
        }
        forcedDetonation = true;
      } else {
        return true;
      }
    }

    if (mapHex?.base) {
      if (ord.type === 'nuke') {
        forcedDetonation = true;
      } else {
        return true;
      }
    }

    const contactedShips = state.ships.filter(ship =>
      !ship.destroyed &&
      ship.id !== ord.sourceShipId &&
      (!isLaunchHex || ship.owner !== ord.owner) &&
      hexEqual(ship.position, pathHex),
    );
    const contactedOrdnance = state.ordnance.filter(other =>
      other.id !== ord.id &&
      !other.destroyed &&
      (!isLaunchHex || other.owner !== ord.owner) &&
      hexEqual(other.position, pathHex),
    );

    if (ord.type === 'torpedo') {
      if (resolveTorpedoDetonation(ord, contactedShips, contactedOrdnance, pathHex, events, rng)) {
        return true;
      }
      continue;
    }

    let hitSomething = false;
    for (const ship of contactedShips) {
      const dieRoll = ord.type === 'nuke' ? 0 : rollD6(rng);
      const result = ord.type === 'nuke'
        ? { type: 'eliminated' as const, disabledTurns: 0 }
        : lookupOtherDamage(dieRoll);
      events.push({
        type: ord.type === 'nuke' ? 'nukeDetonation' : 'mineDetonation',
        shipId: ship.id,
        hex: pathHex,
        dieRoll,
        damageType: result.type,
        disabledTurns: result.disabledTurns,
        ordnanceId: ord.id,
      });
      applyDamage(ship, result);
      hitSomething = true;
    }

    for (const other of contactedOrdnance) {
      other.destroyed = true;
      hitSomething = true;
    }

    if (hitSomething || forcedDetonation) {
      return true;
    }
  }

  return false;
}

function resolveTorpedoDetonation(
  ord: Ordnance,
  ships: Ship[],
  contactedOrdnance: Ordnance[],
  hex: { q: number; r: number },
  events: MovementEvent[],
  rng?: () => number,
): boolean {
  if (ships.length === 0 && contactedOrdnance.length === 0) {
    return false;
  }

  const candidates = shuffle(
    [
      ...ships.map(ship => ({ type: 'ship' as const, ship })),
      ...contactedOrdnance.map(other => ({ type: 'ordnance' as const, other })),
    ],
    rng,
  );

  for (const candidate of candidates) {
    if (candidate.type === 'ordnance') {
      candidate.other.destroyed = true;
      return true;
    }

    const dieRoll = rollD6(rng);
    const result = lookupOtherDamage(dieRoll);
    events.push({
      type: 'torpedoHit',
      shipId: candidate.ship.id,
      hex,
      dieRoll,
      damageType: result.type,
      disabledTurns: result.disabledTurns,
      ordnanceId: ord.id,
    });

    if (result.type !== 'none') {
      applyDamage(candidate.ship, result);
      return true;
    }
  }

  return false;
}

function shuffle<T>(items: T[], rng?: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Determine whether the active player should receive an ordnance phase this turn.
 */
function shouldEnterOrdnancePhase(state: GameState): boolean {
  // Check if player has ships capable of launching ordnance
  return state.ships.some(s =>
    s.owner === state.activePlayer && !s.destroyed && !s.landed &&
    s.damage.disabledTurns === 0 &&
    hasOrdnanceCapacity(s),
  );
}

/**
 * Determine whether the active player should enter combat after movement.
 */
function shouldEnterCombatPhase(state: GameState, map: SolarSystemMap): boolean {
  if (state.pendingAsteroidHazards.some(hazard => {
    const ship = state.ships.find(s => s.id === hazard.shipId);
    return ship?.owner === state.activePlayer && !ship.destroyed;
  })) {
    return true;
  }

  if (hasBaseDefenseTargets(state, map)) {
    return true;
  }

  return hasManualCombatTargets(state, map);
}

/**
 * Check if a ship has cargo capacity remaining for ordnance.
 */
function hasOrdnanceCapacity(ship: Ship): boolean {
  const stats = SHIP_STATS[ship.type];
  if (!stats) return false;
  const minMass = ORDNANCE_MASS.mine; // smallest ordnance
  return (stats.cargo - ship.cargoUsed) >= minMass;
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
 * Check if the active player still has any optional combat actions to take.
 */
function shouldRemainInCombatPhase(state: GameState, map?: SolarSystemMap): boolean {
  if (state.pendingAsteroidHazards.some(hazard => {
    const ship = state.ships.find(s => s.id === hazard.shipId);
    return ship?.owner === state.activePlayer && !ship.destroyed;
  })) {
    return true;
  }
  if (!map) {
    return hasAnyEnemyShips(state);
  }
  return hasManualCombatTargets(state, map) || hasBaseDefenseTargets(state, map);
}

function hasAnyEnemyShips(state: GameState): boolean {
  const player = state.activePlayer;
  return state.ships.some(s => s.owner !== player && !s.destroyed);
}

/**
 * Check if the active player's ships can attack enemy ships or nukes.
 */
function hasManualCombatTargets(state: GameState, map: SolarSystemMap): boolean {
  const attackers = state.ships.filter(s => s.owner === state.activePlayer && !s.destroyed && canAttack(s));
  if (attackers.length === 0) return false;

  if (state.ships.some(target =>
    target.owner !== state.activePlayer &&
    !target.destroyed &&
    attackers.some(attacker => hasLineOfSight(attacker, target, map)),
  )) {
    return true;
  }

  return state.ordnance.some(ord =>
    ord.type === 'nuke' &&
    ord.owner !== state.activePlayer &&
    !ord.destroyed &&
    attackers.some(attacker => hasLineOfSightToTarget(attacker, ord, map)),
  );
}

function hasBaseDefenseTargets(state: GameState, map: SolarSystemMap): boolean {
  const homeBody = state.players[state.activePlayer]?.homeBody;
  if (!homeBody) return false;

  for (const [key, hex] of map.hexes) {
    if (!hex.base || hex.base.bodyName !== homeBody) continue;
    const [bq, br] = key.split(',').map(Number);
    for (const ship of state.ships) {
      if (ship.owner === state.activePlayer || ship.destroyed || ship.landed) continue;
      const shipHex = map.hexes.get(hexKey(ship.position));
      if (!shipHex?.gravity || shipHex.gravity.bodyName !== homeBody) continue;
      if (hexDistance(ship.position, { q: bq, r: br }) === 1) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Queue asteroid hazards so they resolve during combat.
 */
function queueAsteroidHazards(
  ship: Ship,
  path: { q: number; r: number }[],
  velocity: { dq: number; dr: number },
  state: GameState,
  map: SolarSystemMap,
): void {
  const speed = hexVecLength(velocity);
  if (speed <= 1) return;

  for (let i = 1; i < path.length; i++) {
    if (!isAsteroidHex(state, map, path[i])) continue;
    state.pendingAsteroidHazards.push({
      shipId: ship.id,
      hex: { ...path[i] },
    });
  }
}

function resolvePendingAsteroidHazards(
  state: GameState,
  playerId: number,
  rng?: () => number,
): CombatResult[] {
  const results: CombatResult[] = [];
  const remaining = [];

  for (const hazard of state.pendingAsteroidHazards) {
    const ship = state.ships.find(s => s.id === hazard.shipId);
    if (!ship || ship.owner !== playerId) {
      remaining.push(hazard);
      continue;
    }
    if (ship.destroyed) {
      continue;
    }

    const dieRoll = rollD6(rng);
    const result = lookupOtherDamage(dieRoll);
    applyDamage(ship, result);
    results.push({
      attackerIds: [],
      targetId: ship.id,
      targetType: 'ship',
      attackType: 'asteroidHazard',
      odds: '-',
      attackStrength: 0,
      defendStrength: 0,
      rangeMod: 0,
      velocityMod: 0,
      dieRoll,
      modifiedRoll: dieRoll,
      damageType: result.type,
      disabledTurns: result.disabledTurns,
      counterattack: null,
    });
  }

  state.pendingAsteroidHazards = remaining;
  return results;
}

function isAsteroidHex(
  state: GameState,
  map: SolarSystemMap,
  coord: { q: number; r: number },
): boolean {
  const key = hexKey(coord);
  const hex = map.hexes.get(key);
  return hex?.terrain === 'asteroid' && !state.destroyedAsteroids.includes(key);
}

/**
 * Check for ramming: opposing ships on the same hex after movement.
 * Both ships roll on the Other Damage table.
 */
function checkRamming(
  state: GameState,
  events: MovementEvent[],
  rng?: () => number,
): void {
  const alive = state.ships.filter(s => !s.destroyed);

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      if (a.owner === b.owner) continue;
      if (!hexEqual(a.position, b.position)) continue;
      // Both landed ships at a base are not ramming
      if (a.landed && b.landed) continue;

      // Ram! Both take Other Damage
      for (const ship of [a, b]) {
        if (ship.destroyed) continue;
        const dieRoll = rollD6(rng);
        const result = lookupOtherDamage(dieRoll);
        events.push({
          type: 'ramming',
          shipId: ship.id,
          hex: ship.position,
          dieRoll,
          damageType: result.type,
          disabledTurns: result.disabledTurns,
        });
        applyDamage(ship, result);
      }
    }
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
    ship.cargoUsed = 0; // restock ordnance
    ship.nukesLaunchedSinceResupply = 0;
    ship.damage = { disabledTurns: 0 };
  }
}

/**
 * Update detection status for all ships.
 * A ship is detected if:
 * - It's within SHIP_DETECTION_RANGE of any opponent ship
 * - It's within BASE_DETECTION_RANGE of any opponent base
 * Once detected, a ship remains detected until it reaches a friendly base.
 * Landing at a friendly base clears detection.
 */
function updateDetection(state: GameState, map: SolarSystemMap): void {
  for (const ship of state.ships) {
    if (ship.destroyed) continue;

    // Landing at a friendly base clears detection
    if (ship.landed) {
      const hex = map.hexes.get(hexKey(ship.position));
      const playerHome = state.players[ship.owner].homeBody;
      if (hex?.base && hex.base.bodyName === playerHome) {
        ship.detected = false;
        continue;
      }
    }

    // If already detected, stays detected (persistent)
    if (ship.detected) continue;

    // Check if within range of any opponent ship
    for (const other of state.ships) {
      if (other.owner === ship.owner || other.destroyed) continue;
      if (hexDistance(ship.position, other.position) <= SHIP_DETECTION_RANGE) {
        ship.detected = true;
        break;
      }
    }

    if (ship.detected) continue;

    // Check if within range of any opponent base
    const opponentHome = state.players[1 - ship.owner].homeBody;
    for (const [key, hex] of map.hexes) {
      if (!hex.base) continue;
      if (hex.base.bodyName !== opponentHome) continue; // Only opponent bases detect
      const [q, r] = key.split(',').map(Number);
      if (hexDistance(ship.position, { q, r }) <= BASE_DETECTION_RANGE) {
        ship.detected = true;
        break;
      }
    }
  }
}

/**
 * Check immediate movement-based victory conditions.
 */
function checkImmediateVictory(state: GameState, map?: SolarSystemMap): void {
  if (!map) return;

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

/**
 * Check if the game has ended (victory or all ships destroyed).
 */
function checkGameEnd(state: GameState, map?: SolarSystemMap): void {
  checkImmediateVictory(state, map);
  if (state.winner !== null) {
    return;
  }

  // Check loss: all ships destroyed
  const alive0 = state.ships.filter(s => s.owner === 0 && !s.destroyed).length;
  const alive1 = state.ships.filter(s => s.owner === 1 && !s.destroyed).length;
  if (alive0 === 0 && alive1 === 0) {
    // Mutual destruction — active player loses (defender wins)
    state.winner = 1 - state.activePlayer;
    state.winReason = 'Mutual destruction — last attacker loses!';
    state.phase = 'gameOver';
    return;
  }
  if (alive0 === 0) {
    state.winner = 1;
    state.winReason = 'All opponent ships destroyed!';
    state.phase = 'gameOver';
    return;
  }
  if (alive1 === 0) {
    state.winner = 0;
    state.winReason = 'All opponent ships destroyed!';
    state.phase = 'gameOver';
    return;
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

function resolveAntiNukeAttack(
  attackers: Ship[],
  target: Ordnance,
  rng?: () => number,
): CombatResult {
  const rangeMod = computeGroupRangeModToTarget(attackers, target);
  const velocityMod = computeGroupVelocityModToTarget(attackers, target);
  const dieRoll = rollD6(rng);
  const modifiedRoll = dieRoll - rangeMod - velocityMod;
  const rolledResult = lookupGunCombat('2:1', modifiedRoll);
  const destroyed = rolledResult.type !== 'none';
  if (destroyed) {
    target.destroyed = true;
  }

  return {
    attackerIds: attackers.map(ship => ship.id),
    targetId: target.id,
    targetType: 'ordnance',
    attackType: 'antiNuke',
    odds: '2:1',
    attackStrength: 0,
    defendStrength: 0,
    rangeMod,
    velocityMod,
    dieRoll,
    modifiedRoll,
    damageType: destroyed ? 'eliminated' : 'none',
    disabledTurns: 0,
    counterattack: null,
  };
}

/**
 * Convert internal CombatResolution to network-safe CombatResult.
 */
function toCombatResult(r: CombatResolution): CombatResult {
  return {
    attackerIds: r.attackerIds,
    targetId: r.targetId,
    targetType: 'ship',
    attackType: 'gun',
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
