// Candidate action generation for agents. Produces legal C2S options per phase
// using the built-in AI at all three difficulty levels, de-duplicated.
// The first candidate (index 0) is the "recommended" choice from the hard AI.

import {
  type AIDifficulty,
  aiAstrogation,
  aiCombat,
  aiLogistics,
  aiOrdnance,
  buildAIFleetPurchases,
} from '../ai';
import { buildSolarSystemMap } from '../map-data';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../types/domain';
import type { C2S } from '../types/protocol';

export const allowedActionTypesForPhase = (
  phase: GameState['phase'],
): Set<C2S['type']> => {
  switch (phase) {
    case 'waiting':
      return new Set();
    case 'fleetBuilding':
      return new Set(['fleetReady']);
    case 'astrogation':
      return new Set(['astrogation', 'surrender']);
    case 'ordnance':
      return new Set(['ordnance', 'skipOrdnance', 'emplaceBase']);
    case 'combat':
      return new Set(['beginCombat', 'combat', 'skipCombat']);
    case 'logistics':
      return new Set(['logistics', 'skipLogistics']);
    case 'gameOver':
      return new Set(['rematch']);
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled phase: ${_exhaustive}`);
    }
  }
};

export const buildIdleAstrogationOrders = (
  state: GameState,
  playerId: PlayerId,
): AstrogationOrder[] =>
  state.ships
    .filter((ship) => ship.owner === playerId && ship.lifecycle !== 'destroyed')
    .map((ship) => ({
      shipId: ship.id,
      burn: null,
      overload: null,
    }));

const hasOwnedPendingAsteroidHazards = (
  state: GameState,
  playerId: PlayerId,
): boolean =>
  state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );
    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });

export const buildActionForDifficulty = (
  state: GameState,
  playerId: PlayerId,
  difficulty: AIDifficulty,
  map: SolarSystemMap = buildSolarSystemMap(),
): C2S | null => {
  switch (state.phase) {
    case 'waiting':
      return null;
    case 'fleetBuilding':
      return {
        type: 'fleetReady',
        purchases: buildAIFleetPurchases(state, playerId, difficulty),
      };
    case 'astrogation': {
      const orders = aiAstrogation(state, playerId, map, difficulty);
      return {
        type: 'astrogation',
        orders:
          orders.length > 0
            ? orders
            : buildIdleAstrogationOrders(state, playerId),
      };
    }
    case 'ordnance': {
      const launches = aiOrdnance(state, playerId, map, difficulty);
      if (launches.length > 0) return { type: 'ordnance', launches };
      return { type: 'skipOrdnance' };
    }
    case 'combat': {
      if (hasOwnedPendingAsteroidHazards(state, playerId)) {
        return { type: 'beginCombat' };
      }
      const attacks = aiCombat(state, playerId, map, difficulty);
      if (attacks.length > 0) return { type: 'combat', attacks };
      return { type: 'skipCombat' };
    }
    case 'logistics': {
      const transfers = aiLogistics(state, playerId, map, difficulty);
      if (transfers.length > 0) return { type: 'logistics', transfers };
      return { type: 'skipLogistics' };
    }
    case 'gameOver':
      return null;
    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`Unhandled phase: ${_exhaustive}`);
    }
  }
};

const dedupeCandidates = (candidates: C2S[]): C2S[] => {
  const seen = new Set<string>();
  const result: C2S[] = [];
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
};

// Generate the canonical candidate list for a given state/player.
// Returns C2S[] where index 0 is the hard-difficulty "recommended" choice.
export const buildCandidates = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap = buildSolarSystemMap(),
): C2S[] => {
  const seeds: C2S[] = [];
  for (const difficulty of ['hard', 'normal', 'easy'] as const) {
    const action = buildActionForDifficulty(state, playerId, difficulty, map);
    if (action) seeds.push(action);
  }

  // Always include the bare skip actions for phases that allow them so agents
  // have a cheap "do nothing" option even if every difficulty picked activity.
  if (state.phase === 'ordnance') seeds.push({ type: 'skipOrdnance' });
  if (state.phase === 'combat') seeds.push({ type: 'skipCombat' });
  if (state.phase === 'logistics') seeds.push({ type: 'skipLogistics' });

  // Always include a coast (all ships idle) option for astrogation so agents
  // can choose to save fuel even when every AI difficulty picks a burn.
  if (state.phase === 'astrogation') {
    seeds.push({
      type: 'astrogation',
      orders: buildIdleAstrogationOrders(state, playerId),
    });
  }

  return dedupeCandidates(seeds);
};
