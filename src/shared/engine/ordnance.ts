import { applyDamage, lookupOtherDamage, rollD6 } from '../combat';
import {
  isBaseCarrierType,
  ORBITAL_BASE_MASS,
  ORDNANCE_LIFETIME,
} from '../constants';
import {
  analyzeHexLine,
  hexAdd,
  hexEqual,
  hexKey,
  hexLineDraw,
  hexSubtract,
  hexVecLength,
} from '../hex';
import { asShipId } from '../ids';
import {
  applyPendingGravityEffects,
  collectEnteredGravityEffects,
} from '../movement';
import {
  type CombatResult,
  type EngineError,
  ErrorCode,
  type GameState,
  type MovementEvent,
  type OrbitalBaseEmplacement,
  type Ordnance,
  type OrdnanceMovement,
  type PlayerId,
  type Ship,
  type ShipMovement,
  type SolarSystemMap,
} from '../types';
import type { EngineEvent } from './engine-events';
import {
  engineError,
  engineFailure,
  getAllowedOrdnanceTypes,
  hasValidOrdnanceLaunch,
  shuffle,
  validatePhaseAction,
} from './util';

const isWorldSideUnoccupiedForEmplacement = (
  state: Pick<GameState, 'ships'>,
  ship: Ship,
  map: SolarSystemMap,
): boolean => {
  const hex = map.hexes.get(hexKey(ship.position));

  if (!hex?.gravity || hex.base) {
    return false;
  }

  return !state.ships.some(
    (other) =>
      other.id !== ship.id &&
      other.lifecycle !== 'destroyed' &&
      hexEqual(other.position, ship.position) &&
      (other.lifecycle === 'landed' || other.baseStatus === 'emplaced'),
  );
};

const canEmplaceBaseFromCurrentPosition = (
  state: Pick<GameState, 'ships'>,
  ship: Ship,
  map: SolarSystemMap,
): boolean => {
  const hex = map.hexes.get(hexKey(ship.position));

  if (!hex?.gravity) {
    return false;
  }

  if (ship.lifecycle === 'landed') {
    return isWorldSideUnoccupiedForEmplacement(state, ship, map);
  }

  return hexVecLength(ship.velocity) === 1;
};

export const validateBaseEmplacement = (
  state: Pick<GameState, 'ships'>,
  ship: Ship,
  map: SolarSystemMap,
): EngineError | null => {
  if (ship.lifecycle === 'destroyed') {
    return engineError(
      ErrorCode.STATE_CONFLICT,
      'Destroyed ships cannot emplace orbital bases',
    );
  }

  if (ship.baseStatus !== 'carryingBase') {
    return engineError(
      ErrorCode.STATE_CONFLICT,
      'Ship is not carrying an orbital base',
    );
  }

  if (!isBaseCarrierType(ship.type)) {
    return engineError(
      ErrorCode.NOT_ALLOWED,
      'Only transports and packets can carry orbital bases',
    );
  }

  if (ship.control === 'captured') {
    return engineError(
      ErrorCode.NOT_ALLOWED,
      'Captured ships cannot emplace orbital bases',
    );
  }

  if (ship.resuppliedThisTurn) {
    return engineError(
      ErrorCode.NOT_ALLOWED,
      'Cannot emplace during a resupply turn',
    );
  }

  if (ship.damage.disabledTurns > 0) {
    return engineError(
      ErrorCode.STATE_CONFLICT,
      'Disabled ships cannot emplace orbital bases',
    );
  }

  if (!canEmplaceBaseFromCurrentPosition(state, ship, map)) {
    return engineError(
      ErrorCode.NOT_ALLOWED,
      'Must be in orbit or on an open world hex side to emplace an orbital base',
    );
  }

  return null;
};

// Determine whether the active player should receive
// an ordnance phase this turn.
export const shouldEnterOrdnancePhase = (
  state: GameState,
  map: SolarSystemMap,
): boolean => {
  const hasEmplaceableBase = state.ships.some((ship) => {
    if (ship.owner !== state.activePlayer) {
      return false;
    }

    return validateBaseEmplacement(state, ship, map) === null;
  });

  if (hasEmplaceableBase) {
    return true;
  }

  const allowedOrdnanceTypes = getAllowedOrdnanceTypes(state);

  if (allowedOrdnanceTypes.size === 0) {
    return false;
  }

  return state.ships.some(
    (s) =>
      s.owner === state.activePlayer &&
      s.lifecycle === 'active' &&
      s.damage.disabledTurns === 0 &&
      !s.resuppliedThisTurn &&
      s.control !== 'captured' &&
      hasValidOrdnanceLaunch(state, s, allowedOrdnanceTypes, map),
  );
};

