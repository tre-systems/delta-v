/**
 * Authoritative match state on the client lives on `ClientSession` and is written
 * only through here (`applyClientGameState` / `clearClientGameState`) plus the
 * optional mirror hooks used by `session-signals.ts`.
 *
 * **Who may call what (client shell):**
 * - `setState` / `applyClientStateTransition`: only via `createGameClient`’s
 *   `setState` closure (session + network flows).
 * - `applyGameState`: `createGameClient` wrapper, replay, local transport, and
 *   `message-handler` / presentation paths that apply server or local engine state.
 * - `clearClientGameState`: `exitToMenuSession` only.
 * - `renderer.setGameState` / `clearTrails`: presentation, replay, session
 *   start/exit, and `message-handler` where documented in those modules.
 * - `hud.updateHUD`: non-planning paths (e.g. camera); mirrored `gameState`,
 *   `clientState`, and planning revision also trigger `attachSessionMirrorHudEffect`.
 */
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
  /** Optional sync after ctx/renderer (e.g. reactive mirror signals). */
  afterApply?: (state: GameState) => void;
}

export const applyClientGameState = (
  deps: ApplyClientGameStateDeps,
  state: GameState,
): void => {
  deps.ctx.gameState = state;
  deps.renderer.setGameState(state);

  const selectedId = deps.ctx.planningState.selectedShipId;

  if (!selectedId) {
    deps.afterApply?.(state);
    return;
  }

  const selectedShip = state.ships.find((ship) => ship.id === selectedId);

  if (!selectedShip || selectedShip.lifecycle === 'destroyed') {
    setSelectedShipId(deps.ctx.planningState, null);
  }
  deps.afterApply?.(state);
};

export const clearClientGameState = (
  ctx: Pick<GameStateStoreContext, 'gameState'>,
  afterClear?: () => void,
): void => {
  ctx.gameState = null;
  afterClear?.();
};
