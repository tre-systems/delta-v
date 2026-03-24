import { must } from '../../shared/assert';
import type { GameState } from '../../shared/types/domain';
import { playConfirm, playSelect } from '../audio';
import { deriveBurnChangePlan } from './burn';
import { buildAstrogationOrders, findMatchVelocityPlan } from './helpers';
import type { PlanningState } from './planning';
import {
  clearShipPlanning,
  setShipBurn,
  setShipOverload,
} from './planning-store';
import type { GameTransport } from './transport';
export interface AstrogationActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getPlayerId: () => number;
  getTransport: () => GameTransport | null;
  planningState: PlanningState;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
}

export const setBurnDirection = (
  deps: AstrogationActionDeps,
  dir: number | null,
  shipId?: string,
) => {
  if (deps.getClientState() !== 'playing_astrogation') return;
  const targetId = shipId ?? deps.planningState.selectedShipId;

  if (!targetId) return;

  if (dir === null) {
    clearShipPlanning(deps.planningState, targetId);
    return;
  }
  const currentBurn = deps.planningState.burns.get(targetId) ?? null;
  const plan = deriveBurnChangePlan(
    deps.getGameState(),
    targetId,
    dir,
    currentBurn,
  );

  if (plan.kind === 'error') {
    deps.showToast(plan.message, must(plan.level));
    return;
  }

  if (plan.kind === 'noop') {
    return;
  }

  setShipBurn(
    deps.planningState,
    plan.shipId,
    plan.nextBurn,
    plan.clearOverload,
  );
  playSelect();
};

export const clearSelectedBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;

  if (!shipId) return;
  clearShipPlanning(deps.planningState, shipId);
};

export const undoSelectedShipBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;

  if (shipId) {
    clearShipPlanning(deps.planningState, shipId);
  }
};

export const matchVelocityWithNearbyFriendly = (
  deps: AstrogationActionDeps,
) => {
  const gameState = deps.getGameState();
  const shipId = deps.planningState.selectedShipId;

  if (
    !gameState ||
    shipId === null ||
    deps.getClientState() !== 'playing_astrogation'
  ) {
    return;
  }

  const plan = findMatchVelocityPlan(gameState, deps.getPlayerId(), shipId);

  if (!plan) {
    deps.showToast('No nearby friendly velocity match available', 'info');
    return;
  }

  setShipBurn(deps.planningState, shipId, plan.burn, true);
  setShipOverload(deps.planningState, shipId, plan.overload);
  playSelect();
  deps.showToast(`Matching velocity with ${plan.targetShipId}`, 'success');
};

export const confirmOrders = (deps: AstrogationActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();

  if (
    !gameState ||
    deps.getClientState() !== 'playing_astrogation' ||
    !transport
  )
    return;
  const orders = buildAstrogationOrders(
    gameState,
    deps.getPlayerId(),
    deps.planningState,
  );
  playConfirm();
  transport.submitAstrogation(orders);
};
