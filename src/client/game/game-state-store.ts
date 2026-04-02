/**
 * Authoritative `ClientSession.gameState` writes happen through this module
 * (`applyClientGameState` / `clearClientGameState`).
 * Other session-owned slices (for example `logisticsState`) are managed by
 * their respective transition modules.
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
import type { PlanningStore } from './planning';

type PlanningStateLike = Pick<
  PlanningStore,
  'selectedShipId' | 'setSelectedShipId'
>;

interface GameStateStoreContext {
  gameState: GameState | null;
  planningState: PlanningStateLike;
}

interface GameStateStoreRenderer {
  setGameState: (state: GameState | null) => void;
}

export interface ApplyClientGameStateDeps {
  ctx: GameStateStoreContext;
  /** When true, all ships are made visible (spectator sees everything). */
  isSpectator?: boolean;
  /** When set, called after `ctx` is updated (e.g. tests). Omitted in the shell — session effects drive the renderer. */
  renderer?: GameStateStoreRenderer;
}

const projectClientVisibleState = (
  state: GameState,
  isSpectator = false,
): GameState => {
  if (!isSpectator) {
    return state;
  }

  return {
    ...state,
    ships: state.ships.map((ship) =>
      ship.detected ? ship : { ...ship, detected: true },
    ),
  };
};

export const applyClientGameState = (
  deps: ApplyClientGameStateDeps,
  state: GameState,
): void => {
  const visibleState = projectClientVisibleState(state, deps.isSpectator);

  batch(() => {
    deps.ctx.gameState = visibleState;

    const selectedId = deps.ctx.planningState.selectedShipId;

    if (selectedId) {
      const selectedShip = visibleState.ships.find(
        (ship) => ship.id === selectedId,
      );

      if (!selectedShip || selectedShip.lifecycle === 'destroyed') {
        deps.ctx.planningState.setSelectedShipId(null);
      }
    }

    deps.renderer?.setGameState(visibleState);
  });
};

export const clearClientGameState = (
  ctx: Pick<GameStateStoreContext, 'gameState'>,
): void => {
  batch(() => {
    ctx.gameState = null;
  });
};
