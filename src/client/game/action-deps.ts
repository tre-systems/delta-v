import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { Renderer } from '../renderer/renderer';
import type { UIManager } from '../ui/ui';
import type { AstrogationActionDeps } from './astrogation-actions';
import type { CombatActionDeps } from './combat-actions';
import type { HudController } from './hud-controller';
import type { LocalGameFlowDeps } from './local-game-flow';
import type { OrdnanceActionDeps } from './ordnance-actions';
import type { ClientState } from './phase';
import type { PlanningStore } from './planning';
import {
  type PresentationDeps,
  presentCombatResults,
  showGameOverOutcome as presentGameOver,
  presentMovementResult,
} from './presentation';

export interface ActionDepsArgs {
  getGameState: () => GameState | null;
  getClientState: () => ClientState;
  getPlayerId: () => PlayerId;
  getTransport: () => { submitAstrogation: unknown } | null;
  getMap: () => SolarSystemMap;
  getAIDifficulty: () => string;
  getScenario: () => string;
  getIsLocalGame: () => boolean;
  planningState: PlanningStore;
  hud: HudController;
  ui: UIManager;
  renderer: Renderer;
  setState: (state: ClientState) => void;
  applyGameState: (state: GameState) => void;
  resetCombatState: () => void;
  transitionToPhase: () => void;
  onGameOverShown: () => void;
  track: (event: string, props?: Record<string, unknown>) => void;
}

export const createActionDeps = (args: ActionDepsArgs) => {
  const showToast = (message: string, type: 'error' | 'info' | 'success') => {
    args.ui.overlay.showToast(message, type);
  };
  const logText = (text: string) => {
    args.ui.log.logText(text);
  };

  const presentationDeps: PresentationDeps = {
    applyGameState: args.applyGameState,
    setState: args.setState,
    resetCombatState: args.resetCombatState,
    getGameState: args.getGameState,
    getPlayerId: args.getPlayerId,
    onGameOverShown: args.onGameOverShown,
    renderer: args.renderer,
    ui: args.ui,
  };

  const astrogationDeps: AstrogationActionDeps = {
    getGameState: args.getGameState,
    getClientState: args.getClientState,
    getPlayerId: args.getPlayerId,
    getTransport: args.getTransport as AstrogationActionDeps['getTransport'],
    planningState: args.planningState,
    showToast,
    logText,
  };

  const combatDeps: CombatActionDeps = {
    getGameState: args.getGameState,
    getClientState: args.getClientState,
    getPlayerId: args.getPlayerId,
    getTransport: args.getTransport as CombatActionDeps['getTransport'],
    getMap: args.getMap,
    planningState: args.planningState,
    showToast,
    logText,
  };

  const ordnanceDeps: OrdnanceActionDeps = {
    getGameState: args.getGameState,
    getClientState: args.getClientState,
    getPlayerId: args.getPlayerId,
    getMap: args.getMap,
    getTransport: args.getTransport as OrdnanceActionDeps['getTransport'],
    planningState: args.planningState,
    showToast,
    logText,
  };

  const showGameOverOutcome = (won: boolean, reason: string) => {
    args.track('game_over', {
      won,
      reason,
      scenario: args.getScenario(),
      mode: args.getIsLocalGame() ? 'local' : 'multiplayer',
      turn: args.getGameState()?.turnNumber,
    });
    presentGameOver(presentationDeps, won, reason);
  };

  const localGameFlowDeps: LocalGameFlowDeps = {
    getGameState: args.getGameState,
    getPlayerId: args.getPlayerId,
    getMap: args.getMap,
    getAIDifficulty:
      args.getAIDifficulty as LocalGameFlowDeps['getAIDifficulty'],
    applyGameState: args.applyGameState,
    presentMovementResult: (
      state,
      movements,
      ordnanceMovements,
      events,
      done,
    ) =>
      presentMovementResult(
        presentationDeps,
        state,
        movements,
        ordnanceMovements,
        events,
        done,
      ),
    presentCombatResults: (prev, state, results, resetCombatFlag = true) =>
      presentCombatResults(
        presentationDeps,
        prev,
        state,
        results,
        resetCombatFlag,
      ),
    showGameOverOutcome,
    transitionToPhase: args.transitionToPhase,
    logText,
    showToast,
  };

  return {
    astrogationDeps,
    combatDeps,
    ordnanceDeps,
    localGameFlowDeps,
    presentationDeps,
    presentMovementResult: (
      state: GameState,
      movements: Parameters<typeof presentMovementResult>[2],
      ordnanceMovements: Parameters<typeof presentMovementResult>[3],
      events: Parameters<typeof presentMovementResult>[4],
      onComplete: () => void,
    ) =>
      presentMovementResult(
        presentationDeps,
        state,
        movements,
        ordnanceMovements,
        events,
        onComplete,
      ),
    presentCombatResults: (
      previousState: GameState,
      state: GameState,
      results: Parameters<typeof presentCombatResults>[3],
      resetCombatFlag = true,
    ) =>
      presentCombatResults(
        presentationDeps,
        previousState,
        state,
        results,
        resetCombatFlag,
      ),
    showGameOverOutcome,
  };
};

export type ActionDeps = ReturnType<typeof createActionDeps>;
