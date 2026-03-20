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
import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrbitalBaseEmplacement,
  Ordnance,
  OrdnanceMovement,
  Ship,
  SolarSystemMap,
} from '../types';
import {
  getAllowedOrdnanceTypes,
  hasLaunchableOrdnanceCapacity,
  shuffle,
} from './util';

/**
 * Determine whether the active player should receive
 * an ordnance phase this turn.
 */
export const shouldEnterOrdnancePhase = (state: GameState): boolean => {
  const allowedOrdnanceTypes = getAllowedOrdnanceTypes(state);

  if (allowedOrdnanceTypes.size === 0) {
    return false;
  }

  return state.ships.some(
    (s) =>
      s.owner === state.activePlayer &&
      !s.destroyed &&
      !s.landed &&
      s.damage.disabledTurns === 0 &&
      !s.resuppliedThisTurn &&
      !s.captured &&
      hasLaunchableOrdnanceCapacity(s, allowedOrdnanceTypes),
  );
};

/**
 * Emplace orbital bases from carrying ships during
 * the ordnance phase.
 */
export const processEmplacement = (
  state: GameState,
  playerId: number,
  emplacements: OrbitalBaseEmplacement[],
  map: SolarSystemMap,
): { state: GameState } | { error: string } => {
  if (state.phase !== 'ordnance') {
    return { error: 'Not in ordnance phase' };
  }
  if (playerId !== state.activePlayer) {
    return { error: 'Not your turn' };
  }

  for (const emp of emplacements) {
    const ship = state.ships.find((s) => s.id === emp.shipId);

    if (!ship || ship.owner !== playerId || ship.destroyed) {
      return { error: 'Invalid ship for emplacement' };
    }
    if (!ship.carryingOrbitalBase) {
      return {
        error: 'Ship is not carrying an orbital base',
      };
    }
    if (ship.type !== 'transport' && ship.type !== 'packet') {
      return {
        error: 'Only transports and packets can carry orbital bases',
      };
    }
    if (ship.resuppliedThisTurn) {
      return {
        error: 'Cannot emplace during a resupply turn',
      };
    }

    const posKey = hexKey(ship.position);
    const hex = map.hexes.get(posKey);
    const speed = hexVecLength(ship.velocity);
    const inOrbit = hex?.gravity && speed === 1;
    const onWorldSide = hex?.gravity && ship.landed;

    if (!inOrbit && !onWorldSide) {
      return {
        error:
          'Must be in orbit or on a world hex side to emplace an orbital base',
      };
    }

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

    ship.carryingOrbitalBase = false;
    ship.cargoUsed = Math.max(0, ship.cargoUsed - ORBITAL_BASE_MASS);
  }

  return { state };
};

/**
 * Check if a hex is an asteroid that hasn't been
 * destroyed.
 */
export const isAsteroidHex = (
  state: GameState,
  map: SolarSystemMap,
  coord: { q: number; r: number },
): boolean => {
  const key = hexKey(coord);
  const hex = map.hexes.get(key);

  return hex?.terrain === 'asteroid' && !state.destroyedAsteroids.includes(key);
};

const resolveTorpedoDetonation = (
  ord: Ordnance,
  ships: Ship[],
  contactedOrdnance: Ordnance[],
  hex: { q: number; r: number },
  events: MovementEvent[],
  rng: () => number,
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
      candidate.other.destroyed = true;
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
      applyDamage(candidate.ship, result);
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
): boolean => {
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

    const contactedShips = state.ships.filter(
      (ship) =>
        !ship.destroyed &&
        ship.id !== ord.sourceShipId &&
        (!isLaunchHex || ship.owner !== ord.owner) &&
        hexEqual(ship.position, pathHex) &&
        (!ship.landed || ord.type === 'nuke'),
    );

    const contactedOrdnance = state.ordnance.filter(
      (other) =>
        other.id !== ord.id &&
        !other.destroyed &&
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
};

/**
 * Move all ordnance, then check for detonations
 * against ships and other ordnance.
 */
export const moveOrdnance = (
  state: GameState,
  map: SolarSystemMap,
  ordnanceMovements: OrdnanceMovement[],
  events: MovementEvent[],
  rng: () => number,
): void => {
  for (const ord of state.ordnance) {
    if (ord.destroyed) continue;

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

    if (ord.turnsRemaining <= 0) {
      ord.destroyed = true;
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
            state.destroyedBases.push(entryKey);
          }

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
            if (
              other.id !== ord.id &&
              !other.destroyed &&
              hexEqual(other.position, entryHex)
            ) {
              other.destroyed = true;
            }
          }
        }

        ord.destroyed = true;
        break;
      }
    }

    const detonated =
      nukeDevastated ||
      (!ord.destroyed &&
        checkOrdnanceDetonation(ord, state, finalPath, events, map, rng));

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

  state.ordnance = state.ordnance.filter((o) => !o.destroyed);
};

/**
 * Queue asteroid hazards so they resolve during
 * combat.
 */
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

/**
 * Resolve pending asteroid collision damage.
 */
export const resolvePendingAsteroidHazards = (
  state: GameState,
  playerId: number,
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
    if (ship.destroyed) {
      continue;
    }

    const dieRoll = rollD6(rng);
    const result = lookupOtherDamage(dieRoll, 'asteroid');

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
};
