import type { AIDifficulty } from '../../shared/ai';
import { processEmplacement } from '../../shared/engine/game-engine';
import type {
  AstrogationOrder,
  CombatAttack,
  FleetPurchase,
  GameState,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  SolarSystemMap,
  TransferOrder,
} from '../../shared/types/domain';
import type { ScenarioDefinition } from '../../shared/types/scenario';
import { resolveLocalFleetReady } from './fleet';
import {
  type LocalResolution,
  resolveAstrogationStep,
  resolveBeginCombatStep,
  resolveCombatStep,
  resolveLogisticsStep,
  resolveOrdnanceStep,
  resolveSkipCombatStep,
  resolveSkipLogisticsStep,
  resolveSkipOrdnanceStep,
} from './local';
import {
  handleLocalResolution,
  type LocalGameFlowDeps,
} from './local-game-flow';

export interface GameTransport {
  submitAstrogation(orders: AstrogationOrder[]): void;
  submitCombat(attacks: CombatAttack[]): void;
  submitOrdnance(launches: OrdnanceLaunch[]): void;
  submitEmplacement(emplacements: OrbitalBaseEmplacement[]): void;
  submitFleetReady(purchases: FleetPurchase[]): void;
  submitLogistics(transfers: TransferOrder[]): void;
  submitSurrender(shipIds: string[]): void;
  skipOrdnance(): void;
  skipCombat(): void;
  skipLogistics(): void;
  beginCombat(): void;
  requestRematch(): void;
  sendChat(text: string): void;
}

export interface LocalTransportDeps {
  getState: () => GameState | null;
  getPlayerId: () => number;
  getMap: () => SolarSystemMap;
  onResolution: (
    resolution: LocalResolution,
    onContinue: () => void,
    errorPrefix: string,
  ) => void;
  onAnimationComplete: () => void;
  onTransitionToPhase: () => void;
  onEmplacementResult: (
    result: { state: GameState } | { error: string },
  ) => void;
  onFleetReady: (purchases: FleetPurchase[]) => void;
  onRematch: () => void;
}

export const createLocalTransport = (
  deps: LocalTransportDeps,
): GameTransport => ({
  submitAstrogation(orders) {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveAstrogationStep(state, deps.getPlayerId(), orders, deps.getMap()),
      deps.onAnimationComplete,
      'Local astrogation error:',
    );
  },

  submitCombat(attacks) {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveCombatStep(state, deps.getPlayerId(), attacks, deps.getMap()),
      deps.onTransitionToPhase,
      'Local combat error:',
    );
  },

  submitOrdnance(launches) {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveOrdnanceStep(state, deps.getPlayerId(), launches, deps.getMap()),
      deps.onAnimationComplete,
      'Local ordnance error:',
    );
  },

  submitEmplacement(emplacements) {
    const state = deps.getState();
    if (!state) return;
    const result = processEmplacement(
      state,
      deps.getPlayerId(),
      emplacements,
      deps.getMap(),
    );
    deps.onEmplacementResult(result);
  },

  submitFleetReady(purchases) {
    deps.onFleetReady(purchases);
  },

  submitLogistics(transfers) {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveLogisticsStep(state, deps.getPlayerId(), transfers, deps.getMap()),
      deps.onTransitionToPhase,
      'Local logistics error:',
    );
  },

  submitSurrender(_shipIds) {
    // Surrender in local games is handled directly via engine — not typically used vs AI
  },

  skipOrdnance() {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveSkipOrdnanceStep(state, deps.getPlayerId(), deps.getMap()),
      deps.onAnimationComplete,
      'Local skip ordnance error:',
    );
  },

  skipLogistics() {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveSkipLogisticsStep(state, deps.getPlayerId(), deps.getMap()),
      deps.onTransitionToPhase,
      'Local skip logistics error:',
    );
  },

  skipCombat() {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveSkipCombatStep(state, deps.getPlayerId(), deps.getMap()),
      deps.onTransitionToPhase,
      'Local skip combat error:',
    );
  },

  beginCombat() {
    const state = deps.getState();
    if (!state) return;
    deps.onResolution(
      resolveBeginCombatStep(state, deps.getPlayerId(), deps.getMap()),
      deps.onTransitionToPhase,
      'Local combat start error:',
    );
  },

  requestRematch() {
    deps.onRematch();
  },
  sendChat() {
    // No chat in local/AI games
  },
});

