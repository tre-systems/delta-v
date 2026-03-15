import type {
  GameState, Ship, Ordnance, AstrogationOrder, OrdnanceLaunch,
  OrbitalBaseEmplacement, FleetPurchase,
  ShipMovement, OrdnanceMovement, SolarSystemMap,
  ScenarioDefinition, CombatAttack, CombatResult, MovementEvent,
} from './types';
import { applyPendingGravityEffects, collectEnteredGravityEffects, computeCourse } from './movement';
import { SHIP_STATS, ORDNANCE_MASS, ORDNANCE_LIFETIME, SHIP_DETECTION_RANGE, BASE_DETECTION_RANGE, ORBITAL_BASE_MASS } from './constants';
import { hexKey, hexVecLength, hexDistance, hexAdd, hexSubtract, hexLineDraw, HEX_DIRECTIONS, hexEqual } from './hex';
import {
  resolveCombat, resolveBaseDefense, canAttack, hasLineOfSight, hasLineOfSightToTarget,
  hasBaseLineOfSight,
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

function resolveControlledBases(
  player: ScenarioDefinition['players'][number],
  map: SolarSystemMap,
): string[] {
  if (player.bases && player.bases.length > 0) {
    return [...new Set(player.bases.map(base => hexKey(base)))];
  }

  if (!player.homeBody) {
    return [];
  }

  const ownedBases: string[] = [];
  for (const [key, hex] of map.hexes) {
    if (hex.base?.bodyName === player.homeBody) {
      ownedBases.push(key);
    }
  }
  return ownedBases;
}

function playerControlsBase(state: GameState, playerId: number, baseKey: string): boolean {
  return state.players[playerId]?.bases.includes(baseKey) ?? false;
}

function bodyHasGravity(bodyName: string, map: SolarSystemMap): boolean {
  for (const hex of map.hexes.values()) {
    if (hex.gravity?.bodyName === bodyName) return true;
  }
  return false;
}

function getScenarioStartingCredits(scenario: ScenarioDefinition, playerId: number): number | undefined {
  if (scenario.startingCredits == null) {
    return undefined;
  }
  return Array.isArray(scenario.startingCredits)
    ? scenario.startingCredits[playerId]
    : scenario.startingCredits;
}

function getAllowedOrdnanceTypes(state: Pick<GameState, 'scenarioRules'>): Set<Ordnance['type']> {
  const allowed = state.scenarioRules.allowedOrdnanceTypes;
  if (!allowed || allowed.length === 0) {
    return new Set(['mine', 'torpedo', 'nuke']);
  }
  return new Set(allowed);
}

function isPlanetaryDefenseEnabled(state: Pick<GameState, 'scenarioRules'>): boolean {
  return state.scenarioRules.planetaryDefenseEnabled !== false;
}

function usesEscapeInspectionRules(state: Pick<GameState, 'scenarioRules'>): boolean {
  return state.scenarioRules.hiddenIdentityInspection === true;
}

function getEscapeEdge(state: Pick<GameState, 'scenarioRules'>): 'any' | 'north' {
  return state.scenarioRules.escapeEdge ?? 'any';
}

export function filterStateForPlayer(state: GameState, playerId: number): GameState {
  if (!usesEscapeInspectionRules(state) && !state.ships.some(s => s.hasFugitives)) {
    return state;
  }

  return {
    ...state,
    ships: state.ships.map(ship => {
      if (ship.owner === playerId) {
        return ship;
      }
      if (ship.identityRevealed) {
        return ship;
      }
      const { hasFugitives, identityRevealed, ...rest } = ship;
      return rest;
    }),
  };
}

function getOwnedPlanetaryBases(
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
): { key: string; coord: { q: number; r: number } }[] {
  const bases = state.players[playerId]?.bases ?? [];
  return bases.flatMap(key => {
    if (state.destroyedBases.includes(key)) return [];
    const hex = map.hexes.get(key);
    if (!hex?.base || !bodyHasGravity(hex.base.bodyName, map)) return [];
    const [q, r] = key.split(',').map(Number);
    return [{ key, coord: { q, r } }];
  });
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
  const playerBases = scenario.players.map(player => resolveControlledBases(player, map));

  for (let p = 0; p < scenario.players.length; p++) {
    for (let s = 0; s < scenario.players[p].ships.length; s++) {
      const def = scenario.players[p].ships[s];
      const stats = SHIP_STATS[def.type];
      const shouldLand = def.startLanded !== false;

      let position: { q: number; r: number };
      let landed: boolean;

      if (shouldLand) {
        const ownedBase = playerBases[p][0];
        const baseHex = ownedBase
          ? (() => {
            const [q, r] = ownedBase.split(',').map(Number);
            return { q, r };
          })()
          : (() => {
            const defHex = map.hexes.get(hexKey(def.position));
            if (defHex?.base || defHex?.body) {
              return { ...def.position };
            }
            return findBaseHex(map, scenario.players[p].homeBody);
          })();
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
        resuppliedThisTurn: false,
        landed,
        destroyed: false,
        detected: true,
        identityRevealed: !scenario.players[p].hiddenIdentity,
        pendingGravityEffects: [],
        damage: { disabledTurns: 0 },
      });
    }
  }

  // Assign fugitives for hidden-identity scenarios (e.g. Escape)
  for (let p = 0; p < scenario.players.length; p++) {
    if (scenario.players[p].hiddenIdentity) {
      const playerShips = ships.filter(s => s.owner === p);
      if (playerShips.length > 0) {
        const chosen = playerShips[Math.floor(Math.random() * playerShips.length)];
        chosen.hasFugitives = true;
        for (const ship of playerShips) {
          ship.identityRevealed = false;
        }
      }
    }
  }

  const hasFleetBuilding = [0, 1].some(playerId => (getScenarioStartingCredits(scenario, playerId) ?? 0) > 0);

  return {
    gameId: gameCode,
    scenario: scenario.name,
    scenarioRules: {
      allowedOrdnanceTypes: scenario.rules?.allowedOrdnanceTypes
        ? [...scenario.rules.allowedOrdnanceTypes]
        : undefined,
      planetaryDefenseEnabled: scenario.rules?.planetaryDefenseEnabled ?? true,
      hiddenIdentityInspection: scenario.rules?.hiddenIdentityInspection ?? false,
      escapeEdge: scenario.rules?.escapeEdge ?? 'any',
    },
    turnNumber: 1,
    phase: hasFleetBuilding ? 'fleetBuilding' : 'astrogation',
    activePlayer: 0,
    ships,
    ordnance: [],
    pendingAstrogationOrders: null,
    pendingAsteroidHazards: [],
    destroyedAsteroids: [],
    destroyedBases: [],
    players: [
      {
        connected: true,
        ready: !hasFleetBuilding,
        targetBody: scenario.players[0].targetBody,
        homeBody: scenario.players[0].homeBody,
        bases: playerBases[0],
        escapeWins: scenario.players[0].escapeWins,
        credits: getScenarioStartingCredits(scenario, 0),
      },
      {
        connected: true,
        ready: !hasFleetBuilding,
        targetBody: scenario.players[1].targetBody,
        homeBody: scenario.players[1].homeBody,
        bases: playerBases[1],
        escapeWins: scenario.players[1].escapeWins,
        credits: getScenarioStartingCredits(scenario, 1),
      },
    ],
    winner: null,
    winReason: null,
  };
}

