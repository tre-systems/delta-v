import { ORDNANCE_LIFETIME, ORDNANCE_MASS, SHIP_STATS } from '../constants';
import { HEX_DIRECTIONS, hexKey } from '../hex';
import { computeCourse } from '../movement';
import type {
  AstrogationOrder,
  FleetPurchase,
  GameState,
  MovementEvent,
  OrdnanceLaunch,
  OrdnanceMovement,
  ScenarioDefinition,
  Ship,
  ShipMovement,
  SolarSystemMap,
} from '../types';
import { randomChoice } from '../util';
import { shouldEnterCombatPhase } from './combat';
import { shouldEnterLogisticsPhase } from './logistics';
import {
  moveOrdnance,
  queueAsteroidHazards,
  shouldEnterOrdnancePhase,
} from './ordnance';
import {
  getNextOrdnanceId,
  getOwnedPlanetaryBases,
  parseBaseKey,
  usesEscapeInspectionRules,
  validateOrdnanceLaunch,
  validatePhaseAction,
} from './util';
import {
  advanceTurn,
  applyCheckpoints,
  applyDetection,
  applyEscapeMoralVictory,
  applyResupply,
  checkCapture,
  checkGameEnd,
  checkImmediateVictory,
  checkInspection,
  checkOrbitalBaseResupply,
  checkRamming,
} from './victory';

export type { CombatPhaseResult } from './combat';
// Re-export public API from sub-modules
// for backward compatibility
export { beginCombatPhase, processCombat, skipCombat } from './combat';
export { processLogistics, processSurrender, skipLogistics } from './logistics';
export { processEmplacement } from './ordnance';
export interface MovementResult {
  movements: ShipMovement[];
  ordnanceMovements: OrdnanceMovement[];
  events: MovementEvent[];
  state: GameState;
}
export interface StateUpdateResult {
  state: GameState;
}
const resolveControlledBases = (
  player: ScenarioDefinition['players'][number],
  map: SolarSystemMap,
): string[] => {
  if (player.bases && player.bases.length > 0) {
    return [...new Set(player.bases.map((base) => hexKey(base)))];
  }
  if (!player.homeBody) {
    return [];
  }
  return [...map.hexes.entries()]
    .filter(([, hex]) => hex.base?.bodyName === player.homeBody)
    .map(([key]) => key);
};
const getScenarioStartingCredits = (
  scenario: ScenarioDefinition,
  playerId: number,
): number | undefined => {
  if (scenario.startingCredits == null) {
    return undefined;
  }
  return Array.isArray(scenario.startingCredits)
    ? scenario.startingCredits[playerId]
    : scenario.startingCredits;
};
const getStartingVisitedBodies = (
  ships: Ship[],
  playerId: number,
  map: SolarSystemMap,
): string[] => {
  const visited = ships
    .filter((ship) => ship.owner === playerId)
    .reduce((acc, ship) => {
      const hex = map.hexes.get(hexKey(ship.position));
      if (hex?.gravity?.bodyName) {
        acc.add(hex.gravity.bodyName);
      }
      if (hex?.body?.name) {
        acc.add(hex.body.name);
      }
      return acc;
    }, new Set<string>());
  return [...visited];
};
const assertScenarioPlayerCount = (scenario: ScenarioDefinition): void => {
  if (scenario.players.length !== 2) {
    throw new Error(
      `Scenario must define exactly 2 players, got ${scenario.players.length}`,
    );
  }
};
const resolveStartingPlacement = (
  def: ScenarioDefinition['players'][number]['ships'][number],
  player: ScenarioDefinition['players'][number],
  playerBases: string[],
  map: SolarSystemMap,
  findBaseHex: (
    map: SolarSystemMap,
    bodyName: string,
  ) => {
    q: number;
    r: number;
  } | null,
): {
  position: {
    q: number;
    r: number;
  };
  landed: boolean;
} => {
  const shouldLand = def.startLanded !== false;
  if (!shouldLand) {
    return {
      position: { ...def.position },
      landed: false,
    };
  }
  const defHex = map.hexes.get(hexKey(def.position));
  if (defHex?.base) {
    return {
      position: { ...def.position },
      landed: true,
    };
  }
  if (playerBases[0]) {
    return {
      position: parseBaseKey(playerBases[0]),
      landed: true,
    };
  }
  if (defHex?.body) {
    return {
      position: { ...def.position },
      landed: true,
    };
  }
  const homeBase = player.homeBody ? findBaseHex(map, player.homeBody) : null;
  if (homeBase) {
    return { position: homeBase, landed: true };
  }
  throw new Error(
    `No valid landed starting hex for ${player.homeBody || 'player'} ${def.type}`,
  );
};
export const filterStateForPlayer = (
  state: GameState,
  playerId: number,
): GameState => {
  if (
    !usesEscapeInspectionRules(state) &&
    !state.ships.some((s) => s.identity?.hasFugitives)
  ) {
    return state;
  }
  return {
    ...state,
    ships: state.ships.map((ship) => {
      if (ship.owner === playerId) {
        return ship;
      }
      if (ship.identity?.revealed) {
        return ship;
      }
      const { identity, ...rest } = ship;
      return rest;
    }),
  };
};
/**
 * Pure game engine -- no IO, no networking,
 * no storage. All game logic lives here so it can
 * be unit tested.
 */
