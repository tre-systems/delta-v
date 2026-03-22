import {
  beginCombatPhase,
  hasCombatResults,
  isMovementResult,
  type MovementResult,
  processAstrogation,
  processCombat,
  processLogistics,
  processOrdnance,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../../shared/engine/game-engine';
import type {
  AstrogationOrder,
  CombatAttack,
  CombatResult,
  GameState,
  OrdnanceLaunch,
  SolarSystemMap,
  TransferOrder,
} from '../../shared/types/domain';

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
  const result = processAstrogation(state, playerId, orders, map, Math.random);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if (isMovementResult(result)) {
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
  const result = processOrdnance(state, playerId, launches, map, Math.random);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  return { kind: 'movement', result };
};

export const resolveSkipOrdnanceStep = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
): LocalResolution => {
  const result = skipOrdnance(state, playerId, map, Math.random);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if (isMovementResult(result)) {
    return { kind: 'movement', result };
  }
  return { kind: 'state', state: result.state };
};

export const resolveBeginCombatStep = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
): LocalResolution => {
  const previousState = structuredClone(state);
  const result = beginCombatPhase(state, playerId, map, Math.random);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if (hasCombatResults(result)) {
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
  const previousState = structuredClone(state);
  const result = processCombat(state, playerId, attacks, map, Math.random);
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

export const resolveSkipCombatStep = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
): LocalResolution => {
  const previousState = structuredClone(state);
  const result = skipCombat(state, playerId, map, Math.random);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  if (hasCombatResults(result)) {
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

export const resolveLogisticsStep = (
  state: GameState,
  playerId: number,
  transfers: TransferOrder[],
  map: SolarSystemMap,
): LocalResolution => {
  const result = processLogistics(state, playerId, transfers, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  return { kind: 'state', state: result.state };
};

export const resolveSkipLogisticsStep = (
  state: GameState,
  playerId: number,
  map: SolarSystemMap,
): LocalResolution => {
  const result = skipLogistics(state, playerId, map);
  if ('error' in result) {
    return { kind: 'error', error: result.error };
  }
  return { kind: 'state', state: result.state };
};

export const hasOwnedPendingAsteroidHazards = (
  state: GameState,
  playerId: number,
): boolean => {
  return state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );
    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });
};
