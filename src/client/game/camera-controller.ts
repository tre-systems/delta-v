import type { GameState, PlayerId } from '../../shared/types/domain';
import type { Renderer } from '../renderer/renderer';
import { HEX_SIZE } from '../renderer/renderer';
import type { OverlayView } from '../ui/overlay-view';
import {
  getNearestEnemyPosition,
  getNextSelectedShip,
  getOwnFleetFocusPosition,
} from './navigation';
import type { PlanningState } from './planning';
import { setSelectedShipId } from './planning-store';

export interface CameraControllerDeps {
  getGameState: () => GameState | null;
  getPlayerId: () => PlayerId;
  getPlanningState: () => PlanningState;
  renderer: Renderer;
  overlay: OverlayView;
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
    setSelectedShipId(deps.getPlanningState(), nextShip.id);
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
      deps.overlay.showToast('No detected enemies', 'info');
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
