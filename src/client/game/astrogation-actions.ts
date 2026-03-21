import { must } from '../../shared/assert';
import type { GameState } from '../../shared/types';
import { playConfirm, playSelect } from '../audio';
import { deriveBurnChangePlan } from './burn';
import { buildAstrogationOrders } from './helpers';
import type { PlanningState } from './planning';
import { clearShipPlanning, setShipBurn } from './planning-store';
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
    clearShipPlanning(deps.planningState, targetId);
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
  deps.updateHUD();
};
export const clearSelectedBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;
  if (!shipId) return;
  clearShipPlanning(deps.planningState, shipId);
  deps.updateHUD();
};
export const undoSelectedShipBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;
  if (shipId) {
    clearShipPlanning(deps.planningState, shipId);
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
