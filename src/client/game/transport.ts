import type { AIDifficulty } from '../../shared/ai';
import type {
  AstrogationOrder,
  CombatAttack,
  FleetPurchase,
  GameState,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  PlayerId,
  SolarSystemMap,
  TransferOrder,
} from '../../shared/types/domain';
import type { ScenarioDefinition } from '../../shared/types/scenario';
import { TOAST } from '../messages/toasts';
import { resolveLocalFleetReady } from './fleet';
import {
  type LocalResolution,
  resolveAstrogationStep,
  resolveBeginCombatStep,
  resolveCombatStep,
  resolveEmplaceBaseStep,
  resolveEndCombatStep,
  resolveLogisticsStep,
  resolveOrdnanceStep,
  resolveSingleCombatStep,
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
  submitSingleCombat(attack: CombatAttack): void;
  endCombat(): void;
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
  getPlayerId: () => PlayerId;
  getMap: () => SolarSystemMap;
  onResolution: (
    resolution: LocalResolution,
    onContinue: () => void,
    errorPrefix: string,
  ) => void;
  onAnimationComplete: () => void;
  onTransitionToPhase: () => void;
  onEmplacementSuccess: () => void;
  onAdvanceToNextAttacker: () => void;
  onFleetReady: (purchases: FleetPurchase[]) => void;
  onRematch: () => void;
}

const withLocalState = <T>(
  deps: Pick<LocalTransportDeps, 'getState' | 'getPlayerId' | 'getMap'>,
  run: (state: GameState, playerId: PlayerId, map: SolarSystemMap) => T,
): T | null => {
  const state = deps.getState();

  if (!state) {
    return null;
  }

  return run(state, deps.getPlayerId() as PlayerId, deps.getMap());
};

const dispatchLocalResolution = (
  deps: LocalTransportDeps,
  resolve: (
    state: GameState,
    playerId: PlayerId,
    map: SolarSystemMap,
  ) => LocalResolution,
  onContinue: () => void,
  errorPrefix: string,
): void => {
  const resolution = withLocalState(deps, resolve);

  if (!resolution) {
    return;
  }

  deps.onResolution(resolution, onContinue, errorPrefix);
};

export const createLocalTransport = (
  deps: LocalTransportDeps,
): GameTransport => ({
  submitAstrogation(orders) {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) =>
        resolveAstrogationStep(state, playerId, orders, map),
      deps.onAnimationComplete,
      'Local astrogation error:',
    );
  },

  submitCombat(attacks) {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) =>
        resolveCombatStep(state, playerId, attacks, map),
      deps.onTransitionToPhase,
      'Local combat error:',
    );
  },

  submitSingleCombat(attack) {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) =>
        resolveSingleCombatStep(state, playerId, attack, map),
      () => deps.onAdvanceToNextAttacker(),
      'Local single combat error:',
    );
  },

  endCombat() {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) => resolveEndCombatStep(state, playerId, map),
      deps.onTransitionToPhase,
      'Local end combat error:',
    );
  },

  submitOrdnance(launches) {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) =>
        resolveOrdnanceStep(state, playerId, launches, map),
      deps.onAnimationComplete,
      'Local ordnance error:',
    );
  },

  submitEmplacement(emplacements) {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) =>
        resolveEmplaceBaseStep(state, playerId, emplacements, map),
      deps.onEmplacementSuccess,
      'Local emplacement error:',
    );
  },

  submitFleetReady(purchases) {
    deps.onFleetReady(purchases);
  },

  submitLogistics(transfers) {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) =>
        resolveLogisticsStep(state, playerId, transfers, map),
      deps.onTransitionToPhase,
      'Local logistics error:',
    );
  },

  submitSurrender(_shipIds) {
    // Local single-player flow does not expose surrender — it would
    // terminate the match before the AI has a chance to respond. Log
    // the unexpected call so a UI regression that routes surrender
    // here surfaces in dev instead of silently dropping.
    console.warn(
      '[local-transport] submitSurrender is not supported in local mode; ignored',
    );
  },

  skipOrdnance() {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) => resolveSkipOrdnanceStep(state, playerId, map),
      deps.onAnimationComplete,
      'Local skip ordnance error:',
    );
  },

  skipLogistics() {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) => resolveSkipLogisticsStep(state, playerId, map),
      deps.onTransitionToPhase,
      'Local skip logistics error:',
    );
  },

  skipCombat() {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) => resolveSkipCombatStep(state, playerId, map),
      deps.onTransitionToPhase,
      'Local skip combat error:',
    );
  },

  beginCombat() {
    dispatchLocalResolution(
      deps,
      (state, playerId, map) => resolveBeginCombatStep(state, playerId, map),
      deps.onTransitionToPhase,
      'Local combat start error:',
    );
  },

  requestRematch() {
    deps.onRematch();
  },
  sendChat() {
    // Chat is multiplayer-only. Log an unsupported-call diagnostic so a
    // future regression that routes chat here (e.g. a refactor that
    // stops hiding the chat input in single-player) fails loudly.
    console.warn(
      '[local-transport] sendChat is not supported in local mode; ignored',
    );
  },
});