// Emplace orbital bases from carrying ships during
// the ordnance phase.
export const processEmplacement = (
  inputState: GameState,
  playerId: PlayerId,
  emplacements: OrbitalBaseEmplacement[],
  map: SolarSystemMap,
):
  | { state: GameState; engineEvents: EngineEvent[] }
  | { error: EngineError } => {
  const state = structuredClone(inputState);
  const engineEvents: EngineEvent[] = [];

  const phaseError = validatePhaseAction(state, playerId, 'ordnance');

  if (phaseError) return engineFailure(phaseError.code, phaseError.message);

  for (const emp of emplacements) {
    const ship = state.ships.find((s) => s.id === emp.shipId);

    if (!ship || ship.owner !== playerId || ship.lifecycle === 'destroyed') {
      return engineFailure(
        ErrorCode.INVALID_SHIP,
        'Invalid ship for emplacement',
      );
    }

    const emplacementError = validateBaseEmplacement(state, ship, map);

    if (emplacementError) {
      return engineFailure(emplacementError.code, emplacementError.message);
    }

    const baseId = asShipId(`ob${state.ships.length}`);

    const newBase: Ship = {
      id: baseId,
      type: 'orbitalBase',
      owner: playerId,
      originalOwner: playerId,
      position: { ...ship.position },
      velocity: { ...ship.velocity },
      fuel: Infinity,
      cargoUsed: 0,
      nukesLaunchedSinceResupply: 0,
      resuppliedThisTurn: false,
      lifecycle: 'active',
      control: 'own',
      heroismAvailable: false,
      overloadUsed: false,
      detected: true,
      baseStatus: 'emplaced',
      pendingGravityEffects: [],
      damage: { disabledTurns: 0 },
    };

    state.ships.push(newBase);

    engineEvents.push({
      type: 'baseEmplaced',
      shipId: baseId,
      sourceShipId: ship.id,
      owner: playerId,
      position: { ...ship.position },
      velocity: { ...ship.velocity },
    });

    ship.baseStatus = undefined;
    ship.cargoUsed = Math.max(0, ship.cargoUsed - ORBITAL_BASE_MASS);
  }

  return { state, engineEvents };
};

// Check if a hex is an asteroid that hasn't been
// destroyed.
export const isAsteroidHex = (
  state: GameState,
  map: SolarSystemMap,
  coord: { q: number; r: number },
): boolean => {
  const key = hexKey(coord);
  const hex = map.hexes.get(key);

  return hex?.terrain === 'asteroid' && !state.destroyedAsteroids.includes(key);
};

const pushDestroyedAsteroid = (
  state: GameState,
  coord: { q: number; r: number },
  engineEvents?: EngineEvent[],
): void => {
  const key = hexKey(coord);

  if (!state.destroyedAsteroids.includes(key)) {
    state.destroyedAsteroids.push(key);
    engineEvents?.push({
      type: 'asteroidDestroyed',
      hex: { ...coord },
    });
  }
};

const pushDestroyedBase = (
  state: GameState,
  coord: { q: number; r: number },
  engineEvents?: EngineEvent[],
): void => {
  const key = hexKey(coord);

  if (!state.destroyedBases.includes(key)) {
    state.destroyedBases.push(key);
    engineEvents?.push({
      type: 'baseDestroyed',
      hex: { ...coord },
    });
  }
};

const pushDestroyedOrdnance = (
  ordnanceId: import('../ids').OrdnanceId,
  cause: string,
  engineEvents?: EngineEvent[],
): void => {
  if (
    engineEvents?.some(
      (event) =>
        event.type === 'ordnanceDestroyed' && event.ordnanceId === ordnanceId,
    )
  ) {
    return;
  }

  engineEvents?.push({
    type: 'ordnanceDestroyed',
    ordnanceId,
    cause,
  });
};

