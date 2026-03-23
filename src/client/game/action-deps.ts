import type { MovementResult } from '../../shared/engine/game-engine';
import type {
  CombatResult,
  GameState,
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
import type { PlanningState } from './planning';
import {
  type PresentationDeps,
  presentCombatResults as presentCombat,
  presentMovementResult as presentMovement,
  showGameOverOutcome as showGameOver,
} from './presentation';

export interface ActionDepsArgs {
  getGameState: () => GameState | null;
  getClientState: () => ClientState;
  getPlayerId: () => number;
  getTransport: () => { submitAstrogation: unknown } | null;
  getMap: () => SolarSystemMap;
  getAIDifficulty: () => string;
  getScenario: () => string;
  getIsLocalGame: () => boolean;
  planningState: PlanningState;
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
  let cachedPresentation: PresentationDeps | null = null;
  let cachedAstrogation: AstrogationActionDeps | null = null;
  let cachedCombat: CombatActionDeps | null = null;
  let cachedOrdnance: OrdnanceActionDeps | null = null;
  let cachedLocalFlow: LocalGameFlowDeps | null = null;

  const getPresentationDeps = (): PresentationDeps => {
    if (!cachedPresentation) {
      cachedPresentation = {
        applyGameState: (state) => args.applyGameState(state),
        setState: (newState) => args.setState(newState as ClientState),
        resetCombatState: () => args.resetCombatState(),
        getGameState: args.getGameState,
        getPlayerId: args.getPlayerId,
        onGameOverShown: () => args.onGameOverShown(),
        renderer: args.renderer,
        ui: args.ui,
      };
    }
    return cachedPresentation;
  };

  const getAstrogationDeps = (): AstrogationActionDeps => {
    if (!cachedAstrogation) {
      cachedAstrogation = {
        getGameState: args.getGameState,
        getClientState: args.getClientState,
        getPlayerId: args.getPlayerId,
        getTransport:
          args.getTransport as AstrogationActionDeps['getTransport'],
        planningState: args.planningState,
        updateHUD: () => args.hud.updateHUD(),
        showToast: (msg, type) => args.ui.overlay.showToast(msg, type),
      };
    }
    return cachedAstrogation;
  };

  const getCombatDeps = (): CombatActionDeps => {
    if (!cachedCombat) {
      cachedCombat = {
        getGameState: args.getGameState,
        getClientState: args.getClientState,
        getPlayerId: args.getPlayerId,
        getTransport: args.getTransport as CombatActionDeps['getTransport'],
        getMap: args.getMap,
        planningState: args.planningState,
        showToast: (msg, type) => args.ui.overlay.showToast(msg, type),
        showAttackButton: (v) => args.ui.showAttackButton(v),
        showFireButton: (v, c) => args.ui.showFireButton(v, c),
      };
    }
    return cachedCombat;
  };

  const getOrdnanceDeps = (): OrdnanceActionDeps => {
    if (!cachedOrdnance) {
      cachedOrdnance = {
        getGameState: args.getGameState,
        getClientState: args.getClientState,
        getTransport: args.getTransport as OrdnanceActionDeps['getTransport'],
        planningState: args.planningState,
        showToast: (msg, type) => args.ui.overlay.showToast(msg, type),
        logText: (text) => args.ui.log.logText(text),
      };
    }
    return cachedOrdnance;
  };

  const getLocalGameFlowDeps = (): LocalGameFlowDeps => {
    if (!cachedLocalFlow) {
      cachedLocalFlow = {
        getGameState: args.getGameState,
        getPlayerId: args.getPlayerId,
        getMap: args.getMap,
        getAIDifficulty:
          args.getAIDifficulty as LocalGameFlowDeps['getAIDifficulty'],
        applyGameState: (state) => args.applyGameState(state),
        presentMovementResult: (
          state,
          movements,
          ordnanceMovements,
          events,
          onComplete,
        ) =>
          presentMovement(
            getPresentationDeps(),
            state,
            movements,
            ordnanceMovements,
            events,
            onComplete,
          ),
        presentCombatResults: (prev, state, results, reset) =>
          presentCombat(getPresentationDeps(), prev, state, results, reset),
        showGameOverOutcome: (won, reason) => showGameOverOutcome(won, reason),
        transitionToPhase: () => args.transitionToPhase(),
        logText: (text) => args.ui.log.logText(text),
      };
    }
    return cachedLocalFlow;
  };

  const presentMovementResult = (
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

  const presentCombatResults = (
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
    presentCombatResults,
    showGameOverOutcome,
  };
};

export type ActionDeps = ReturnType<typeof createActionDeps>;