export interface LocalGameTransportDeps {
  getGameState: () => GameState | null;
  getPlayerId: () => PlayerId;
  getMap: () => SolarSystemMap;
  getScenario: () => string;
  getScenarioDef: () => ScenarioDefinition;
  getAIDifficulty: () => AIDifficulty;
  localGameFlowDeps: LocalGameFlowDeps;
  applyGameState: (state: GameState) => void;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  logText: (text: string, cssClass?: string) => void;
  logScenarioBriefing: () => void;
  transitionToPhase: () => void;
  onAnimationComplete: () => void;
  advanceToNextAttacker: () => void;
  startLocalGame: (scenario: string) => void;
}

const handleLocalFleetReady = (
  deps: Pick<
    LocalGameTransportDeps,
    | 'getGameState'
    | 'getPlayerId'
    | 'getMap'
    | 'getScenarioDef'
    | 'getAIDifficulty'
    | 'applyGameState'
    | 'showToast'
    | 'logScenarioBriefing'
    | 'transitionToPhase'
  >,
  purchases: FleetPurchase[],
): void => {
  const state = deps.getGameState();

  if (!state) {
    return;
  }

  const result = resolveLocalFleetReady(
    state,
    deps.getPlayerId() as PlayerId,
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
};

// Higher-level factory that wraps `createLocalTransport`
// with fleet-ready resolution, emplacement handling, and
// game-flow callbacks. Used by single-player mode.
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
    onAdvanceToNextAttacker: deps.advanceToNextAttacker,
    // Emplacement state has already been applied through the shared
    // local-resolution path; log only so we do not stack a success toast
    // alongside engine/logistics lines for the same action.
    onEmplacementSuccess: () =>
      deps.logText(TOAST.gameplay.orbitalBaseEmplaced, 'log-env'),
    onFleetReady: (purchases) => handleLocalFleetReady(deps, purchases),
    onRematch: () => deps.startLocalGame(deps.getScenario()),
  });

export const createWebSocketTransport = (
  send: (msg: unknown) => void,
): GameTransport => ({
  submitAstrogation: (orders) => send({ type: 'astrogation', orders }),
  submitCombat: (attacks) => send({ type: 'combat', attacks }),
  submitSingleCombat: (attack) => send({ type: 'combatSingle', attack }),
  endCombat: () => send({ type: 'endCombat' }),
  submitOrdnance: (launches) => send({ type: 'ordnance', launches }),
  submitEmplacement: (emplacements) =>
    send({ type: 'emplaceBase', emplacements }),
  submitFleetReady: (purchases) => send({ type: 'fleetReady', purchases }),
  submitLogistics: (transfers) => send({ type: 'logistics', transfers }),
  submitSurrender: (shipIds) => send({ type: 'surrender', shipIds }),
  skipOrdnance: () => send({ type: 'skipOrdnance' }),
  skipCombat: () => send({ type: 'skipCombat' }),
  skipLogistics: () => send({ type: 'skipLogistics' }),
  beginCombat: () => send({ type: 'beginCombat' }),
  requestRematch: () => send({ type: 'rematch' }),
  sendChat: (text) => send({ type: 'chat', text }),
});
