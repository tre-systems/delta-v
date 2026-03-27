import { applyDamage, lookupOtherDamage, rollD6 } from '../combat';
import { ORBITAL_BASE_MASS } from '../constants';
import {
  analyzeHexLine,
  hexAdd,
  hexEqual,
  hexKey,
  hexLineDraw,
  hexSubtract,
  hexVecLength,
} from '../hex';
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
  type SolarSystemMap,
} from '../types';
import type { EngineEvent } from './engine-events';
import {
  engineFailure,
  getAllowedOrdnanceTypes,
  hasLaunchableOrdnanceCapacity,
  shuffle,
  validatePhaseAction,
} from './util';

// Determine whether the active player should receive
// an ordnance phase this turn.
export const shouldEnterOrdnancePhase = (state: GameState): boolean => {
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
      hasLaunchableOrdnanceCapacity(s, allowedOrdnanceTypes),
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

  if (phaseError) return { error: phaseError };

  for (const emp of emplacements) {
    const ship = state.ships.find((s) => s.id === emp.shipId);

    if (!ship || ship.owner !== playerId || ship.lifecycle === 'destroyed') {
      return engineFailure(
        ErrorCode.INVALID_SHIP,
        'Invalid ship for emplacement',
      );
    }

    if (ship.baseStatus !== 'carryingBase') {
      return engineFailure(
        ErrorCode.STATE_CONFLICT,
        'Ship is not carrying an orbital base',
      );
    }

    if (ship.type !== 'transport' && ship.type !== 'packet') {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Only transports and packets can' + ' carry orbital bases',
      );
    }

    if (ship.resuppliedThisTurn) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Cannot emplace during a resupply turn',
      );
    }

    const posKey = hexKey(ship.position);
    const hex = map.hexes.get(posKey);
    const speed = hexVecLength(ship.velocity);
    const inOrbit = hex?.gravity && speed === 1;
    const onWorldSide = hex?.gravity && ship.lifecycle === 'landed';

    if (!inOrbit && !onWorldSide) {
      return engineFailure(
        ErrorCode.NOT_ALLOWED,
        'Must be in orbit or on a world hex side' +
          ' to emplace an orbital base',
      );
    }

    const baseId = `ob${state.ships.length}`;

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
  ordnanceId: string,
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

const checkOrdnanceDetonation = (
  ord: Ordnance,
  state: GameState,
  path: { q: number; r: number }[],
  events: MovementEvent[],
  map: SolarSystemMap,
  rng: () => number,
  engineEvents?: EngineEvent[],
): boolean => {
  for (let i = 0; i < path.length; i++) {
    const pathHex = path[i];
    const isLaunchHex = i === 0;
    const key = hexKey(pathHex);
    const mapHex = map.hexes.get(key);
    let forcedDetonation = false;

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
        forcedDetonation = true;
      } else {
        pushDestroyedOrdnance(ord.id, 'asteroidCollision', engineEvents);
        return true;
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
        forcedDetonation = true;
      } else {
        pushDestroyedOrdnance(ord.id, 'baseCollision', engineEvents);
        return true;
      }
    }

    const contactedShips = state.ships.filter(
      (ship) =>
        ship.lifecycle !== 'destroyed' &&
        ship.id !== ord.sourceShipId &&
        (!isLaunchHex || ship.owner !== ord.owner) &&
        hexEqual(ship.position, pathHex) &&
        (ship.lifecycle !== 'landed' || ord.type === 'nuke'),
    );

    const contactedOrdnance = state.ordnance.filter(
      (other) =>
        other.id !== ord.id &&
        other.lifecycle !== 'destroyed' &&
        (!isLaunchHex || other.owner !== ord.owner) &&
        hexEqual(other.position, pathHex),
    );

    if (ord.type === 'torpedo') {
      if (
        resolveTorpedoDetonation(
          ord,
          contactedShips,
          contactedOrdnance,
          pathHex,
          events,
          rng,
          engineEvents,
        )
      ) {
        return true;
      }
      continue;
    }

    let hitSomething = false;

    for (const ship of contactedShips) {
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
        hex: pathHex,
        dieRoll,
        damageType: result.type,
        disabledTurns: result.disabledTurns,
        ordnanceId: ord.id,
      });

      engineEvents?.push({
        type: 'ordnanceDetonated',
        ordnanceId: ord.id,
        ordnanceType: ord.type,
        hex: pathHex,
        targetShipId: ship.id,
        roll: dieRoll,
        damageType: result.type,
        disabledTurns: result.disabledTurns,
      });
      pushDestroyedOrdnance(ord.id, ord.type, engineEvents);

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

    if (hitSomething || forcedDetonation) {
      return true;
    }
  }

  return false;
};

// Move all ordnance, then check for detonations
// against ships and other ordnance.
export const moveOrdnance = (
  state: GameState,
  map: SolarSystemMap,
  ordnanceMovements: OrdnanceMovement[],
  events: MovementEvent[],
  rng: () => number,
  engineEvents?: EngineEvent[],
): void => {
  for (const ord of state.ordnance) {
    if (ord.lifecycle === 'destroyed') continue;

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

    if (ord.turnsRemaining <= 0) {
      ord.lifecycle = 'destroyed';
      engineEvents?.push({
        type: 'ordnanceExpired',
        ordnanceId: ord.id,
      });
    }

    let nukeDevastated = false;

    for (let pi = 0; pi < finalPath.length; pi++) {
      const hex = map.hexes.get(hexKey(finalPath[pi]));

      if (hex?.body) {
        if (ord.type === 'nuke') {
          nukeDevastated = true;

          const entryHex = pi > 0 ? finalPath[pi - 1] : finalPath[pi];
          const entryKey = hexKey(entryHex);

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
              ship.killedBy = ord.id;
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
          pushDestroyedOrdnance(ord.id, 'bodyCollision', engineEvents);
        }
        ord.lifecycle = 'destroyed';
        break;
      }
    }

    const detonated =
      nukeDevastated ||
      (ord.lifecycle !== 'destroyed' &&
        checkOrdnanceDetonation(
          ord,
          state,
          finalPath,
          events,
          map,
          rng,
          engineEvents,
        ));

    ordnanceMovements.push({
      ordnanceId: ord.id,
      from,
      to: finalDest,
      path: finalPath,
      detonated,
    });

    if (detonated) {
      ord.lifecycle = 'destroyed';
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
