import { processEmplacement } from '../../shared/engine/game-engine';
import type {
  AstrogationOrder,
  CombatAttack,
  FleetPurchase,
  GameState,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  SolarSystemMap,
} from '../../shared/types';
import {
  type LocalResolution,
  resolveAstrogationStep,
  resolveBeginCombatStep,
  resolveCombatStep,
  resolveOrdnanceStep,
  resolveSkipCombatStep,
  resolveSkipOrdnanceStep,
} from './local';

export interface GameTransport {
  submitAstrogation(orders: AstrogationOrder[]): void;
  submitCombat(attacks: CombatAttack[]): void;
  submitOrdnance(launches: OrdnanceLaunch[]): void;
  submitEmplacement(emplacements: OrbitalBaseEmplacement[]): void;
  submitFleetReady(purchases: FleetPurchase[]): void;
  skipOrdnance(): void;
  skipCombat(): void;
  beginCombat(): void;
  requestRematch(): void;
}

export interface LocalTransportDeps {
  getState: () => GameState | null;
  getPlayerId: () => number;
  getMap: () => SolarSystemMap;
  onResolution: (resolution: LocalResolution, onContinue: () => void, errorPrefix: string) => void;
  onAnimationComplete: () => void;
  onTransitionToPhase: () => void;
  onEmplacementResult: (result: { state: GameState } | { error: string }) => void;
  onFleetReady: (purchases: FleetPurchase[]) => void;
  onRematch: () => void;
}

export const createLocalTransport = (deps: LocalTransportDeps): GameTransport => ({
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
    const result = processEmplacement(state, deps.getPlayerId(), emplacements, deps.getMap());
    deps.onEmplacementResult(result);
  },

  submitFleetReady(purchases) {
    deps.onFleetReady(purchases);
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
});

export const createWebSocketTransport = (send: (msg: unknown) => void): GameTransport => ({
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
  skipOrdnance() {
    send({ type: 'skipOrdnance' });
  },
  skipCombat() {
    send({ type: 'skipCombat' });
  },
  beginCombat() {
    send({ type: 'beginCombat' });
  },
  requestRematch() {
    send({ type: 'rematch' });
  },
});
