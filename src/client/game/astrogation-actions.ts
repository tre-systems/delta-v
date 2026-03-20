import type { GameState } from '../../shared/types';
import { playConfirm, playSelect } from '../audio';
import { deriveBurnChangePlan } from './burn';
import { buildAstrogationOrders } from './helpers';
import type { PlanningState } from './planning';
import type { GameTransport } from './transport';

export interface AstrogationActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getPlayerId: () => number;
  getTransport: () => GameTransport | null;
  planningState: PlanningState;
  updateHUD: () => void;
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
    deps.planningState.burns.delete(targetId);
    deps.planningState.overloads.delete(targetId);
    deps.planningState.weakGravityChoices.delete(targetId);
    deps.updateHUD();
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
    deps.showToast(plan.message, plan.level!);
    return;
  }
  if (plan.kind === 'noop') {
    return;
  }

  deps.planningState.burns.set(plan.shipId, plan.nextBurn);
  if (plan.clearOverload) {
    deps.planningState.overloads.delete(plan.shipId);
  }
  playSelect();
  deps.updateHUD();
};

export const clearSelectedBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;
  if (!shipId) return;
  deps.planningState.burns.delete(shipId);
  deps.planningState.overloads.delete(shipId);
  deps.planningState.weakGravityChoices.delete(shipId);
  deps.updateHUD();
};

export const undoSelectedShipBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;
  if (shipId) {
    deps.planningState.burns.delete(shipId);
    deps.planningState.overloads.delete(shipId);
    deps.planningState.weakGravityChoices.delete(shipId);
  }
  deps.updateHUD();
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
