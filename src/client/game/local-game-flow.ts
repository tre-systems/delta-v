import type { AIDifficulty } from '../../shared/ai';
import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import type {
  CombatResult,
  GameState,
  SolarSystemMap,
} from '../../shared/types';
import type { AIActionPlan } from './ai-flow';
import { deriveAIActionPlan } from './ai-flow';
import type { LocalResolution } from './local';
import {
  resolveAstrogationStep,
  resolveBeginCombatStep,
  resolveCombatStep,
  resolveOrdnanceStep,
  resolveSkipCombatStep,
  resolveSkipLogisticsStep,
  resolveSkipOrdnanceStep,
} from './local';
export interface LocalGameFlowDeps {
  getGameState: () => GameState | null;
  getPlayerId: () => number;
  getMap: () => SolarSystemMap;
  getAIDifficulty: () => AIDifficulty;
  applyGameState: (state: GameState) => void;
  presentMovementResult: (
    state: GameState,
    movements: MovementResult['movements'],
    ordnanceMovements: MovementResult['ordnanceMovements'],
    events: MovementResult['events'],
    onComplete: () => void,
  ) => void;
  presentCombatResults: (
    previousState: GameState,
    state: GameState,
    results: CombatResult[],
    resetCombat: boolean,
  ) => void;
  showGameOverOutcome: (won: boolean, reason: string) => void;
  transitionToPhase: () => void;
  logText: (text: string) => void;
}
export const isGameOver = (deps: LocalGameFlowDeps): boolean =>
  !deps.getGameState() || deps.getGameState()?.phase === 'gameOver';
export const localCheckGameEnd = (deps: LocalGameFlowDeps): void => {
  const gameState = deps.getGameState();
  if (!gameState || gameState.phase !== 'gameOver') return;
  deps.showGameOverOutcome(
    gameState.winner === deps.getPlayerId(),
    gameState.winReason ?? '',
  );
};
export const playLocalMovementResult = (
  deps: LocalGameFlowDeps,
  result: MovementResult,
  onComplete: () => void,
): void => {
  deps.presentMovementResult(
    result.state,
    result.movements,
    result.ordnanceMovements,
    result.events,
    onComplete,
  );
};
export const handleLocalResolution = (
  deps: LocalGameFlowDeps,
  resolution: LocalResolution,
  onContinue: () => void,
  errorPrefix: string,
): void => {
  if (resolution.kind === 'error') {
    console.error(errorPrefix, resolution.error);
    return;
  }
  if (resolution.kind === 'movement') {
    playLocalMovementResult(deps, resolution.result, () => {
      localCheckGameEnd(deps);
      if (deps.getGameState()?.phase !== 'gameOver') {
        onContinue();
      }
    });
    return;
  }
  if (resolution.kind === 'combat') {
    deps.presentCombatResults(
      resolution.previousState,
      resolution.state,
      resolution.results,
      resolution.resetCombat,
    );
  } else {
    deps.applyGameState(resolution.state);
  }
  localCheckGameEnd(deps);
  if (deps.getGameState()?.phase !== 'gameOver') {
    onContinue();
  }
};
export const resolveAIPlan = (
  deps: LocalGameFlowDeps,
  plan: AIActionPlan,
): LocalResolution => {
  const gameState = must(deps.getGameState());
  const map = deps.getMap();
  switch (plan.kind) {
    case 'astrogation':
      return resolveAstrogationStep(gameState, plan.aiPlayer, plan.orders, map);
    case 'ordnance':
      return plan.skip
        ? resolveSkipOrdnanceStep(gameState, plan.aiPlayer, map)
        : resolveOrdnanceStep(gameState, plan.aiPlayer, plan.launches, map);
    case 'beginCombat':
      return resolveBeginCombatStep(gameState, plan.aiPlayer, map);
    case 'combat':
      return plan.skip
        ? resolveSkipCombatStep(gameState, plan.aiPlayer, map)
        : resolveCombatStep(gameState, plan.aiPlayer, plan.attacks, map, false);
    case 'logistics':
      return resolveSkipLogisticsStep(gameState, plan.aiPlayer, map);
    default:
      return { kind: 'error', error: 'Unexpected AI plan kind' };
  }
};
export const runAITurn = async (deps: LocalGameFlowDeps): Promise<void> => {
  await new Promise((r) => setTimeout(r, 500));
  while (!isGameOver(deps)) {
    const plan = deriveAIActionPlan(
      must(deps.getGameState()),
      deps.getPlayerId(),
      deps.getMap(),
      deps.getAIDifficulty(),
    );
    if (plan.kind === 'none') {
      deps.transitionToPhase();
      return;
    }
    if (plan.kind === 'transition') {
      localCheckGameEnd(deps);
      if (!isGameOver(deps)) {
        deps.transitionToPhase();
      }
      return;
    }
    if (plan.kind === 'ordnance') {
      for (const entry of plan.logEntries) {
        deps.logText(entry);
      }
    }
    const resolution = resolveAIPlan(deps, plan);
    const isCombatEnd = plan.kind === 'combat';
    await new Promise<void>((resolve) => {
      handleLocalResolution(
        deps,
        resolution,
        () => {
          if (isCombatEnd) {
            deps.transitionToPhase();
          }
          resolve();
        },
        plan.errorPrefix,
      );
    });
    if (isGameOver(deps)) return;
    if (isCombatEnd) return;
  }
};
