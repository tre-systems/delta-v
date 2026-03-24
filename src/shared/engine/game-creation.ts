import { SHIP_STATS } from '../constants';
import { hexKey } from '../hex';
import type {
  GameState,
  ScenarioDefinition,
  Ship,
  SolarSystemMap,
} from '../types';
import { CURRENT_GAME_STATE_SCHEMA_VERSION } from '../types';
import { randomChoice } from '../util';
import { parseBaseKey } from './util';

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
      `Scenario must define exactly 2 players, ` +
        `got ${scenario.players.length}`,
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
  position: { q: number; r: number };
  lifecycle: 'active' | 'landed';
} => {
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
      position: parseBaseKey(playerBases[0]),
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
  throw new Error(
    `No valid landed starting hex for ` +
      `${player.homeBody || 'player'} ${def.type}`,
  );
};

// Pure game engine -- no IO, no networking,
// no storage. All game logic lives here so it can
// be unit tested.
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
      const { position, lifecycle } = resolveStartingPlacement(
        def,
        player,
        playerBases[p],
        map,
        findBaseHex,
      );
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
        lifecycle,
        control: 'own' as const,
        heroismAvailable: false,
        overloadUsed: false,
        detected: true,
        pendingGravityEffects: initialGravity,
        damage: { disabledTurns: 0 },
        ...(passengersAboard != null ? { passengersAboard } : {}),
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

  const hasFleetBuilding = [0, 1].some(
    (playerId) => (getScenarioStartingCredits(scenario, playerId) ?? 0) > 0,
  );
  return {
    schemaVersion: CURRENT_GAME_STATE_SCHEMA_VERSION,
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
      logisticsEnabled: scenario.rules?.logisticsEnabled,
      passengerRescueEnabled: scenario.rules?.passengerRescueEnabled,
      targetWinRequiresPassengers: scenario.rules?.targetWinRequiresPassengers,
      reinforcements: scenario.rules?.reinforcements?.map((reinforcement) => ({
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
      })),
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
