/**
 * Authoritative match state on the client lives on `ClientSession` and is written
 * only through here (`applyClientGameState` / `clearClientGameState`).
 *
 * **Who may call what (client shell):**
 * - `setState` / `applyClientStateTransition`: only via `createGameClient`’s
 *   `setState` closure (session + network flows).
 * - `applyGameState`: `createGameClient` wrapper, replay, local transport, and
 *   `message-handler` / presentation paths that apply server or local engine state.
 * - `clearClientGameState`: `exitToMenuSession` only.
 * - `renderer.setGameState` / `clearTrails`: optional on `applyClientGameState`
 *   (unit tests); the shell syncs the canvas from `ctx.gameStateSignal` via
 *   `attachRendererGameStateEffect`. Also presentation, replay, session
 *   lifecycle, and `message-handler` where documented in those modules.
 * - `hud.updateHUD`: reactive session `gameState` / `state` plus planning revision
 *   drive `attachSessionHudEffect`; `hud-controller` may also call `updateHUD`
 *   when reconciling selection from the derived view model.
 */
import type { GameState } from '../../shared/types/domain';
import { batch } from '../reactive';
import { setSelectedShipId } from './planning-store';

interface PlanningStateLike {
  selectedShipId: string | null;
}

interface GameStateStoreContext {
  gameState: GameState | null;
  planningState: PlanningStateLike;
}

interface GameStateStoreRenderer {
  setGameState: (state: GameState | null) => void;
}

export interface ApplyClientGameStateDeps {
  ctx: GameStateStoreContext;
  /** When set, called after `ctx` is updated (e.g. tests). Omitted in the shell — session effects drive the renderer. */
  renderer?: GameStateStoreRenderer;
}

export const applyClientGameState = (
  deps: ApplyClientGameStateDeps,
  state: GameState,
): void => {
  batch(() => {
    deps.ctx.gameState = state;

    const selectedId = deps.ctx.planningState.selectedShipId;

    if (selectedId) {
      const selectedShip = state.ships.find((ship) => ship.id === selectedId);

      if (!selectedShip || selectedShip.lifecycle === 'destroyed') {
        setSelectedShipId(deps.ctx.planningState, null);
      }
    }

    deps.renderer?.setGameState(state);
  });
};

export const clearClientGameState = (
  ctx: Pick<GameStateStoreContext, 'gameState'>,
): void => {
  batch(() => {
    ctx.gameState = null;
  });
};
