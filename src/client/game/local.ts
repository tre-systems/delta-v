import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  beginCombatPhase,
  endCombat,
  hasCombatResults,
  isMovementResult,
  type MovementResult,
  processAstrogation,
  processCombat,
  processLogistics,
  processOrdnance,
  processSingleCombat,
  type StateUpdateResult,
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
  PlayerId,
  SolarSystemMap,
  TransferOrder,
} from '../../shared/types/domain';

export type LocalResolution =
  | { kind: 'error'; error: string }
  | { kind: 'movement'; result: MovementResult }
  | { kind: 'state'; state: GameState }
  | {
      kind: 'logistics';
      state: GameState;
      engineEvents: EngineEvent[];
    }
  | {
      kind: 'combat';
      previousState: GameState;
      state: GameState;
      results: CombatResult[];
      resetCombat: boolean;
    }
  | {
      kind: 'combatSingle';
      previousState: GameState;
      state: GameState;
      result: CombatResult;
    };

type LocalErrorResult = {
  error: {
    message: string;
  };
};

type LocalStateResult = Pick<StateUpdateResult, 'state'>;

type LocalStateCarrier = {
  state: GameState;
};

type LocalCombatBatchResult = LocalStateResult & {
  results: CombatResult[];
};

const toErrorResolution = (result: LocalErrorResult): LocalResolution => ({
  kind: 'error',
  error: result.error.message,
});

const toStateResolution = (state: GameState): LocalResolution => ({
  kind: 'state',
  state,
});

const toMovementOrStateResolution = (
  result: MovementResult | StateUpdateResult,
): LocalResolution => {
  if (isMovementResult(result)) {
    return { kind: 'movement', result };
  }

  return toStateResolution(result.state);
};

// Engine entry points clone on entry, so the caller's state is still a safe
// before-snapshot for combat presentation and effects.
const toCombatResolution = (
  previousState: GameState,
  result: LocalCombatBatchResult,
  resetCombat: boolean,
): LocalResolution => ({
  kind: 'combat',
  previousState,
  state: result.state,
  results: result.results,
  resetCombat,
});

const toCombatTransitionResolution = (
  previousState: GameState,
  result: LocalStateCarrier | LocalCombatBatchResult,
): LocalResolution =>
  hasCombatResults(result)
    ? toCombatResolution(previousState, result, false)
    : toStateResolution(result.state);

export const resolveAstrogationStep = (
  state: GameState,
  playerId: PlayerId,
  orders: AstrogationOrder[],
  map: SolarSystemMap,
): LocalResolution => {
  const result = processAstrogation(state, playerId, orders, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return toMovementOrStateResolution(result);
};

export const resolveOrdnanceStep = (
  state: GameState,
  playerId: PlayerId,
  launches: OrdnanceLaunch[],
  map: SolarSystemMap,
): LocalResolution => {
  const result = processOrdnance(state, playerId, launches, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return { kind: 'movement', result };
};

export const resolveSkipOrdnanceStep = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): LocalResolution => {
  const result = skipOrdnance(state, playerId, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return toMovementOrStateResolution(result);
};

export const resolveBeginCombatStep = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): LocalResolution => {
  const result = beginCombatPhase(state, playerId, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return toCombatTransitionResolution(state, result);
};

export const resolveCombatStep = (
  state: GameState,
  playerId: PlayerId,
  attacks: CombatAttack[],
  map: SolarSystemMap,
  resetCombat = true,
): LocalResolution => {
  const result = processCombat(state, playerId, attacks, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return toCombatResolution(state, result, resetCombat);
};

export const resolveSkipCombatStep = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): LocalResolution => {
  const result = skipCombat(state, playerId, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return toCombatTransitionResolution(state, result);
};

export const resolveSingleCombatStep = (
  state: GameState,
  playerId: PlayerId,
  attack: CombatAttack,
  map: SolarSystemMap,
): LocalResolution => {
  const result = processSingleCombat(state, playerId, attack, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }
  return {
    kind: 'combatSingle',
    previousState: state,
    state: result.state,
    result: result.results[0],
  };
};

export const resolveEndCombatStep = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): LocalResolution => {
  const result = endCombat(state, playerId, map, Math.random);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return toCombatTransitionResolution(state, result);
};

export const resolveLogisticsStep = (
  state: GameState,
  playerId: PlayerId,
  transfers: TransferOrder[],
  map: SolarSystemMap,
): LocalResolution => {
  const result = processLogistics(state, playerId, transfers, map);

  if ('error' in result) {
    return toErrorResolution(result);
  }
  return {
    kind: 'logistics',
    state: result.state,
    engineEvents: result.engineEvents,
  };
};

export const resolveSkipLogisticsStep = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): LocalResolution => {
  const result = skipLogistics(state, playerId, map);

  if ('error' in result) {
    return toErrorResolution(result);
  }

  return toStateResolution(result.state);
};

export const hasOwnedPendingAsteroidHazards = (
  state: GameState,
  playerId: PlayerId,
): boolean => {
  return state.pendingAsteroidHazards.some((hazard) => {
    const ship = state.ships.find(
      (candidate) => candidate.id === hazard.shipId,
    );
    return ship?.owner === playerId && ship.lifecycle !== 'destroyed';
  });
};
