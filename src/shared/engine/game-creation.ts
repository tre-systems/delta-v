import { SHIP_STATS } from '../constants';
import {
  type HexCoord,
  type HexKey,
  hexKey,
  hexRing,
  parseHexKey,
} from '../hex';
import { asShipId, type GameId } from '../ids';
import type { ScenarioKey } from '../scenario-definitions';
import { SCENARIOS } from '../scenario-definitions';
import {
  CURRENT_GAME_STATE_SCHEMA_VERSION,
  type EngineError,
  ErrorCode,
  type GameState,
  type PlayerId,
  type Result,
  type ScenarioDefinition,
  type Ship,
  type SolarSystemMap,
} from '../types';
import { randomChoice } from '../util';
import { engineError } from './util';

// Reverse-lookup: find the SCENARIOS key for a definition (by reference equality).
// Falls back to matching by name, then casts as a last resort for ad-hoc definitions.
const resolveScenarioKey = (scenario: ScenarioDefinition): ScenarioKey => {
  for (const [key, def] of Object.entries(SCENARIOS)) {
    if (def === scenario || def.name === scenario.name) {
      return key as ScenarioKey;
    }
  }
  return scenario.name as unknown as ScenarioKey;
};

const resolveControlledBases = (
  player: ScenarioDefinition['players'][number],
  map: SolarSystemMap,
): HexKey[] => {
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
  playerId: PlayerId,
): number | undefined => {
  if (scenario.startingCredits == null) {
    return undefined;
  }
  return Array.isArray(scenario.startingCredits)
    ? scenario.startingCredits[playerId]
    : scenario.startingCredits;
};

const validateScenarioPlayerCount = (
  scenario: ScenarioDefinition,
): EngineError | null => {
  if (scenario.players.length !== 2) {
    return engineError(
      ErrorCode.INVALID_INPUT,
      `Scenario must define exactly 2 players, ` +
        `got ${scenario.players.length}`,
    );
  }
  return null;
};

// Fail fast if a scenario references a body that no longer exists on
// the map (typo in a new scenario, a body rename, etc.). The live
// engine otherwise silently falls back to "no valid landed starting
// hex", which points at the scenario rather than the unknown name.
// Skipped when the map has no bodies — test harnesses construct empty
// maps for focused engine assertions and deliberately bypass map-level
// constraints.
const validateScenarioBodyReferences = (
  scenario: ScenarioDefinition,
  map: SolarSystemMap,
): EngineError | null => {
  if (map.bodies.length === 0) return null;
  const knownBodyNames = new Set(map.bodies.map((b) => b.name));
  for (const player of scenario.players) {
    if (player.homeBody && !knownBodyNames.has(player.homeBody)) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Scenario ${scenario.name} references unknown body ` +
          `"${player.homeBody}" in player.homeBody`,
      );
    }
    if (player.targetBody && !knownBodyNames.has(player.targetBody)) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Scenario ${scenario.name} references unknown body ` +
          `"${player.targetBody}" in player.targetBody`,
      );
    }
  }
  for (const checkpointBody of scenario.rules?.checkpointBodies ?? []) {
    if (!knownBodyNames.has(checkpointBody)) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Scenario ${scenario.name} references unknown body ` +
          `"${checkpointBody}" in rules.checkpointBodies`,
      );
    }
  }
  for (const sharedBaseBody of scenario.rules?.sharedBases ?? []) {
    if (!knownBodyNames.has(sharedBaseBody)) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Scenario ${scenario.name} references unknown body ` +
          `"${sharedBaseBody}" in rules.sharedBases`,
      );
    }
  }
  return null;
};

const isWithinBounds = (position: HexCoord, map: SolarSystemMap): boolean => {
  const { minQ, maxQ, minR, maxR } = map.bounds;
  return (
    position.q >= minQ &&
    position.q <= maxQ &&
    position.r >= minR &&
    position.r <= maxR
  );
};

const getBodySurfaceHexes = (
  body: SolarSystemMap['bodies'][number],
): HexCoord[] =>
  body.surfaceRadius === 0
    ? [body.center]
    : [
        body.center,
        ...Array.from({ length: body.surfaceRadius }, (_, index) =>
          hexRing(body.center, index + 1),
        ).flat(),
      ];