const resolveTorpedoDetonation = (
  ord: Ordnance,
  ships: Ship[],
  contactedOrdnance: Ordnance[],
  hex: { q: number; r: number },
  events: MovementEvent[],
  rng: () => number,
  engineEvents?: EngineEvent[],
): boolean => {
  if (ships.length === 0 && contactedOrdnance.length === 0) {
    return false;
  }

  const candidates = shuffle(
    [
      ...ships.map((ship) => ({
        type: 'ship' as const,
        ship,
      })),
      ...contactedOrdnance.map((other) => ({
        type: 'ordnance' as const,
        other,
      })),
    ],
    rng,
  );

  for (const candidate of candidates) {
    if (candidate.type === 'ordnance') {
      candidate.other.lifecycle = 'destroyed';
      engineEvents?.push({
        type: 'ordnanceDetonated',
        ordnanceId: ord.id,
        ordnanceType: 'torpedo',
        hex,
        roll: 0,
        damageType: 'none',
        disabledTurns: 0,
      });
      pushDestroyedOrdnance(ord.id, 'torpedo', engineEvents);
      pushDestroyedOrdnance(candidate.other.id, 'torpedo', engineEvents);
      return true;
    }

    const dieRoll = rollD6(rng);
    const result = lookupOtherDamage(dieRoll, 'torpedo');

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
      applyDamage(candidate.ship, result, 'torpedo', ord.id);

      engineEvents?.push({
        type: 'ordnanceDetonated',
        ordnanceId: ord.id,
        ordnanceType: 'torpedo',
        hex,
        targetShipId: candidate.ship.id,
        roll: dieRoll,
        damageType: result.type,
        disabledTurns: result.disabledTurns,
      });
      pushDestroyedOrdnance(ord.id, 'torpedo', engineEvents);

      if (candidate.ship.lifecycle === 'destroyed') {
        engineEvents?.push({
          type: 'shipDestroyed',
          shipId: candidate.ship.id,
          cause: 'torpedo',
        });
      }

      return true;
    }
  }

  return false;
};

const pathEntersHex = (
  path: { q: number; r: number }[],
  hex: { q: number; r: number },
): boolean => {
  return path.some((coord, index) => index > 0 && hexEqual(coord, hex));
};

const pathOccupiesHexAfterMovement = (
  path: { q: number; r: number }[],
  hex: { q: number; r: number },
): boolean => {
  if (path.length <= 1) {
    return path.length === 1 && hexEqual(path[0], hex);
  }

  return pathEntersHex(path, hex);
};

const hasOrdnanceDetonationEvent = (
  ordnanceId: import('../ids').OrdnanceId,
  engineEvents?: EngineEvent[],
): boolean => {
  return (
    engineEvents?.some(
      (event) =>
        event.type === 'ordnanceDetonated' && event.ordnanceId === ordnanceId,
    ) ?? false
  );
};

const resolveOrdnanceContactAtHex = (
  ord: Ordnance,
  ships: Ship[],
  contactedOrdnance: Ordnance[],
  hex: { q: number; r: number },
  events: MovementEvent[],
  rng: () => number,
  engineEvents?: EngineEvent[],
): boolean => {
  if (ord.type === 'torpedo') {
    return resolveTorpedoDetonation(
      ord,
      ships,
      contactedOrdnance,
      hex,
      events,
      rng,
      engineEvents,
    );
  }

  let hitSomething = false;

  for (const ship of ships) {
    const dieRoll = ord.type === 'nuke' ? 0 : rollD6(rng);

    const result =
      ord.type === 'nuke'
        ? {
            type: 'eliminated' as const,
            disabledTurns: 0,
          }
        : lookupOtherDamage(dieRoll, 'mine');

    events.push({
      type: ord.type === 'nuke' ? 'nukeDetonation' : 'mineDetonation',
      shipId: ship.id,
      hex,
      dieRoll,
      damageType: result.type,
      disabledTurns: result.disabledTurns,
      ordnanceId: ord.id,
    });

    engineEvents?.push({
      type: 'ordnanceDetonated',
      ordnanceId: ord.id,
      ordnanceType: ord.type,
      hex,
      targetShipId: ship.id,
      roll: dieRoll,
      damageType: result.type,
      disabledTurns: result.disabledTurns,
    });

    applyDamage(ship, result, ord.type, ord.id);

    if (ship.lifecycle === 'destroyed') {
      engineEvents?.push({
        type: 'shipDestroyed',
        shipId: ship.id,
        cause: ord.type,
      });
    }

    hitSomething = true;
  }

  for (const other of contactedOrdnance) {
    other.lifecycle = 'destroyed';
    pushDestroyedOrdnance(other.id, ord.type, engineEvents);
    hitSomething = true;
  }

  if (!hitSomething) {
    return false;
  }

  if (!hasOrdnanceDetonationEvent(ord.id, engineEvents)) {
    engineEvents?.push({
      type: 'ordnanceDetonated',
      ordnanceId: ord.id,
      ordnanceType: ord.type,
      hex,
      roll: 0,
      damageType: 'none',
      disabledTurns: 0,
    });
  }

  pushDestroyedOrdnance(ord.id, ord.type, engineEvents);
  return true;
};

