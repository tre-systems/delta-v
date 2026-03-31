import type { MovementResult } from '../../shared/engine/game-engine';
import type {
  CombatResult,
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
  presentCombatResults as presentCombat,
  presentMovementResult as presentMovement,
  showGameOverOutcome as showGameOver,
} from './presentation';

// Sub-dep bundles are created lazily and cached so `createActionDeps` does not
// allocate fresh astrogation/combat/ordnance/local-flow objects on every access
// (those getters are read frequently from input and the game loop).

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

const createCachedValue = <T>(build: () => T): (() => T) => {
  let cached: T | undefined;

  return () => {
    if (cached === undefined) {
      cached = build();
    }

    return cached;
  };
};

export const createActionDeps = (args: ActionDepsArgs) => {
  const showToast = (message: string, type: 'error' | 'info' | 'success') => {
    args.ui.overlay.showToast(message, type);
  };

  const logText = (text: string) => {
    args.ui.log.logText(text);
  };

  const getPresentationDeps = createCachedValue<PresentationDeps>(() => ({
    applyGameState: args.applyGameState,
    setState: args.setState,
    resetCombatState: args.resetCombatState,
    getGameState: args.getGameState,
    getPlayerId: args.getPlayerId,
    onGameOverShown: args.onGameOverShown,
    renderer: args.renderer,
    ui: args.ui,
  }));

  const getAstrogationDeps = createCachedValue<AstrogationActionDeps>(() => ({
    getGameState: args.getGameState,
    getClientState: args.getClientState,
    getPlayerId: args.getPlayerId,
    getTransport: args.getTransport as AstrogationActionDeps['getTransport'],
    planningState: args.planningState,
    showToast,
  }));

  const getCombatDeps = createCachedValue<CombatActionDeps>(() => ({
    getGameState: args.getGameState,
    getClientState: args.getClientState,
    getPlayerId: args.getPlayerId,
    getTransport: args.getTransport as CombatActionDeps['getTransport'],
    getMap: args.getMap,
    planningState: args.planningState,
    showToast,
  }));

  const getOrdnanceDeps = createCachedValue<OrdnanceActionDeps>(() => ({
    getGameState: args.getGameState,
    getClientState: args.getClientState,
    getTransport: args.getTransport as OrdnanceActionDeps['getTransport'],
    planningState: args.planningState,
    showToast,
    logText,
  }));

  const presentMovementWithPresentationDeps = (
    state: GameState,
    movements: MovementResult['movements'],
    ordnanceMovements: MovementResult['ordnanceMovements'],
    events: MovementResult['events'],
    onComplete: () => void,
  ) => {
    presentMovement(
      getPresentationDeps(),
      state,
      movements,
      ordnanceMovements,
      events,
      onComplete,
    );
  };

  const presentCombatWithPresentationDeps = (
    previousState: GameState,
    state: GameState,
    results: CombatResult[],
    resetCombatFlag = true,
  ) => {
    presentCombat(
      getPresentationDeps(),
      previousState,
      state,
      results,
      resetCombatFlag,
    );
  };

  const showGameOverOutcome = (won: boolean, reason: string) => {
    args.track('game_over', {
      won,
      reason,
      scenario: args.getScenario(),
      mode: args.getIsLocalGame() ? 'local' : 'multiplayer',
      turn: args.getGameState()?.turnNumber,
    });
    showGameOver(getPresentationDeps(), won, reason);
  };

  const getLocalGameFlowDeps = createCachedValue<LocalGameFlowDeps>(() => ({
    getGameState: args.getGameState,
    getPlayerId: args.getPlayerId,
    getMap: args.getMap,
    getAIDifficulty:
      args.getAIDifficulty as LocalGameFlowDeps['getAIDifficulty'],
    applyGameState: args.applyGameState,
    presentMovementResult: presentMovementWithPresentationDeps,
    presentCombatResults: presentCombatWithPresentationDeps,
    showGameOverOutcome,
    transitionToPhase: args.transitionToPhase,
    logText,
    showToast,
  }));

  const presentMovementResult = (
    state: GameState,
    movements: MovementResult['movements'],
    ordnanceMovements: MovementResult['ordnanceMovements'],
    events: MovementResult['events'],
    onComplete: () => void,
  ) => {
    presentMovementWithPresentationDeps(
      state,
      movements,
      ordnanceMovements,
      events,
      onComplete,
    );
  };

  return {
    get astrogationDeps() {
      return getAstrogationDeps();
    },
    get combatDeps() {
      return getCombatDeps();
    },
    get ordnanceDeps() {
      return getOrdnanceDeps();
    },
    get localGameFlowDeps() {
      return getLocalGameFlowDeps();
    },
    get presentationDeps() {
      return getPresentationDeps();
    },
    presentMovementResult,
    presentCombatResults: presentCombatWithPresentationDeps,
    showGameOverOutcome,
  };
};

export type ActionDeps = ReturnType<typeof createActionDeps>;