const validateMapBounds = (map: SolarSystemMap): EngineError | null => {
  for (const key of map.hexes.keys()) {
    const coord = parseHexKey(key);
    if (!isWithinBounds(coord, map)) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Map bounds exclude occupied hex ${key}`,
      );
    }
  }

  for (const body of map.bodies) {
    if (!isWithinBounds(body.center, map)) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Map bounds exclude body center "${body.name}"`,
      );
    }
  }

  return null;
};

const validateMapBodies = (map: SolarSystemMap): EngineError | null => {
  if (map.bodies.length === 0) return null;

  const seenNames = new Set<string>();
  const occupiedSurfaceHexes = new Map<HexKey, string>();

  for (const body of map.bodies) {
    if (seenNames.has(body.name)) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Map defines duplicate body "${body.name}"`,
      );
    }
    seenNames.add(body.name);

    for (const surfaceHex of getBodySurfaceHexes(body)) {
      const key = hexKey(surfaceHex);
      const occupant = occupiedSurfaceHexes.get(key);

      if (occupant) {
        return engineError(
          ErrorCode.INVALID_INPUT,
          `Map bodies "${occupant}" and "${body.name}" overlap at ${key}`,
        );
      }
      occupiedSurfaceHexes.set(key, body.name);
    }

    const centerHex = map.hexes.get(hexKey(body.center));
    if (centerHex?.body?.name !== body.name) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Map body "${body.name}" is missing a matching center hex`,
      );
    }
  }

  return null;
};

const validateScenarioRuleCombinations = (
  scenario: ScenarioDefinition,
): EngineError | null => {
  if (
    scenario.rules?.targetWinRequiresPassengers &&
    !scenario.rules?.passengerRescueEnabled
  ) {
    return engineError(
      ErrorCode.INVALID_INPUT,
      `Scenario ${scenario.name} enables targetWinRequiresPassengers ` +
        `without passengerRescueEnabled`,
    );
  }

  if (
    scenario.rules?.hiddenIdentityInspection &&
    !scenario.players.some((player) => player.hiddenIdentity)
  ) {
    return engineError(
      ErrorCode.INVALID_INPUT,
      `Scenario ${scenario.name} enables hiddenIdentityInspection ` +
        `without any hiddenIdentity player`,
    );
  }

  return null;
};

const validateScenarioBaseAssignments = (
  scenario: ScenarioDefinition,
  map: SolarSystemMap,
): EngineError | null => {
  if (map.bodies.length === 0) return null;

  for (const [playerIndex, player] of scenario.players.entries()) {
    for (const base of player.bases ?? []) {
      const key = hexKey(base);
      const hex = map.hexes.get(key);

      if (!hex) {
        return engineError(
          ErrorCode.INVALID_INPUT,
          `Scenario ${scenario.name} references off-map base ${key} ` +
            `for player ${playerIndex}`,
        );
      }
      if (!hex.base) {
        return engineError(
          ErrorCode.INVALID_INPUT,
          `Scenario ${scenario.name} references non-base hex ${key} ` +
            `for player ${playerIndex}`,
        );
      }
    }
  }

  for (const bodyName of scenario.rules?.sharedBases ?? []) {
    const hasBase = [...map.hexes.values()].some(
      (hex) => hex.base?.bodyName === bodyName,
    );

    if (!hasBase) {
      return engineError(
        ErrorCode.INVALID_INPUT,
        `Scenario ${scenario.name} shares bases on "${bodyName}" ` +
          `but the map has no base hexes for that body`,
      );
    }
  }

  return null;
};

const validateScenarioShipPlacements = (
  scenario: ScenarioDefinition,
  map: SolarSystemMap,
): EngineError | null => {
  for (const [playerIndex, player] of scenario.players.entries()) {
    for (const ship of player.ships) {
      if (!isWithinBounds(ship.position, map)) {
        return engineError(
          ErrorCode.INVALID_INPUT,
          `Scenario ${scenario.name} places player ${playerIndex} ` +
            `${ship.type} outside map bounds at ${hexKey(ship.position)}`,
        );
      }

      if (ship.startLanded !== false && ship.startInOrbit) {
        return engineError(
          ErrorCode.INVALID_INPUT,
          `Scenario ${scenario.name} marks player ${playerIndex} ` +
            `${ship.type} as both startLanded and startInOrbit`,
        );
      }

      if (ship.startLanded === false) {
        const startHex = map.hexes.get(hexKey(ship.position));

        if (startHex?.body) {
          return engineError(
            ErrorCode.INVALID_INPUT,
            `Scenario ${scenario.name} places active player ${playerIndex} ` +
              `${ship.type} on body surface at ${hexKey(ship.position)}`,
          );
        }
      }
    }
  }

  return null;
};