export interface LocalGameTransportDeps {
  getGameState: () => GameState | null;
  getPlayerId: () => number;
  getMap: () => SolarSystemMap;
  getScenario: () => string;
  getScenarioDef: () => ScenarioDefinition;
  getAIDifficulty: () => AIDifficulty;
  localGameFlowDeps: LocalGameFlowDeps;
  applyGameState: (state: GameState) => void;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  updateHUD: () => void;
  logScenarioBriefing: () => void;
  transitionToPhase: () => void;
  onAnimationComplete: () => void;
  startLocalGame: (scenario: string) => void;
}

/**
 * Higher-level factory that wraps `createLocalTransport`
 * with fleet-ready resolution, emplacement handling, and
 * game-flow callbacks. Used by single-player mode.
 */
export const createLocalGameTransport = (
  deps: LocalGameTransportDeps,
): GameTransport =>
  createLocalTransport({
    getState: deps.getGameState,
    getPlayerId: deps.getPlayerId,
    getMap: deps.getMap,
    onResolution: (resolution, onContinue, errorPrefix) =>
      handleLocalResolution(
        deps.localGameFlowDeps,
        resolution,
        onContinue,
        errorPrefix,
      ),
    onAnimationComplete: deps.onAnimationComplete,
    onTransitionToPhase: deps.transitionToPhase,
    onEmplacementResult: (result) => {
      if ('error' in result) {
        deps.showToast(result.error, 'error');
        return;
      }
      deps.applyGameState(result.state);
      deps.showToast('Orbital base emplaced!', 'success');
      deps.updateHUD();
    },
    onFleetReady: (purchases) => {
      const state = deps.getGameState();
      if (!state) return;
      const result = resolveLocalFleetReady(
        state,
        deps.getPlayerId(),
        purchases,
        deps.getMap(),
        deps.getScenarioDef(),
        deps.getAIDifficulty(),
      );
      if (result.kind === 'error') {
        deps.showToast(result.error, 'error');
        return;
      }
      deps.applyGameState(result.state);
      if (result.aiError) {
        console.error('AI fleet build error:', result.aiError);
      }
      deps.logScenarioBriefing();
      deps.transitionToPhase();
    },
    onRematch: () => deps.startLocalGame(deps.getScenario()),
  });

export const createWebSocketTransport = (
  send: (msg: unknown) => void,
): GameTransport => ({
  submitAstrogation(orders) {
    send({ type: 'astrogation', orders });
  },
  submitCombat(attacks) {
    send({ type: 'combat', attacks });
  },
  submitOrdnance(launches) {
    send({ type: 'ordnance', launches });
  },
  submitEmplacement(emplacements) {
    send({ type: 'emplaceBase', emplacements });
  },
  submitFleetReady(purchases) {
    send({ type: 'fleetReady', purchases });
  },
  submitLogistics(transfers) {
    send({ type: 'logistics', transfers });
  },
  submitSurrender(shipIds) {
    send({ type: 'surrender', shipIds });
  },
  skipOrdnance() {
    send({ type: 'skipOrdnance' });
  },
  skipCombat() {
    send({ type: 'skipCombat' });
  },
  skipLogistics() {
    send({ type: 'skipLogistics' });
  },
  beginCombat() {
    send({ type: 'beginCombat' });
  },
  requestRematch() {
    send({ type: 'rematch' });
  },
  sendChat(text) {
    send({ type: 'chat', text });
  },
});
