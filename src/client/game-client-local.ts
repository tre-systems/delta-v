import {
  beginCombatPhase,
  type MovementResult,
  processAstrogation,
  processCombat,
  processOrdnance,
  skipCombat,
  skipOrdnance,
} from '../shared/game-engine';
import type {
  AstrogationOrder,
  CombatAttack,
  CombatResult,
  GameState,
  OrdnanceLaunch,
  SolarSystemMap,
} from '../shared/types';

export type LocalResolution =
  | { kind: 'error'; error: string }
  | { kind: 'movement'; result: MovementResult }
  | { kind: 'state'; state: GameState }
  | {
      kind: 'combat';
      previousState: GameState;
      state: GameState;
      results: CombatResult[];
      resetCombat: boolean;
    };

export const resolveAstrogationStep = (
  state: GameState,
  playerId: number,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
): LocalResolution => {
  const result = processAstrogation(state, playerId, orders, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if ('movements' in result) {
    return { kind: 'movement', result };
  }
  return { kind: 'state', state: result.state };
};

export const resolveOrdnanceStep = (
  state: GameState,
  playerId: number,
  launches: OrdnanceLaunch[],
  map: SolarSystemMap,
): LocalResolution => {
  const result = processOrdnance(state, playerId, launches, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  return { kind: 'movement', result };
};

export const resolveSkipOrdnanceStep = (state: GameState, playerId: number, map: SolarSystemMap): LocalResolution => {
  const result = skipOrdnance(state, playerId, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if ('movements' in result) {
    return { kind: 'movement', result };
  }
  return { kind: 'state', state: result.state };
};

export const resolveBeginCombatStep = (state: GameState, playerId: number, map: SolarSystemMap): LocalResolution => {
  const previousState = state;
  const result = beginCombatPhase(state, playerId, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if ('results' in result && result.results.length > 0) {
    return {
      kind: 'combat',
      previousState,
      state: result.state,
      results: result.results,
      resetCombat: false,
    };
  }
  return { kind: 'state', state: result.state };
};

export const resolveCombatStep = (
  state: GameState,
  playerId: number,
  attacks: CombatAttack[],
  map: SolarSystemMap,
  resetCombat = true,
): LocalResolution => {
  const previousState = state;
  const result = processCombat(state, playerId, attacks, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  return {
    kind: 'combat',
    previousState,
    state: result.state,
    results: result.results,
    resetCombat,
  };
};

export const resolveSkipCombatStep = (state: GameState, playerId: number, map: SolarSystemMap): LocalResolution => {
  const previousState = state;
  const result = skipCombat(state, playerId, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if (result.results && result.results.length > 0) {
    return {
      kind: 'combat',
      previousState,
      state: result.state,
      results: result.results,
      resetCombat: false,
    };
  }
  return { kind: 'state', state: result.state };
};

export const hasOwnedPendingAsteroidHazards = (state: GameState, playerId: number): boolean => {
  return state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find((candidate) => candidate.id === hazard.shipId);
    return ship?.owner === playerId && !ship.destroyed;
  });
};