const shipOccupiesHexForOrdnance = (
  ship: Ship,
  hex: { q: number; r: number },
  shipPathsById: ReadonlyMap<string, { q: number; r: number }[]>,
  requireEntry: boolean,
): boolean => {
  const path = shipPathsById.get(ship.id);

  if (!path) {
    return !requireEntry && hexEqual(ship.position, hex);
  }

  return requireEntry
    ? pathEntersHex(path, hex)
    : pathOccupiesHexAfterMovement(path, hex);
};

const checkOrdnanceDetonation = (
  ord: Ordnance,
  state: GameState,
  shipPathsById: ReadonlyMap<string, { q: number; r: number }[]>,
  path: { q: number; r: number }[],
  events: MovementEvent[],
  map: SolarSystemMap,
  rng: () => number,
  engineEvents?: EngineEvent[],
): { q: number; r: number } | null => {
  for (let i = 0; i < path.length; i++) {
    const pathHex = path[i];
    const isStartHex = i === 0;
    const sourceShipProtectedThisTurn =
      ord.sourceShipId !== null && ord.turnsRemaining === ORDNANCE_LIFETIME - 1;
    const key = hexKey(pathHex);
    const mapHex = map.hexes.get(key);
    let forcedDetonationHex: { q: number; r: number } | null = null;

    if (isAsteroidHex(state, map, pathHex)) {
      if (ord.type === 'nuke') {
        pushDestroyedAsteroid(state, pathHex, engineEvents);
        engineEvents?.push({
          type: 'ordnanceDetonated',
          ordnanceId: ord.id,
          ordnanceType: ord.type,
          hex: pathHex,
          roll: 0,
          damageType: 'none',
          disabledTurns: 0,
        });
        pushDestroyedOrdnance(ord.id, ord.type, engineEvents);
        forcedDetonationHex = pathHex;
      } else {
        pushDestroyedOrdnance(ord.id, 'asteroidCollision', engineEvents);
        return pathHex;
      }
    }

    if (mapHex?.base && !state.destroyedBases.includes(key)) {
      if (ord.type === 'nuke') {
        pushDestroyedBase(state, pathHex, engineEvents);
        engineEvents?.push({
          type: 'ordnanceDetonated',
          ordnanceId: ord.id,
          ordnanceType: ord.type,
          hex: pathHex,
          roll: 0,
          damageType: 'none',
          disabledTurns: 0,
        });
        pushDestroyedOrdnance(ord.id, ord.type, engineEvents);
        forcedDetonationHex = pathHex;
      } else {
        pushDestroyedOrdnance(ord.id, 'baseCollision', engineEvents);
        return pathHex;
      }
    }

    const contactedShips = state.ships.filter(
      (ship) =>
        ship.lifecycle !== 'destroyed' &&
        !(sourceShipProtectedThisTurn && ship.id === ord.sourceShipId) &&
        (!isStartHex || ship.owner !== ord.owner) &&
        shipOccupiesHexForOrdnance(ship, pathHex, shipPathsById, false) &&
        (ship.lifecycle !== 'landed' || ord.type === 'nuke'),
    );

    const contactedOrdnance = state.ordnance.filter(
      (other) =>
        other.id !== ord.id &&
        other.lifecycle !== 'destroyed' &&
        (!isStartHex || other.owner !== ord.owner) &&
        hexEqual(other.position, pathHex),
    );

    if (
      resolveOrdnanceContactAtHex(
        ord,
        contactedShips,
        contactedOrdnance,
        pathHex,
        events,
        rng,
        engineEvents,
      ) ||
      forcedDetonationHex
    ) {
      return forcedDetonationHex ?? pathHex;
    }
  }

  return null;
};

const truncatePathAtHex = (
  path: { q: number; r: number }[],
  hex: { q: number; r: number },
): { q: number; r: number }[] => {
  const index = path.findIndex((coord) => hexEqual(coord, hex));

  return index >= 0 ? path.slice(0, index + 1) : path;
};

