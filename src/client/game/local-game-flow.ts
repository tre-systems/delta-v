import type { AIDifficulty } from '../../shared/ai';
import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import { filterLogisticsTransferLogEvents } from '../../shared/engine/transfer-log-events';
import type {
  CombatResult,
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { formatLogisticsTransferLogLines } from '../ui/formatters';
import type { AIActionPlan } from './ai-flow';
import { deriveAIActionPlan } from './ai-flow';
import type { LocalResolution } from './local';
import {
  resolveAstrogationStep,
  resolveBeginCombatStep,
  resolveCombatStep,
  resolveLogisticsStep,
  resolveOrdnanceStep,
  resolveSkipCombatStep,
  resolveSkipLogisticsStep,
  resolveSkipOrdnanceStep,
} from './local';
export interface LocalGameFlowDeps {
  getGameState: () => GameState | null;
  getPlayerId: () => PlayerId;
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
  showToast: (message: string, type: 'error' | 'info' | 'success') => void;
}

export const isGameOver = (deps: LocalGameFlowDeps): boolean =>
  !deps.getGameState() || deps.getGameState()?.phase === 'gameOver';
export const localCheckGameEnd = (deps: LocalGameFlowDeps): void => {
  const gameState = deps.getGameState();

  if (!gameState || gameState.phase !== 'gameOver') return;
  deps.showGameOverOutcome(
    gameState.outcome?.winner === deps.getPlayerId(),
    gameState.outcome?.reason ?? '',
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

const continueIfGameActive = (
  deps: LocalGameFlowDeps,
  onContinue: () => void,
): void => {
  localCheckGameEnd(deps);

  if (deps.getGameState()?.phase !== 'gameOver') {
    onContinue();
  }
};

const applyLocalStateResolution = (
  deps: LocalGameFlowDeps,
  resolution: Extract<
    LocalResolution,
    { kind: 'combat' | 'logistics' | 'state' }
  >,
): void => {
  switch (resolution.kind) {
    case 'combat':
      deps.presentCombatResults(
        resolution.previousState,
        resolution.state,
        resolution.results,
        resolution.resetCombat,
      );
      return;
    case 'logistics':
      for (const line of formatLogisticsTransferLogLines(
        filterLogisticsTransferLogEvents(resolution.engineEvents),
        resolution.state.ships,
      )) {
        deps.logText(line);
      }
      deps.applyGameState(resolution.state);
      return;
    case 'state':
      deps.applyGameState(resolution.state);
      return;
  }
};

export const handleLocalResolution = (
  deps: LocalGameFlowDeps,
  resolution: LocalResolution,
  onContinue: () => void,
  errorPrefix: string,
): void => {
  switch (resolution.kind) {
    case 'error':
      console.error(errorPrefix, resolution.error);
      deps.showToast(resolution.error, 'error');
      return;
    case 'movement':
      playLocalMovementResult(deps, resolution.result, () => {
        continueIfGameActive(deps, onContinue);
      });
      return;
    case 'combatSingle':
      deps.presentCombatResults(
        resolution.previousState,
        resolution.state,
        [resolution.result],
        false,
      );
      // Stay in combat phase — call onContinue to advance attacker
      onContinue();
      return;
    case 'combat':
    case 'logistics':
    case 'state':
      applyLocalStateResolution(deps, resolution);
      continueIfGameActive(deps, onContinue);
      return;
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
      return plan.skip
        ? resolveSkipLogisticsStep(gameState, plan.aiPlayer, map)
        : resolveLogisticsStep(gameState, plan.aiPlayer, plan.transfers, map);
    default:
      return { kind: 'error', error: 'Unexpected AI plan kind' };
  }
};

export const runAITurn = async (deps: LocalGameFlowDeps): Promise<void> => {
  await new Promise((r) => setTimeout(r, 500));
  while (!isGameOver(deps)) {
    const plan = deriveAIActionPlan(
      must(deps.getGameState()),
      deps.getPlayerId() as PlayerId,
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
