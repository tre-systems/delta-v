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
} from '../../shared/types';
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