// Move all ordnance, then check for detonations
// against ships and other ordnance.
export const moveOrdnance = (
  state: GameState,
  movingPlayerId: PlayerId,
  map: SolarSystemMap,
  shipMovements: ShipMovement[],
  ordnanceMovements: OrdnanceMovement[],
  events: MovementEvent[],
  rng: () => number,
  engineEvents?: EngineEvent[],
): void => {
  const shipPathsById = new Map(
    shipMovements.map((movement) => [movement.shipId, movement.path] as const),
  );

  for (const ord of state.ordnance) {
    if (ord.lifecycle === 'destroyed') {
      continue;
    }

    const contactedShips = state.ships.filter(
      (ship) =>
        ship.lifecycle !== 'destroyed' &&
        shipOccupiesHexForOrdnance(ship, ord.position, shipPathsById, true) &&
        (ship.lifecycle !== 'landed' || ord.type === 'nuke'),
    );

    if (
      contactedShips.length > 0 &&
      resolveOrdnanceContactAtHex(
        ord,
        contactedShips,
        [],
        ord.position,
        events,
        rng,
        engineEvents,
      )
    ) {
      ordnanceMovements.push({
        ordnanceId: ord.id,
        owner: ord.owner,
        ordnanceType: ord.type,
        from: { ...ord.position },
        to: { ...ord.position },
        path: [{ ...ord.position }],
        detonated: true,
      });
      ord.lifecycle = 'destroyed';
    }
  }

  for (const ord of state.ordnance) {
    if (ord.lifecycle === 'destroyed' || ord.owner !== movingPlayerId) continue;

    const from = { ...ord.position };
    const dest = hexAdd(ord.position, ord.velocity);
    const finalDest = applyPendingGravityEffects(
      dest,
      ord.pendingGravityEffects,
    );

    const finalPath = hexLineDraw(from, finalDest);

    ord.position = finalDest;
    ord.velocity = hexSubtract(finalDest, from);
    ord.pendingGravityEffects = collectEnteredGravityEffects(finalPath, map);
    ord.turnsRemaining--;
    engineEvents?.push({
      type: 'ordnanceMoved',
      ordnanceId: ord.id,
      position: { ...ord.position },
      velocity: { ...ord.velocity },
      turnsRemaining: ord.turnsRemaining,
      pendingGravityEffects: ord.pendingGravityEffects.map((effect) => ({
        ...effect,
        hex: { ...effect.hex },
      })),
    });

    let detonationHex: { q: number; r: number } | null = null;

    for (let pi = 0; pi < finalPath.length; pi++) {
      const hex = map.hexes.get(hexKey(finalPath[pi]));

      if (hex?.body) {
        if (ord.type === 'nuke') {
          const entryHex = pi > 0 ? finalPath[pi - 1] : finalPath[pi];
          const entryKey = hexKey(entryHex);
          detonationHex = entryHex;

          if (
            map.hexes.get(entryKey)?.base &&
            !state.destroyedBases.includes(entryKey)
          ) {
            pushDestroyedBase(state, entryHex, engineEvents);
          }

          for (const ship of state.ships) {
            if (
              ship.lifecycle !== 'destroyed' &&
              hexEqual(ship.position, entryHex)
            ) {
              ship.lifecycle = 'destroyed';
              ship.deathCause = 'nuke';
              ship.killedBy = asShipId(ord.id);
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

              engineEvents?.push({
                type: 'ordnanceDetonated',
                ordnanceId: ord.id,
                ordnanceType: ord.type,
                hex: entryHex,
                targetShipId: ship.id,
                roll: 0,
                damageType: 'eliminated',
                disabledTurns: 0,
              });
              pushDestroyedOrdnance(ord.id, ord.type, engineEvents);
              engineEvents?.push({
                type: 'shipDestroyed',
                shipId: ship.id,
                cause: ord.type,
              });
            }
          }

          for (const other of state.ordnance) {
            if (
              other.id !== ord.id &&
              other.lifecycle !== 'destroyed' &&
              hexEqual(other.position, entryHex)
            ) {
              other.lifecycle = 'destroyed';
              pushDestroyedOrdnance(other.id, ord.type, engineEvents);
            }
          }

          if (
            !engineEvents?.some(
              (event) =>
                event.type === 'ordnanceDestroyed' &&
                event.ordnanceId === ord.id,
            )
          ) {
            engineEvents?.push({
              type: 'ordnanceDetonated',
              ordnanceId: ord.id,
              ordnanceType: ord.type,
              hex: entryHex,
              roll: 0,
              damageType: 'none',
              disabledTurns: 0,
            });
            pushDestroyedOrdnance(ord.id, ord.type, engineEvents);
          }
        }

        if (ord.type !== 'nuke') {
          detonationHex = finalPath[pi];
          pushDestroyedOrdnance(ord.id, 'bodyCollision', engineEvents);
        }
        ord.lifecycle = 'destroyed';
        break;
      }
    }

    if (detonationHex === null && ord.lifecycle !== 'destroyed') {
      detonationHex = checkOrdnanceDetonation(
        ord,
        state,
        shipPathsById,
        finalPath,
        events,
        map,
        rng,
        engineEvents,
      );
    }

    const detonated = detonationHex !== null;
    const movementPath = detonationHex
      ? truncatePathAtHex(finalPath, detonationHex)
      : finalPath;
    const movementTo = detonationHex ?? finalDest;

    ordnanceMovements.push({
      ordnanceId: ord.id,
      owner: ord.owner,
      ordnanceType: ord.type,
      from,
      to: movementTo,
      path: movementPath,
      detonated,
    });

    if (detonated) {
      ord.lifecycle = 'destroyed';
      continue;
    }

    if (ord.turnsRemaining <= 0) {
      ord.lifecycle = 'destroyed';
      engineEvents?.push({
        type: 'ordnanceExpired',
        ordnanceId: ord.id,
      });
      continue;
    }

    const oobMargin = 2;
    const { minQ, maxQ, minR, maxR } = map.bounds;
    const p = ord.position;
    if (
      p.q < minQ - oobMargin ||
      p.q > maxQ + oobMargin ||
      p.r < minR - oobMargin ||
      p.r > maxR + oobMargin
    ) {
      ord.lifecycle = 'destroyed';
      engineEvents?.push({
        type: 'ordnanceExpired',
        ordnanceId: ord.id,
      });
    }
  }

  state.ordnance = state.ordnance.filter((o) => o.lifecycle !== 'destroyed');
};

