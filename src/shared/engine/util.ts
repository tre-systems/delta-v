import { ORDNANCE_MASS, SHIP_STATS } from '../constants';
import { parseHexKey } from '../hex';
import { bodyHasGravity } from '../map-data';
import type {
  GameState,
  Ordnance,
  Phase,
  Ship,
  SolarSystemMap,
} from '../types';

// Phase + player validation for engine entry points.
// Returns an error string if the action is not allowed,
// or null if validation passes.
export const validatePhaseAction = (
  state: GameState,
  playerId: number,
  requiredPhase: Phase,
): string | null => {
  if (state.phase !== requiredPhase) {
    return `Not in ${requiredPhase} phase`;
  }
  if (playerId !== state.activePlayer) {
    return 'Not your turn';
  }
  return null;
};

export const playerControlsBase = (
  state: GameState,
  playerId: number,
  baseKey: string,
): boolean => state.players[playerId]?.bases.includes(baseKey) ?? false;

export const isPlanetaryDefenseEnabled = (
  state: Pick<GameState, 'scenarioRules'>,
): boolean => state.scenarioRules.planetaryDefenseEnabled !== false;

export const usesEscapeInspectionRules = (
  state: Pick<GameState, 'scenarioRules'>,
): boolean => state.scenarioRules.hiddenIdentityInspection === true;

export const getEscapeEdge = (
  state: Pick<GameState, 'scenarioRules'>,
): 'any' | 'north' => state.scenarioRules.escapeEdge ?? 'any';

export { parseHexKey as parseBaseKey } from '../hex';

export const getOwnedPlanetaryBases = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
): { key: string; coord: { q: number; r: number } }[] => {
  const bases = state.players[playerId]?.bases ?? [];

  return bases.flatMap((key) => {
    if (state.destroyedBases.includes(key)) return [];

    const hex = map.hexes.get(key);
    if (!hex?.base || !bodyHasGravity(hex.base.bodyName, map)) {
      return [];
    }

    return [{ key, coord: parseHexKey(key) }];
  });
};

export const getAllowedOrdnanceTypes = (
  state: Pick<GameState, 'scenarioRules'>,
): Set<Ordnance['type']> => {
  const { allowedOrdnanceTypes: allowed } = state.scenarioRules;

  if (!allowed || allowed.length === 0) {
    return new Set(['mine', 'torpedo', 'nuke']);
  }

  return new Set(allowed);
};

export const getNextOrdnanceId = (state: Pick<GameState, 'ordnance'>): number =>
  state.ordnance.reduce((maxId, ord) => {
    const match = /^ord(\d+)$/.exec(ord.id);
    return match ? Math.max(maxId, Number(match[1]) + 1) : maxId;
  }, 0);

export const hasOrdnanceCapacity = (ship: Ship): boolean => {
  const stats = SHIP_STATS[ship.type];
  if (!stats) return false;

  const minMass = ORDNANCE_MASS.mine;

  return stats.cargo - ship.cargoUsed >= minMass;
};

// Ship-level eligibility to launch a specific ordnance type.
// Returns an error message or null if the launch is allowed.
// Does NOT check contextual rules (scenario allowed types,
// mine course change, resupply turn, owner).
export const validateShipOrdnanceLaunch = (
  ship: Ship,
  ordnanceType: Ordnance['type'],
): string | null => {
  const stats = SHIP_STATS[ship.type];
  if (!stats) return 'Unknown ship type';

  if (ship.destroyed) return 'Ship is destroyed';
  if (ship.landed) return 'Cannot launch ordnance while landed';
  if (ship.captured) return 'Captured ships cannot launch ordnance';

  // Orbital bases may launch at D1 damage (rulebook p.6)
  if (ship.damage.disabledTurns > 0) {
    if (ship.type !== 'orbitalBase' || ship.damage.disabledTurns > 1) {
      return 'Ship is disabled';
    }
  }

  if (ship.type === 'orbitalBase' && ordnanceType !== 'torpedo') {
    return 'Orbital bases can only launch torpedoes';
  }

  if (
    ordnanceType === 'torpedo' &&
    !stats.canOverload &&
    ship.type !== 'orbitalBase'
  ) {
    return 'Only warships and orbital bases can launch torpedoes';
  }

  if (
    ordnanceType === 'nuke' &&
    !stats.canOverload &&
    (ship.nukesLaunchedSinceResupply ?? 0) >= 1
  ) {
    return 'Non-warships may carry only one nuke between resupplies';
  }

  const mass = ORDNANCE_MASS[ordnanceType];
  if (mass == null) return 'Invalid ordnance type';

  if (ship.cargoUsed + mass > stats.cargo) {
    const free = stats.cargo - ship.cargoUsed;
    return `Not enough cargo (need ${mass}, have ${free})`;
  }

  return null;
};

// Quick boolean: can this ship launch any ordnance at all?
// Checks ship status and minimum cargo capacity.
export const canLaunchOrdnance = (ship: Ship): boolean => {
  if (ship.destroyed || ship.landed || ship.captured) return false;

  // Orbital bases may launch at D1 damage (rulebook p.6)
  if (ship.damage.disabledTurns > 0) {
    if (ship.type !== 'orbitalBase' || ship.damage.disabledTurns > 1) {
      return false;
    }
  }

  return hasOrdnanceCapacity(ship);
};

export const hasLaunchableOrdnanceCapacity = (
  ship: Ship,
  allowedTypes: Set<Ordnance['type']>,
): boolean => {
  if (!canLaunchOrdnance(ship)) return false;

  for (const ordnanceType of allowedTypes) {
    if (validateShipOrdnanceLaunch(ship, ordnanceType) === null) {
      return true;
    }
  }

  return false;
};

export const hasAnyEnemyShips = (state: GameState): boolean => {
  const { activePlayer } = state;

  return state.ships.some((s) => s.owner !== activePlayer && !s.destroyed);
};

export const shuffle = <T>(items: T[], rng: () => number): T[] => {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
};

export const hasEscaped = (
  pos: { q: number; r: number },
  bounds: {
    minQ: number;
    maxQ: number;
    minR: number;
    maxR: number;
  },
): boolean => {
  const margin = 3;

  return (
    pos.q < bounds.minQ - margin ||
    pos.q > bounds.maxQ + margin ||
    pos.r < bounds.minR - margin ||
    pos.r > bounds.maxR + margin
  );
};

export const hasEscapedNorth = (
  pos: { q: number; r: number },
  bounds: {
    minQ: number;
    maxQ: number;
    minR: number;
    maxR: number;
  },
): boolean => {
  const margin = 3;

  return pos.r < bounds.minR - margin;
};
