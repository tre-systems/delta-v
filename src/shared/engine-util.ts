import type { GameState, Ship, Ordnance, SolarSystemMap } from './types';
import { hexKey } from './hex';
import { SHIP_STATS, ORDNANCE_MASS } from './constants';
import { bodyHasGravity } from './map-data';

export function playerControlsBase(state: GameState, playerId: number, baseKey: string): boolean {
  return state.players[playerId]?.bases.includes(baseKey) ?? false;
}

export function isPlanetaryDefenseEnabled(state: Pick<GameState, 'scenarioRules'>): boolean {
  return state.scenarioRules.planetaryDefenseEnabled !== false;
}

export function usesEscapeInspectionRules(state: Pick<GameState, 'scenarioRules'>): boolean {
  return state.scenarioRules.hiddenIdentityInspection === true;
}

export function getEscapeEdge(state: Pick<GameState, 'scenarioRules'>): 'any' | 'north' {
  return state.scenarioRules.escapeEdge ?? 'any';
}

export function parseBaseKey(baseKey: string): { q: number; r: number } {
  const [q, r] = baseKey.split(',').map(Number);
  return { q, r };
}

export function getOwnedPlanetaryBases(
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

export function getAllowedOrdnanceTypes(state: Pick<GameState, 'scenarioRules'>): Set<Ordnance['type']> {
  const allowed = state.scenarioRules.allowedOrdnanceTypes;
  if (!allowed || allowed.length === 0) {
    return new Set(['mine', 'torpedo', 'nuke']);
  }
  return new Set(allowed);
}

export function getNextOrdnanceId(state: Pick<GameState, 'ordnance'>): number {
  let nextId = 0;
  for (const ord of state.ordnance) {
    const match = /^ord(\d+)$/.exec(ord.id);
    if (!match) continue;
    nextId = Math.max(nextId, Number(match[1]) + 1);
  }
  return nextId;
}

export function hasOrdnanceCapacity(ship: Ship): boolean {
  const stats = SHIP_STATS[ship.type];
  if (!stats) return false;
  const minMass = ORDNANCE_MASS.mine;
  return (stats.cargo - ship.cargoUsed) >= minMass;
}

export function hasLaunchableOrdnanceCapacity(ship: Ship, allowedTypes: Set<Ordnance['type']>): boolean {
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

export function hasAnyEnemyShips(state: GameState): boolean {
  const player = state.activePlayer;
  return state.ships.some(s => s.owner !== player && !s.destroyed);
}

export function shuffle<T>(items: T[], rng?: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function hasEscaped(
  pos: { q: number; r: number },
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number },
): boolean {
  const margin = 3;
  return pos.q < bounds.minQ - margin || pos.q > bounds.maxQ + margin ||
         pos.r < bounds.minR - margin || pos.r > bounds.maxR + margin;
}

export function hasEscapedNorth(
  pos: { q: number; r: number },
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number },
): boolean {
  const margin = 3;
  return pos.r < bounds.minR - margin;
}