export const createGame = (
  scenario: ScenarioDefinition,
  map: SolarSystemMap,
  gameCode: string,
  findBaseHex: (
    map: SolarSystemMap,
    bodyName: string,
  ) => {
    q: number;
    r: number;
  } | null,
  rng: () => number = Math.random,
): GameState => {
  assertScenarioPlayerCount(scenario);
  const playerBases = scenario.players.map((player) =>
    resolveControlledBases(player, map),
  );
  // Shared bases: add fuel-body bases to both players
  // (Grand Tour race)
  if (scenario.rules?.sharedBases) {
    const sharedBaseKeys = [...map.hexes.entries()]
      .filter(
        ([, hex]) =>
          hex.base && scenario.rules?.sharedBases?.includes(hex.base?.bodyName),
      )
      .map(([key]) => key);
    for (const bases of playerBases) {
      for (const key of sharedBaseKeys) {
        if (!bases.includes(key)) bases.push(key);
      }
    }
  }
  const ships: Ship[] = scenario.players.flatMap((player, p) =>
    player.ships.map((def, s) => {
      const stats = SHIP_STATS[def.type];
      const { position, landed } = resolveStartingPlacement(
        def,
        player,
        playerBases[p],
        map,
        findBaseHex,
      );
      const startHex = map.hexes.get(hexKey(position));
      const initialGravity =
        !landed && def.startInOrbit && startHex?.gravity
          ? [
              {
                hex: { ...position },
                direction: startHex.gravity.direction,
                bodyName: startHex.gravity.bodyName,
                strength: startHex.gravity.strength,
                ignored: false,
              },
            ]
          : [];
      return {
        id: `p${p}s${s}`,
        type: def.type,
        owner: p,
        originalOwner: p,
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
        pendingGravityEffects: initialGravity,
        damage: { disabledTurns: 0 },
      };
    }),
  );
  // Assign fugitive identity for hidden-identity
  // scenarios
  for (const player of scenario.players) {
    if (!player.hiddenIdentity) continue;
    const p = scenario.players.indexOf(player);
    const playerShips = ships.filter((s) => s.owner === p);
    if (playerShips.length === 0) continue;
    for (const ship of playerShips) {
      ship.identity = { hasFugitives: false, revealed: false };
    }
    const fugitive = randomChoice(playerShips, rng);
    if (fugitive.identity) fugitive.identity.hasFugitives = true;
  }
  const hasFleetBuilding = [0, 1].some(
    (playerId) => (getScenarioStartingCredits(scenario, playerId) ?? 0) > 0,
  );
  return {
    gameId: gameCode,
    scenario: scenario.name,
    scenarioRules: {
      allowedOrdnanceTypes: scenario.rules?.allowedOrdnanceTypes
        ? [...scenario.rules.allowedOrdnanceTypes]
        : undefined,
      planetaryDefenseEnabled: scenario.rules?.planetaryDefenseEnabled ?? true,
      hiddenIdentityInspection:
        scenario.rules?.hiddenIdentityInspection ?? false,
      escapeEdge: scenario.rules?.escapeEdge ?? 'any',
      combatDisabled: scenario.rules?.combatDisabled,
      checkpointBodies: scenario.rules?.checkpointBodies
        ? [...scenario.rules.checkpointBodies]
        : undefined,
      sharedBases: scenario.rules?.sharedBases
        ? [...scenario.rules.sharedBases]
        : undefined,
    },
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: hasFleetBuilding ? 'fleetBuilding' : 'astrogation',
    activePlayer: scenario.startingPlayer ?? 0,
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
        ...(scenario.rules?.checkpointBodies
          ? {
              visitedBodies: getStartingVisitedBodies(ships, 0, map),
              totalFuelSpent: 0,
            }
          : {}),
      },
      {
        connected: true,
        ready: !hasFleetBuilding,
        targetBody: scenario.players[1].targetBody,
        homeBody: scenario.players[1].homeBody,
        bases: playerBases[1],
        escapeWins: scenario.players[1].escapeWins,
        credits: getScenarioStartingCredits(scenario, 1),
        ...(scenario.rules?.checkpointBodies
          ? {
              visitedBodies: getStartingVisitedBodies(ships, 1, map),
              totalFuelSpent: 0,
            }
          : {}),
      },
    ],
    winner: null,
    winReason: null,
  };
};
/**
 * Process fleet purchases for a player during
 * the fleet-building phase.
 */