type PlacementResult =
  | { position: { q: number; r: number }; lifecycle: 'active' | 'landed' }
  | { error: EngineError };

const resolveStartingPlacement = (
  def: ScenarioDefinition['players'][number]['ships'][number],
  player: ScenarioDefinition['players'][number],
  playerBases: HexKey[],
  map: SolarSystemMap,
  findBaseHex: (
    map: SolarSystemMap,
    bodyName: string,
  ) => {
    q: number;
    r: number;
  } | null,
): PlacementResult => {
  const shouldLand = def.startLanded !== false;

  if (!shouldLand) {
    return {
      position: { ...def.position },
      lifecycle: 'active',
    };
  }
  const defHex = map.hexes.get(hexKey(def.position));

  if (defHex?.base) {
    return {
      position: { ...def.position },
      lifecycle: 'landed',
    };
  }

  if (playerBases[0]) {
    return {
      position: parseHexKey(playerBases[0]),
      lifecycle: 'landed',
    };
  }

  if (defHex?.body) {
    return {
      position: { ...def.position },
      lifecycle: 'landed',
    };
  }
  const homeBase = player.homeBody ? findBaseHex(map, player.homeBody) : null;

  if (homeBase) {
    return { position: homeBase, lifecycle: 'landed' };
  }
  return {
    error: engineError(
      ErrorCode.INVALID_INPUT,
      `No valid landed starting hex for ` +
        `${player.homeBody || 'player'} ${def.type}`,
    ),
  };
};