// Queue asteroid hazards so they resolve during
// combat.
export const queueAsteroidHazards = (
  ship: Ship,
  path: { q: number; r: number }[],
  velocity: { dq: number; dr: number },
  state: GameState,
  map: SolarSystemMap,
): void => {
  const speed = hexVecLength(velocity);

  if (speed <= 1) return;

  if (path.length < 2) return;

  const line = analyzeHexLine(path[0], path[path.length - 1]);

  const queuedBoundaryPairs = new Set<string>();

  for (let i = 1; i < line.definite.length; i++) {
    if (!isAsteroidHex(state, map, line.definite[i])) {
      continue;
    }

    state.pendingAsteroidHazards.push({
      shipId: ship.id,
      hex: { ...line.definite[i] },
    });
  }

  for (const [first, second] of line.ambiguousPairs) {
    if (
      !isAsteroidHex(state, map, first) ||
      !isAsteroidHex(state, map, second)
    ) {
      continue;
    }

    const firstKey = hexKey(first);
    const secondKey = hexKey(second);
    const pairKey =
      firstKey < secondKey
        ? `${firstKey}|${secondKey}`
        : `${secondKey}|${firstKey}`;

    if (queuedBoundaryPairs.has(pairKey)) continue;

    queuedBoundaryPairs.add(pairKey);

    state.pendingAsteroidHazards.push({
      shipId: ship.id,
      hex: { ...first },
    });
  }
};

// Resolve pending asteroid collision damage.
export const resolvePendingAsteroidHazards = (
  state: GameState,
  playerId: PlayerId,
  rng: () => number,
): CombatResult[] => {
  const results: CombatResult[] = [];
  const remaining: typeof state.pendingAsteroidHazards = [];

  for (const hazard of state.pendingAsteroidHazards) {
    const ship = state.ships.find((s) => s.id === hazard.shipId);

    if (!ship || ship.owner !== playerId) {
      remaining.push(hazard);
      continue;
    }

    if (ship.lifecycle === 'destroyed') {
      continue;
    }

    const dieRoll = rollD6(rng);
    const result = lookupOtherDamage(dieRoll, 'asteroid');

    applyDamage(ship, result, 'asteroid');

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
};
