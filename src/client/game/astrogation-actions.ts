import { must } from '../../shared/assert';
import { getOrderableShipsForPlayer } from '../../shared/engine/util';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { playConfirm, playSelect } from '../audio';
import { deriveBurnChangePlan } from './burn';
import { buildAstrogationOrders } from './helpers';
import type { PlanningStore } from './planning';
import type { GameTransport } from './transport';
export interface AstrogationActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getPlayerId: () => PlayerId;
  getTransport: () => GameTransport | null;
  planningState: PlanningStore;
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
    deps.planningState.clearShipPlanning(targetId);
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

  deps.planningState.setShipBurn(
    plan.shipId,
    plan.nextBurn,
    plan.clearOverload,
  );
  deps.planningState.acknowledgeShip(plan.shipId);
  playSelect();

  // Auto-advance to the next ship in rotation that still needs acknowledgment
  const gameState = deps.getGameState();

  if (gameState) {
    const orderable = getOrderableShipsForPlayer(
      gameState,
      deps.getPlayerId() as PlayerId,
    );
    const currentIdx = orderable.findIndex((s) => s.id === plan.shipId);

    for (let offset = 1; offset < orderable.length; offset++) {
      const next = orderable[(currentIdx + offset) % orderable.length];

      if (
        !deps.planningState.acknowledgedShips.has(next.id) &&
        next.damage.disabledTurns === 0
      ) {
        deps.planningState.selectShip(next.id);
        return;
      }
    }
  }
};

// Acknowledge the current ship without setting a burn (it will drift).
// Auto-advances to the next unacknowledged ship.
export const skipShipBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;
  if (!shipId) return;

  deps.planningState.acknowledgeShip(shipId);

  const gameState = deps.getGameState();
  if (gameState) {
    const orderable = getOrderableShipsForPlayer(
      gameState,
      deps.getPlayerId() as PlayerId,
    );
    const currentIdx = orderable.findIndex((s) => s.id === shipId);

    for (let offset = 1; offset < orderable.length; offset++) {
      const next = orderable[(currentIdx + offset) % orderable.length];
      if (
        !deps.planningState.acknowledgedShips.has(next.id) &&
        next.damage.disabledTurns === 0
      ) {
        deps.planningState.selectShip(next.id);
        return;
      }
    }
  }
};

export const clearSelectedBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;

  if (!shipId) return;
  deps.planningState.clearShipPlanning(shipId);
};

export const undoSelectedShipBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;

  if (shipId) {
    deps.planningState.clearShipPlanning(shipId);
  }
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
    deps.getPlayerId() as PlayerId,
    deps.planningState,
  );
  playConfirm();
  transport.submitAstrogation(orders);
};
