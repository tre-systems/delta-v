import type { GameState } from '../../shared/types/domain';
import { setSelectedShipId } from './planning-store';

interface PlanningStateLike {
  selectedShipId: string | null;
}

interface GameStateStoreContext {
  gameState: GameState | null;
  planningState: PlanningStateLike;
}

interface GameStateStoreRenderer {
  setGameState: (state: GameState) => void;
}

export interface ApplyClientGameStateDeps {
  ctx: GameStateStoreContext;
  renderer: GameStateStoreRenderer;
}

export const applyClientGameState = (
  deps: ApplyClientGameStateDeps,
  state: GameState,
): void => {
  deps.ctx.gameState = state;
  deps.renderer.setGameState(state);

  const selectedId = deps.ctx.planningState.selectedShipId;
  if (!selectedId) {
    return;
  }

  const selectedShip = state.ships.find((ship) => ship.id === selectedId);
  if (!selectedShip || selectedShip.destroyed) {
    setSelectedShipId(deps.ctx.planningState, null);
  }
};

export const clearClientGameState = (
  ctx: Pick<GameStateStoreContext, 'gameState'>,
): void => {
  ctx.gameState = null;
};