export const processFleetReady = (
  inputState: GameState,
  playerId: number,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
  availableShipTypes?: string[],
):
  | StateUpdateResult
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  if (state.phase !== 'fleetBuilding') {
    return { error: 'Not in fleet building phase' };
  }
  if (playerId !== 0 && playerId !== 1) {
    return { error: 'Invalid player' };
  }
  const player = state.players[playerId];
  const credits = player.credits ?? 0;
  const totalCostOrError = purchases.reduce<
    | {
        cost: number;
      }
    | {
        error: string;
      }
  >(
    (acc, purchase) => {
      if ('error' in acc) return acc;
      const stats = SHIP_STATS[purchase.shipType];
      if (!stats) {
        return {
          error: `Unknown ship type: ${purchase.shipType}`,
        };
      }
      if (purchase.shipType === 'orbitalBase') {
        return {
          error:
            'Cannot purchase orbital bases directly — buy a transport and base cargo',
        };
      }
      if (
        availableShipTypes &&
        !availableShipTypes.includes(purchase.shipType)
      ) {
        return {
          error: `Ship type not available: ${purchase.shipType}`,
        };
      }
      return { cost: acc.cost + stats.cost };
    },
    { cost: 0 },
  );
  if ('error' in totalCostOrError) {
    return totalCostOrError;
  }
  const totalCost = totalCostOrError.cost;
  if (totalCost > credits) {
    return {
      error: `Not enough credits: need ${totalCost}, have ${credits}`,
    };
  }
  const bases = getOwnedPlanetaryBases(state, playerId, map);
  if (bases.length === 0) {
    return {
      error: 'Player has no bases to spawn ships at',
    };
  }
  const existingCount = state.ships.filter((s) => s.owner === playerId).length;
  for (let i = 0; i < purchases.length; i++) {
    const purchase = purchases[i];
    const stats = SHIP_STATS[purchase.shipType];
    const base = bases[i % bases.length];
    const ship: Ship = {
      id: `p${playerId}s${existingCount + i}`,
      type: purchase.shipType,
      owner: playerId,
      originalOwner: playerId,
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
  player.credits = credits - totalCost;
  player.ready = true;
  const otherPlayer = state.players[1 - playerId];
  if (otherPlayer.ready) {
    state.phase = 'astrogation';
  }
  return { state };
};
const validateAstrogationOrders = (
  state: GameState,
  playerId: number,
  orders: AstrogationOrder[],
): string | null => {
  const seenShips = new Set<string>();
  for (const order of orders) {
    if (seenShips.has(order.shipId)) {
      return 'Each ship may receive at most one astrogation order';
    }
    seenShips.add(order.shipId);
    const ship = state.ships.find((s) => s.id === order.shipId);
    if (!ship || ship.owner !== playerId || ship.destroyed) {
      return 'Invalid ship for astrogation order';
    }
    if (ship.baseStatus === 'emplaced') {
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
      if (ship.overloadUsed) {
        return 'Overload already used since last maintenance';
      }
    }
  }
  return null;
};
/**
 * Central movement orchestrator -- resolves queued
 * orders, then runs all post-movement checks
 * (resupply, ramming, ordnance, detection, victory).
 */
const resolveMovementPhase = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng: () => number,
): MovementResult => {
  const movements: ShipMovement[] = [];
  const ordnanceMovements: OrdnanceMovement[] = [];
  const events: MovementEvent[] = [];
  const queuedOrders = new Map(
    (state.pendingAstrogationOrders ?? []).map(
      (order) => [order.shipId, order] as const,
    ),
  );
  state.pendingAstrogationOrders = null;
  for (const ship of state.ships) {
    if (ship.owner !== playerId) continue;
    if (ship.destroyed) continue;
    if (ship.baseStatus === 'emplaced') continue;
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
    ship.lastMovementPath = course.path.map((hex) => ({ ...hex }));
    ship.velocity = course.newVelocity;
    ship.fuel -= course.fuelSpent;
    if (overload !== null) {
      ship.overloadUsed = true;
    }
    ship.landed = course.landedAt !== null;
    ship.pendingGravityEffects = course.landedAt
      ? []
      : course.enteredGravityEffects.map((effect) => ({ ...effect }));
    if (course.landedAt) {
      ship.velocity = { dq: 0, dr: 0 };
      applyResupply(ship, state, map);
    }
    if (course.crashed) {
      ship.destroyed = true;
      ship.velocity = { dq: 0, dr: 0 };
      ship.pendingGravityEffects = [];
      const crashHex =
        course.path.find(
          (hex, idx) => idx > 0 && map.hexes.get(hexKey(hex))?.body,
        ) ?? course.destination;
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
  // Track checkpoint visits and fuel for race
  // scenarios
  if (state.scenarioRules.checkpointBodies) {
    for (const m of movements) {
      const ship = state.ships.find((s) => s.id === m.shipId);
      if (ship && !ship.destroyed) {
        applyCheckpoints(state, ship.owner, m.path, map);
        const totalFuelSpent = state.players[ship.owner].totalFuelSpent;
        if (totalFuelSpent !== undefined) {
          state.players[ship.owner].totalFuelSpent =
            totalFuelSpent + m.fuelSpent;
        }
      }
    }
  }
  checkOrbitalBaseResupply(state, playerId);
  checkInspection(state, playerId);
  checkCapture(state, playerId, events);
  checkRamming(state, events, rng);
  moveOrdnance(state, map, ordnanceMovements, events, rng);
  applyDetection(state, map);
  applyEscapeMoralVictory(state);
  checkImmediateVictory(state, map);
  if (state.winner === null) {
    if (shouldEnterLogisticsPhase(state)) {
      state.phase = 'logistics';
    } else if (shouldEnterCombatPhase(state, map)) {
      state.phase = 'combat';
    } else {
      checkGameEnd(state, map);
      if (state.winner === null) {
        advanceTurn(state);
      }
    }
  }
  return {
    movements,
    ordnanceMovements,
    events,
    state,
  };
};
/**
 * Process astrogation orders for the active player.
 */
export const processAstrogation = (
  inputState: GameState,
  playerId: number,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
  rng: () => number,
):
  | MovementResult
  | StateUpdateResult
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'astrogation');
  if (phaseError) return { error: phaseError };
  const validationError = validateAstrogationOrders(state, playerId, orders);
  if (validationError) {
    return { error: validationError };
  }
  state.pendingAstrogationOrders = orders.map((order) => ({
    shipId: order.shipId,
    burn: order.burn,
    overload: order.overload ?? null,
    weakGravityChoices: order.weakGravityChoices
      ? { ...order.weakGravityChoices }
      : undefined,
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
};
/**
 * Process ordnance launches for the active player.
 */
export const processOrdnance = (
  inputState: GameState,
  playerId: number,
  launches: OrdnanceLaunch[],
  map: SolarSystemMap,
  rng: () => number,
):
  | MovementResult
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'ordnance');
  if (phaseError) return { error: phaseError };
  let nextOrdId = getNextOrdnanceId(state);
  const launchedShips = new Set<string>();
  for (const launch of launches) {
    if (launchedShips.has(launch.shipId)) {
      return {
        error: 'Each ship may launch only one ordnance per turn',
      };
    }
    const ship = state.ships.find((s) => s.id === launch.shipId);
    if (!ship || ship.owner !== playerId) {
      return {
        error: 'Invalid ship for ordnance launch',
      };
    }
    const shipError = validateOrdnanceLaunch(state, ship, launch.ordnanceType);
    if (shipError) return { error: shipError };
    const mass = ORDNANCE_MASS[launch.ordnanceType];
    if (launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null) {
      if (launch.torpedoAccel < 0 || launch.torpedoAccel > 5) {
        return {
          error: 'Invalid torpedo acceleration direction',
        };
      }
      if (
        launch.torpedoAccelSteps != null &&
        launch.torpedoAccelSteps !== 1 &&
        launch.torpedoAccelSteps !== 2
      ) {
        return {
          error: 'Invalid torpedo acceleration distance',
        };
      }
    } else if (
      launch.torpedoAccel != null ||
      launch.torpedoAccelSteps != null
    ) {
      return {
        error: 'Only torpedoes use launch acceleration',
      };
    }
    if (launch.ordnanceType === 'mine') {
      const pendingOrder = (state.pendingAstrogationOrders ?? []).find(
        (o) => o.shipId === ship.id,
      );
      const hasBurn =
        pendingOrder?.burn != null || pendingOrder?.overload != null;
      if (!hasBurn) {
        return {
          error: 'Ship must change course when launching a mine',
        };
      }
    }
    const baseVelocity = { ...ship.velocity };
    const velocity =
      launch.ordnanceType === 'torpedo' && launch.torpedoAccel != null
        ? (() => {
            const accelDir = HEX_DIRECTIONS[launch.torpedoAccel];
            const accelSteps = launch.torpedoAccelSteps ?? 1;
            return {
              dq: baseVelocity.dq + accelDir.dq * accelSteps,
              dr: baseVelocity.dr + accelDir.dr * accelSteps,
            };
          })()
        : baseVelocity;
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
      ship.nukesLaunchedSinceResupply =
        (ship.nukesLaunchedSinceResupply ?? 0) + 1;
    }
    launchedShips.add(launch.shipId);
  }
  return resolveMovementPhase(state, playerId, map, rng);
};
/**
 * Skip ordnance phase and resolve the queued
 * movement phase.
 */
export const skipOrdnance = (
  inputState: GameState,
  playerId: number,
  map: SolarSystemMap,
  rng: () => number,
):
  | MovementResult
  | StateUpdateResult
  | {
      error: string;
    } => {
  const state = structuredClone(inputState);
  const phaseError = validatePhaseAction(state, playerId, 'ordnance');
  if (phaseError) return { error: phaseError };
  return resolveMovementPhase(state, playerId, map, rng);
};
