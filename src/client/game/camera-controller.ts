import type { GameState, PlayerId } from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import type { Renderer } from '../renderer/renderer';
import { HEX_SIZE } from '../renderer/renderer';
import {
  getNearestEnemyPosition,
  getNextSelectedShip,
  getOwnFleetFocusPosition,
} from './navigation';
import type { PlanningSelectionStore } from './planning';

export interface CameraControllerDeps {
  getGameState: () => GameState | null;
  getPlayerId: () => PlayerId | -1;
  getPlanningState: () => PlanningSelectionStore;
  renderer: Renderer;
  /** Navigation hints that should not stack as toasts (see notification-policy). */
  logText: (text: string, cssClass?: string) => void;
}

export const createCameraController = (deps: CameraControllerDeps) => ({
  cycleShip: (direction: number) => {
    const state = deps.getGameState();

    if (!state) return;
    const nextShip = getNextSelectedShip(
      state,
      deps.getPlayerId(),
      deps.getPlanningState().selectedShipId,
      direction,
    );

    if (!nextShip) return;
    deps.getPlanningState().setSelectedShipId(nextShip.id);
    deps.renderer.centerOnHex(nextShip.position);
  },

  focusNearestEnemy: () => {
    const state = deps.getGameState();

    if (!state) return;
    const position = getNearestEnemyPosition(
      state,
      deps.getPlayerId(),
      deps.renderer.camera.x,
      deps.renderer.camera.y,
      HEX_SIZE,
    );

    if (!position) {
      deps.logText(TOAST.gameplay.noDetectedEnemies, 'log-env');
      return;
    }
    deps.renderer.centerOnHex(position);
  },

  focusOwnFleet: () => {
    const state = deps.getGameState();

    if (!state) return;
    const position = getOwnFleetFocusPosition(
      state,
      deps.getPlayerId(),
      deps.getPlanningState().selectedShipId,
    );

    if (!position) return;
    deps.renderer.centerOnHex(position);
  },
});

export type CameraController = ReturnType<typeof createCameraController>;