/**
 * Process fleet purchases for a player during the fleet-building phase.
 * Both players submit independently; game starts when both are done.
 */
export function processFleetReady(
  state: GameState,
  playerId: number,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
  availableShipTypes?: string[],
): StateUpdateResult | { error: string } {
  if (state.phase !== 'fleetBuilding') {
    return { error: 'Not in fleet building phase' };
  }
  if (playerId !== 0 && playerId !== 1) {
    return { error: 'Invalid player' };
  }

  const player = state.players[playerId];
  const credits = player.credits ?? 0;

  // Validate and total up purchases
  let totalCost = 0;
  for (const purchase of purchases) {
    const stats = SHIP_STATS[purchase.shipType];
    if (!stats) {
      return { error: `Unknown ship type: ${purchase.shipType}` };
    }
    if (purchase.shipType === 'orbitalBase') {
      return { error: 'Cannot purchase orbital bases directly — buy a transport and base cargo' };
    }
    if (availableShipTypes && !availableShipTypes.includes(purchase.shipType)) {
      return { error: `Ship type not available: ${purchase.shipType}` };
    }
    totalCost += stats.cost;
  }

  if (totalCost > credits) {
    return { error: `Not enough credits: need ${totalCost}, have ${credits}` };
  }

  // Spawn ships at player's bases (round-robin across bases)
  const bases = getOwnedPlanetaryBases(state, playerId, map);
  if (bases.length === 0) {
    return { error: 'Player has no bases to spawn ships at' };
  }

  const existingCount = state.ships.filter(s => s.owner === playerId).length;
  for (let i = 0; i < purchases.length; i++) {
    const purchase = purchases[i];
    const stats = SHIP_STATS[purchase.shipType];
    const base = bases[i % bases.length];

    const ship: Ship = {
      id: `p${playerId}s${existingCount + i}`,
      type: purchase.shipType,
      owner: playerId,
      position: { ...base.coord },
      lastMovementPath: [{ ...base.coord }],
      velocity: { dq: 0, dr: 0 },
      fuel: stats.fuel,
      cargoUsed: 0,
      nukesLaunchedSinceResupply: 0,
      resuppliedThisTurn: false,
      landed: true,
      destroyed: false,
      detected: true,
      pendingGravityEffects: [],
      damage: { disabledTurns: 0 },
    };
    state.ships.push(ship);
  }

  // Deduct credits
  player.credits = credits - totalCost;
  player.ready = true;

  // Check if both players are ready
  const otherPlayer = state.players[1 - playerId];
  if (otherPlayer.ready) {
    // Both players have submitted — start the game
    state.phase = 'astrogation';
  }

  return { state };
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
    if (ship.emplaced) {
      return 'Emplaced orbital bases cannot move';
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
    if (ship.emplaced) continue; // emplaced orbital bases are stationary

    const isDisabled = ship.damage.disabledTurns > 0;
    const order = queuedOrders.get(ship.id);
    const burn = isDisabled ? null : (order?.burn ?? null);
    const overload = isDisabled ? null : (order?.overload ?? null);

    const course = computeCourse(ship, burn, map, {
      overload,
      weakGravityChoices: order?.weakGravityChoices,
      destroyedBases: state.destroyedBases,
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
      applyResupply(ship, state, map);
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

  checkOrbitalBaseResupply(state, playerId);
  checkInspection(state, playerId);
  checkCapture(state, playerId, events);
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

  const committedAttackers = new Map<string, string>();
  const committedTargets = new Set<string>();
  const attackGroups = new Map<string, {
    maxStrength: number;
    allocatedStrength: number;
    targetHexKey: string | null;
    targetType: 'ship' | 'ordnance';
  }>();

  for (const attack of attacks) {
    const attackSeen = new Set<string>();
    const attackers: Ship[] = [];
    const groupKey = [...attack.attackerIds].sort().join('|');

    for (const id of attack.attackerIds) {
      if (attackSeen.has(id)) {
        return { error: 'Each ship may appear at most once in an attack declaration' };
      }
      const existingGroup = committedAttackers.get(id);
      if (existingGroup && existingGroup !== groupKey) {
        return { error: 'Each ship may attack only once per combat phase' };
      }

      const ship = state.ships.find(s => s.id === id);
      if (!ship || ship.owner !== playerId) {
        return { error: 'Invalid attacker selection' };
      }
      if (!existingGroup && !canAttack(ship)) {
        return { error: 'Invalid attacker selection' };
      }

      attackSeen.add(id);
      attackers.push(ship);
    }

    if (attackers.length === 0) {
      return { error: 'Invalid attacker selection' };
    }

    const targetType = attack.targetType ?? 'ship';
    const targetKey = `${targetType}:${attack.targetId}`;
    const maxAttackStrength = attackers.reduce((total, ship) => {
      const stats = SHIP_STATS[ship.type];
      return total + (stats?.combat ?? 0);
    }, 0);
    if (committedTargets.has(targetKey)) {
      return { error: 'Each ship may be attacked only once per combat phase' };
    }

    let group = attackGroups.get(groupKey);
    for (const attacker of attackers) {
      committedAttackers.set(attacker.id, groupKey);
    }
    if (!group) {
      group = {
        maxStrength: maxAttackStrength,
        allocatedStrength: 0,
        targetHexKey: null,
        targetType,
      };
      attackGroups.set(groupKey, group);
    } else if (group.targetType !== targetType) {
      return { error: 'An attacking group cannot split fire between ship and ordnance targets' };
    }

    const remainingStrength = group.maxStrength - group.allocatedStrength;
    if (remainingStrength <= 0) {
      return { error: 'Attack group has no strength remaining to allocate' };
    }
    committedTargets.add(targetKey);

    if (targetType === 'ordnance') {
      if (group.allocatedStrength > 0) {
        return { error: 'Split fire is only supported against ships in the same hex' };
      }
      if (attack.attackStrength != null) {
        return { error: 'Reduced-strength attacks are only supported against ships' };
      }
      const target = state.ordnance.find(o => o.id === attack.targetId);
      if (!target || target.owner === playerId || target.destroyed || target.type !== 'nuke') {
        return { error: 'Invalid combat target' };
      }
      if (map && attackers.some(attacker => !hasLineOfSightToTarget(attacker, target, map))) {
        return { error: 'Attacker lacks line of sight to target' };
      }
      group.allocatedStrength = group.maxStrength;
      results.push(resolveAntiNukeAttack(attackers, target, rng));
      continue;
    }

    const target = state.ships.find(s => s.id === attack.targetId);
    if (!target || target.owner === playerId || target.destroyed || target.landed) {
      return { error: 'Invalid combat target' };
    }
    const targetHexKey = hexKey(target.position);
    if (group.targetHexKey && group.targetHexKey !== targetHexKey) {
      return { error: 'Split fire may only target ships in the same hex' };
    }
    if (attack.attackStrength != null) {
      if (!Number.isInteger(attack.attackStrength) || attack.attackStrength < 1 || attack.attackStrength > remainingStrength) {
        return { error: 'Invalid declared attack strength' };
      }
    }
    if (map && attackers.some(attacker => !hasLineOfSight(attacker, target, map))) {
      return { error: 'Attacker lacks line of sight to target' };
    }

    const allocatedStrength = attack.attackStrength ?? remainingStrength;
    group.targetHexKey = targetHexKey;
    group.allocatedStrength += allocatedStrength;

    const resolution = resolveCombat(attackers, target, state.ships, rng, map, allocatedStrength);
    results.push(toCombatResult(resolution));
  }

  // Base defense fire: active player's bases fire at enemy ships in adjacent gravity hexes
  if (map && isPlanetaryDefenseEnabled(state)) {
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
  if (map && isPlanetaryDefenseEnabled(state)) {
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
  const allowedOrdnanceTypes = getAllowedOrdnanceTypes(state);

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
    if (ship.captured) {
      return { error: 'Captured ships cannot launch ordnance' };
    }
    if (ship.resuppliedThisTurn) {
      return { error: 'Ships cannot launch ordnance during a turn in which they resupply' };
    }

    const mass = ORDNANCE_MASS[launch.ordnanceType];
    if (!mass) return { error: 'Invalid ordnance type' };
    if (!allowedOrdnanceTypes.has(launch.ordnanceType)) {
      return { error: `This scenario does not allow ${launch.ordnanceType} launches` };
    }

    const stats = SHIP_STATS[ship.type];
    if (!stats) return { error: 'Unknown ship type' };

    // Check cargo capacity
    if (ship.cargoUsed + mass > stats.cargo) {
      return { error: 'Insufficient cargo capacity' };
    }

    // Orbital bases can only launch torpedoes (one per turn)
    if (ship.type === 'orbitalBase' && launch.ordnanceType !== 'torpedo') {
      return { error: 'Orbital bases can only launch torpedoes' };
    }
    if (launch.ordnanceType === 'torpedo' && !stats.canOverload && ship.type !== 'orbitalBase') {
      return { error: 'Only warships and orbital bases can launch torpedoes' };
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

    // Mine launch: ship must change course so it doesn't remain in the mine's hex
    if (launch.ordnanceType === 'mine') {
      const pendingOrder = (state.pendingAstrogationOrders ?? []).find(o => o.shipId === ship.id);
      const hasBurn = pendingOrder?.burn != null || pendingOrder?.overload != null;
      if (!hasBurn) {
        return { error: 'Ship must change course when launching a mine' };
      }
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
 * Emplace orbital bases from carrying ships during the ordnance phase.
 * The carrying ship must be in orbit (in a gravity hex, speed 1) or on a world hex side.
 * Creates a new emplaced orbital base ship at the carrier's position.
 */
export function processEmplacement(
  state: GameState,
  playerId: number,
  emplacements: OrbitalBaseEmplacement[],
  map: SolarSystemMap,
): StateUpdateResult | { error: string } {
  if (state.phase !== 'ordnance') {
    return { error: 'Not in ordnance phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  for (const emp of emplacements) {
    const ship = state.ships.find(s => s.id === emp.shipId);
    if (!ship || ship.owner !== playerId || ship.destroyed) {
      return { error: 'Invalid ship for emplacement' };
    }
    if (!ship.carryingOrbitalBase) {
      return { error: 'Ship is not carrying an orbital base' };
    }
    if (ship.type !== 'transport' && ship.type !== 'packet') {
      return { error: 'Only transports and packets can carry orbital bases' };
    }
    if (ship.resuppliedThisTurn) {
      return { error: 'Cannot emplace during a resupply turn' };
    }

    // Must be in orbit (in a gravity hex at speed 1) or on a world hex side
    const posKey = hexKey(ship.position);
    const hex = map.hexes.get(posKey);
    const speed = hexVecLength(ship.velocity);
    const inOrbit = hex?.gravity && speed === 1;
    const onWorldSide = hex?.gravity && ship.landed;

    if (!inOrbit && !onWorldSide) {
      return { error: 'Must be in orbit or on a world hex side to emplace an orbital base' };
    }

    // Create the emplaced orbital base as a new ship
    const baseId = `ob${state.ships.length}`;
    const newBase: Ship = {
      id: baseId,
      type: 'orbitalBase',
      owner: playerId,
      position: { ...ship.position },
      velocity: { ...ship.velocity },
      fuel: Infinity,
      cargoUsed: 0,
      resuppliedThisTurn: false,
      landed: false,
      destroyed: false,
      detected: true,
      emplaced: true,
      pendingGravityEffects: [],
      damage: { disabledTurns: 0 },
    };
    state.ships.push(newBase);

    // Remove orbital base from carrier
    ship.carryingOrbitalBase = false;
    ship.cargoUsed = Math.max(0, ship.cargoUsed - ORBITAL_BASE_MASS);
  }

  return { state };
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

    // Crash into celestial bodies (nukes devastate the entry hex side)
    let nukeDevastated = false;
    for (let pi = 0; pi < finalPath.length; pi++) {
      const hex = map.hexes.get(hexKey(finalPath[pi]));
      if (hex?.body) {
        if (ord.type === 'nuke') {
          nukeDevastated = true;
          // The hex just before the body is the entry side
          const entryHex = pi > 0 ? finalPath[pi - 1] : finalPath[pi];
          const entryKey = hexKey(entryHex);
          // Destroy any base on the entry hex side
          if (map.hexes.get(entryKey)?.base && !state.destroyedBases.includes(entryKey)) {
            state.destroyedBases.push(entryKey);
          }
          // Destroy all ships and ordnance on the entry hex
          for (const ship of state.ships) {
            if (!ship.destroyed && hexEqual(ship.position, entryHex)) {
              ship.destroyed = true;
              ship.velocity = { dq: 0, dr: 0 };
              events.push({
                type: 'nukeDetonation',
                shipId: ship.id,
                hex: entryHex,
                dieRoll: 0,
                damageType: 'eliminated',
                disabledTurns: 0,
                ordnanceId: ord.id,
              });
            }
          }
          for (const other of state.ordnance) {
            if (other.id !== ord.id && !other.destroyed && hexEqual(other.position, entryHex)) {
              other.destroyed = true;
            }
          }
        }
        ord.destroyed = true;
        break;
      }
    }

    const detonated = nukeDevastated || (!ord.destroyed && checkOrdnanceDetonation(ord, state, finalPath, events, map, rng));

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

    if (mapHex?.base && !state.destroyedBases.includes(key)) {
      if (ord.type === 'nuke') {
        if (!state.destroyedBases.includes(key)) {
          state.destroyedBases.push(key);
        }
        forcedDetonation = true;
      } else {
        return true;
      }
    }

    const contactedShips = state.ships.filter(ship =>
      !ship.destroyed &&
      ship.id !== ord.sourceShipId &&
      (!isLaunchHex || ship.owner !== ord.owner) &&
      hexEqual(ship.position, pathHex) &&
      // Landed ships are immune to mines and torpedoes but NOT nukes
      (!ship.landed || ord.type === 'nuke'),
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
  const allowedOrdnanceTypes = getAllowedOrdnanceTypes(state);
  if (allowedOrdnanceTypes.size === 0) {
    return false;
  }

  return state.ships.some(s =>
    s.owner === state.activePlayer && !s.destroyed && !s.landed &&
    s.damage.disabledTurns === 0 && !s.resuppliedThisTurn && !s.captured &&
    hasLaunchableOrdnanceCapacity(s, allowedOrdnanceTypes),
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

  if (isPlanetaryDefenseEnabled(state) && hasBaseDefenseTargets(state, map)) {
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

function hasLaunchableOrdnanceCapacity(ship: Ship, allowedTypes: Set<Ordnance['type']>): boolean {
  const stats = SHIP_STATS[ship.type];
  if (!stats) return false;

  for (const ordnanceType of allowedTypes) {
    const mass = ORDNANCE_MASS[ordnanceType];
    if (mass == null || ship.cargoUsed + mass > stats.cargo) continue;
    if (ship.type === 'orbitalBase' && ordnanceType !== 'torpedo') continue;
    if (ordnanceType === 'torpedo' && !stats.canOverload && ship.type !== 'orbitalBase') continue;
    if (ordnanceType === 'nuke' && !stats.canOverload && (ship.nukesLaunchedSinceResupply ?? 0) >= 1) continue;
    return true;
  }

  return false;
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
    ship.resuppliedThisTurn = false;
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
  return hasManualCombatTargets(state, map) || (isPlanetaryDefenseEnabled(state) && hasBaseDefenseTargets(state, map));
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
    !target.landed &&
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
  for (const { coord: baseCoord } of getOwnedPlanetaryBases(state, state.activePlayer, map)) {
    const baseHex = map.hexes.get(hexKey(baseCoord));
    const bodyName = baseHex?.base?.bodyName;
    if (!bodyName) continue;
    for (const ship of state.ships) {
      if (ship.owner === state.activePlayer || ship.destroyed || ship.landed) continue;
      const shipHex = map.hexes.get(hexKey(ship.position));
      if (!shipHex?.gravity || shipHex.gravity.bodyName !== bodyName) continue;
      if (hexDistance(ship.position, baseCoord) === 1) {
        return true;
      }
    }
    for (const ord of state.ordnance) {
      if (ord.owner === state.activePlayer || ord.destroyed || ord.type !== 'nuke') continue;
      if (hasBaseLineOfSight(baseCoord, ord, map)) {
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
      // Landed or captured ships are immune to ramming
      if (a.landed || b.landed) continue;
      if (a.captured || b.captured) continue;

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
 * Reveal hidden-identity ships when an enemy matches courses with them.
 */
function checkInspection(state: GameState, playerId: number): void {
  if (!usesEscapeInspectionRules(state)) return;

  const inspectingShips = state.ships.filter(ship =>
    ship.owner === playerId &&
    !ship.destroyed &&
    !ship.landed &&
    ship.damage.disabledTurns === 0,
  );

  for (const inspector of inspectingShips) {
    for (const target of state.ships) {
      if (target.owner === playerId || target.destroyed) continue;
      if (target.identityRevealed) continue;
      if (!hexEqual(inspector.position, target.position)) continue;
      if (inspector.velocity.dq !== target.velocity.dq || inspector.velocity.dr !== target.velocity.dr) continue;
      target.identityRevealed = true;
    }
  }
}

/**
 * Check for capture: when the moving player's ship ends on the same hex
 * with the same velocity as a disabled enemy ship, that ship is captured.
 * Captured ships switch owner but cannot act until resupplied at a friendly base.
 */
function checkCapture(
  state: GameState,
  playerId: number,
  events: MovementEvent[],
): void {
  const playerShips = state.ships.filter(s =>
    s.owner === playerId && !s.destroyed && !s.landed && s.damage.disabledTurns === 0,
  );

  for (const captor of playerShips) {
    for (const target of state.ships) {
      if (target.owner === playerId || target.destroyed) continue;
      if (target.damage.disabledTurns <= 0) continue; // must be disabled
      if (target.captured) continue; // already captured
      if (!hexEqual(captor.position, target.position)) continue;
      if (captor.velocity.dq !== target.velocity.dq || captor.velocity.dr !== target.velocity.dr) continue;

      // Capture! Transfer ownership
      target.captured = true;
      target.owner = playerId;
      target.identityRevealed = true;

      events.push({
        type: 'capture',
        shipId: target.id,
        hex: target.position,
        dieRoll: 0,
        damageType: 'captured',
        disabledTurns: 0,
        capturedBy: captor.id,
      });
    }
  }
}

/**
 * Check if any moving player's ships can resupply from friendly emplaced orbital bases.
 * A ship resupplies from an orbital base if they share the same position and velocity.
 * The orbital base cannot fire or launch ordnance on turns when it resupplies.
 */
function checkOrbitalBaseResupply(state: GameState, playerId: number): void {
  const orbitalBases = state.ships.filter(s =>
    s.owner === playerId && !s.destroyed && s.emplaced && s.type === 'orbitalBase',
  );

  for (const ship of state.ships) {
    if (ship.owner !== playerId || ship.destroyed || ship.emplaced) continue;
    if (ship.resuppliedThisTurn) continue; // already resupplied at a landing base

    for (const ob of orbitalBases) {
      if (!hexEqual(ship.position, ob.position)) continue;
      if (ship.velocity.dq !== ob.velocity.dq || ship.velocity.dr !== ob.velocity.dr) continue;

      // Resupply from orbital base
      const stats = SHIP_STATS[ship.type];
      if (stats) {
        ship.fuel = stats.fuel;
        ship.cargoUsed = 0;
        ship.nukesLaunchedSinceResupply = 0;
        ship.damage = { disabledTurns: 0 };
        ship.captured = false;
        ship.resuppliedThisTurn = true;
        ob.resuppliedThisTurn = true; // orbital base can't fire this turn
      }
      break;
    }
  }
}

/**
 * Resupply a ship that has landed at a base.
 */
function applyResupply(ship: Ship, state: GameState, map: SolarSystemMap): void {
  const baseKey = hexKey(ship.position);
  const hex = map.hexes.get(baseKey);
  if (!hex?.base || state.destroyedBases.includes(baseKey)) return;
  if (!playerControlsBase(state, ship.owner, baseKey)) return;

  const stats = SHIP_STATS[ship.type];
  if (stats) {
    ship.fuel = stats.fuel;
    ship.cargoUsed = 0; // restock ordnance
    ship.nukesLaunchedSinceResupply = 0;
    ship.damage = { disabledTurns: 0 };
    ship.captured = false; // base maintenance clears captured status
    ship.resuppliedThisTurn = true;
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
      const key = hexKey(ship.position);
      const hex = map.hexes.get(key);
      if (hex?.base && !state.destroyedBases.includes(key) && playerControlsBase(state, ship.owner, key)) {
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
    for (const key of state.players[1 - ship.owner].bases) {
      const hex = map.hexes.get(key);
      if (!hex?.base) continue;
      if (state.destroyedBases.includes(key)) continue;
      const [q, r] = key.split(',').map(Number);
      if (hexDistance(ship.position, { q, r }) <= BASE_DETECTION_RANGE) {
        ship.detected = true;
        break;
      }
    }
  }
}

function getFugitiveShip(state: GameState): Ship | undefined {
  return state.ships.find(ship => ship.hasFugitives);
}

function fugitiveHasEscaped(state: GameState, ship: Ship, map: SolarSystemMap): boolean {
  const escapeEdge = getEscapeEdge(state);
  if (escapeEdge === 'north') {
    return hasEscapedNorth(ship.position, map.bounds);
  }
  return hasEscaped(ship.position, map.bounds);
}

function hasReturnedCapturedFugitivesToBase(state: GameState, map: SolarSystemMap): boolean {
  const fugitive = getFugitiveShip(state);
  if (!fugitive || fugitive.destroyed || !fugitive.captured || !fugitive.landed) {
    return false;
  }
  const baseKey = hexKey(fugitive.position);
  const baseHex = map.hexes.get(baseKey);
  return !!baseHex?.base && !state.destroyedBases.includes(baseKey) && playerControlsBase(state, fugitive.owner, baseKey);
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
    if (!fugitiveHasEscaped(state, ship, map)) continue;

    const hasFugitiveScenario = state.ships.some(s => s.owner === ship.owner && s.hasFugitives);
    if (hasFugitiveScenario && !ship.hasFugitives) continue;

    state.winner = ship.owner;
    if (ship.hasFugitives) {
      const fuelNeededToStop = hexVecLength(ship.velocity) + 1;
      state.winReason = ship.fuel >= fuelNeededToStop
        ? 'Pilgrims decisive victory — the fugitives escaped beyond Jupiter with fuel to spare!'
        : 'Pilgrims marginal victory — the fugitives escaped beyond Jupiter!';
    } else {
      state.winReason = 'Escaped the solar system!';
    }
    state.phase = 'gameOver';
    return;
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

  if (usesEscapeInspectionRules(state)) {
    const fugitive = getFugitiveShip(state);
    if (fugitive?.destroyed) {
      const opponent = 1 - fugitive.owner;
      state.winner = opponent;
      state.winReason = 'Enforcers marginal victory — the fugitive transport was destroyed.';
      state.phase = 'gameOver';
      return;
    }
    if (map && hasReturnedCapturedFugitivesToBase(state, map)) {
      const fugitiveOwner = fugitive?.owner ?? 1;
      state.winner = fugitiveOwner;
      state.winReason = 'Enforcers decisive victory — the fugitives were captured and returned to base.';
      state.phase = 'gameOver';
      return;
    }
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
    state.winReason = 'Fleet eliminated!';
    state.phase = 'gameOver';
    return;
  }
  if (alive1 === 0) {
    state.winner = 0;
    state.winReason = 'Fleet eliminated!';
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

function hasEscapedNorth(
  pos: { q: number; r: number },
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number },
): boolean {
  const margin = 3;
  return pos.r < bounds.minR - margin;
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