// Pure game engine -- no IO, no networking,
// no storage. All game logic lives here so it can
// be unit tested.
export const createGame = (
  scenario: ScenarioDefinition,
  map: SolarSystemMap,
  gameCode: GameId,
  findBaseHex: (
    map: SolarSystemMap,
    bodyName: string,
  ) => {
    q: number;
    r: number;
  } | null,
  rng: () => number = Math.random,
  scenarioKey?: ScenarioKey,
): Result<GameState, EngineError> => {
  const playerCountError = validateScenarioPlayerCount(scenario);

  if (playerCountError) {
    return { ok: false, error: playerCountError };
  }

  const bodyRefError = validateScenarioBodyReferences(scenario, map);
  if (bodyRefError) {
    return { ok: false, error: bodyRefError };
  }
  const mapBoundsError = validateMapBounds(map);
  if (mapBoundsError) {
    return { ok: false, error: mapBoundsError };
  }
  const mapBodiesError = validateMapBodies(map);
  if (mapBodiesError) {
    return { ok: false, error: mapBodiesError };
  }
  const ruleCombinationError = validateScenarioRuleCombinations(scenario);
  if (ruleCombinationError) {
    return { ok: false, error: ruleCombinationError };
  }
  const baseAssignmentError = validateScenarioBaseAssignments(scenario, map);
  if (baseAssignmentError) {
    return { ok: false, error: baseAssignmentError };
  }
  const shipPlacementError = validateScenarioShipPlacements(scenario, map);
  if (shipPlacementError) {
    return { ok: false, error: shipPlacementError };
  }
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
  const ships: Ship[] = [];

  for (let p = 0; p < scenario.players.length; p++) {
    const player = scenario.players[p];

    for (let s = 0; s < player.ships.length; s++) {
      const def = player.ships[s];
      const playerIdx = p as PlayerId;
      const stats = SHIP_STATS[def.type];
      const placement = resolveStartingPlacement(
        def,
        player,
        playerBases[p],
        map,
        findBaseHex,
      );

      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }

      const { position, lifecycle } = placement;
      const startHex = map.hexes.get(hexKey(position));
      const initialGravity =
        lifecycle === 'active' && def.startInOrbit && startHex?.gravity
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
      const passengersAboard =
        def.initialPassengers != null && def.initialPassengers > 0
          ? def.initialPassengers
          : undefined;
      ships.push({
        id: asShipId(`p${p}s${s}`),
        type: def.type,
        owner: playerIdx,
        originalOwner: playerIdx,
        position,
        lastMovementPath: [{ ...position }],
        velocity: { ...def.velocity },
        fuel: stats?.fuel ?? 20,
        cargoUsed: 0,
        nukesLaunchedSinceResupply: 0,
        resuppliedThisTurn: false,
        lifecycle,
        control: 'own' as const,
        heroismAvailable: false,
        overloadUsed: false,
        detected: false,
        pendingGravityEffects: initialGravity,
        damage: { disabledTurns: 0 },
        ...(passengersAboard != null ? { passengersAboard } : {}),
      });
    }
  }
  // Assign fugitive identity for hidden-identity
  // scenarios
  for (const player of scenario.players) {
    if (!player.hiddenIdentity) continue;
    const p = scenario.players.indexOf(player) as PlayerId;
    const playerShips = ships.filter((s) => s.owner === p);

    if (playerShips.length === 0) continue;
    for (const ship of playerShips) {
      ship.identity = {
        hasFugitives: false,
        revealed: false,
      };
    }

    const fugitive = randomChoice(playerShips, rng);

    if (fugitive.identity) {
      fugitive.identity.hasFugitives = true;
    }
  }

  const hasFleetBuilding = ([0, 1] as PlayerId[]).some(
    (playerId) => (getScenarioStartingCredits(scenario, playerId) ?? 0) > 0,
  );
  const activePlayer = scenario.rules?.randomizeStartingPlayer
    ? ((rng() < 0.5 ? 0 : 1) as PlayerId)
    : (scenario.startingPlayer ?? 0);

  return {
    ok: true,
    value: {
      schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
      gameId: gameCode,
      scenario: scenarioKey ?? resolveScenarioKey(scenario),
      scenarioRules: {
        allowedOrdnanceTypes: scenario.rules?.allowedOrdnanceTypes
          ? [...scenario.rules.allowedOrdnanceTypes]
          : undefined,
        availableFleetPurchases: scenario.availableFleetPurchases
          ? [...scenario.availableFleetPurchases]
          : undefined,
        planetaryDefenseEnabled:
          scenario.rules?.planetaryDefenseEnabled ?? true,
        hiddenIdentityInspection:
          scenario.rules?.hiddenIdentityInspection ?? false,
        escapeEdge: scenario.rules?.escapeEdge ?? 'any',
        combatDisabled: scenario.rules?.combatDisabled,
        checkpointBodies: scenario.rules?.checkpointBodies
          ? [...scenario.rules.checkpointBodies]
          : undefined,
        randomizeStartingPlayer: scenario.rules?.randomizeStartingPlayer,
        sharedBases: scenario.rules?.sharedBases
          ? [...scenario.rules.sharedBases]
          : undefined,
        logisticsEnabled: scenario.rules?.logisticsEnabled,
        passengerRescueEnabled: scenario.rules?.passengerRescueEnabled,
        targetWinRequiresPassengers:
          scenario.rules?.targetWinRequiresPassengers,
        reinforcements: scenario.rules?.reinforcements?.map(
          (reinforcement) => ({
            turn: reinforcement.turn,
            playerId: reinforcement.playerId,
            ships: reinforcement.ships.map((ship) => ({
              type: ship.type,
              position: { ...ship.position },
              velocity: { ...ship.velocity },
              startLanded: ship.startLanded,
              startInOrbit: ship.startInOrbit,
              ...(ship.initialPassengers != null && ship.initialPassengers > 0
                ? { initialPassengers: ship.initialPassengers }
                : {}),
            })),
          }),
        ),
        fleetConversion: scenario.rules?.fleetConversion
          ? {
              turn: scenario.rules.fleetConversion.turn,
              fromPlayer: scenario.rules.fleetConversion.fromPlayer,
              toPlayer: scenario.rules.fleetConversion.toPlayer,
              shipTypes: scenario.rules.fleetConversion.shipTypes
                ? [...scenario.rules.fleetConversion.shipTypes]
                : undefined,
            }
          : undefined,
        aiConfigOverrides: scenario.rules?.aiConfigOverrides
          ? { ...scenario.rules.aiConfigOverrides }
          : undefined,
      },
      escapeMoralVictoryAchieved: false,
      turnNumber: 1,
      phase: hasFleetBuilding ? 'fleetBuilding' : 'astrogation',
      activePlayer,
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
                visitedBodies: [],
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
                visitedBodies: [],
                totalFuelSpent: 0,
              }
            : {}),
        },
      ],
      outcome: null,
    },
  };
};

// Convenience wrapper for tests and local play that unwraps the Result,
// throwing on error. Production callers should use createGame directly.
export const createGameOrThrow = (
  ...args: Parameters<typeof createGame>
): GameState => {
  const result = createGame(...args);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
};
