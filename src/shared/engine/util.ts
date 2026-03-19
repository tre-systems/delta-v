import { ORDNANCE_MASS, SHIP_STATS } from '../constants';
import { parseHexKey } from '../hex';
import { bodyHasGravity } from '../map-data';
import type { GameState, Ordnance, Ship, SolarSystemMap } from '../types';

export const playerControlsBase = (state: GameState, playerId: number, baseKey: string): boolean =>
  state.players[playerId]?.bases.includes(baseKey) ?? false;

export const isPlanetaryDefenseEnabled = (state: Pick<GameState, 'scenarioRules'>): boolean =>
  state.scenarioRules.planetaryDefenseEnabled !== false;

export const usesEscapeInspectionRules = (state: Pick<GameState, 'scenarioRules'>): boolean =>
  state.scenarioRules.hiddenIdentityInspection === true;

export const getEscapeEdge = (state: Pick<GameState, 'scenarioRules'>): 'any' | 'north' =>
  state.scenarioRules.escapeEdge ?? 'any';

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
    if (!hex?.base || !bodyHasGravity(hex.base.bodyName, map)) return [];
    return [{ key, coord: parseHexKey(key) }];
  });
};

export const getAllowedOrdnanceTypes = (state: Pick<GameState, 'scenarioRules'>): Set<Ordnance['type']> => {
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

export const hasLaunchableOrdnanceCapacity = (ship: Ship, allowedTypes: Set<Ordnance['type']>): boolean => {
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
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number },
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
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number },
): boolean => {
  const margin = 3;
  return pos.r < bounds.minR - margin;
};
