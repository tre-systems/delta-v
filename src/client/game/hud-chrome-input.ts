import type { HUDInput } from '../ui/hud';
import type { HudViewModel } from './types';

/** Sole mapping from pure `HudViewModel` + crash probe into the HUD chrome payload (see `HudController.updateHUD`). */
export const buildHudChromeInputFromViewModel = (
  hud: HudViewModel,
  crashWarning: { anyCrashed: boolean; crashBody: string | null },
): Omit<HUDInput, 'isMobile'> => ({
  turn: hud.turn,
  phase: hud.phase,
  isMyTurn: hud.isMyTurn,
  fuel: hud.fuel,
  maxFuel: hud.maxFuel,
  hasBurns: hud.hasBurns,
  cargoFree: hud.cargoFree,
  cargoMax: hud.cargoMax,
  objective: hud.objective,
  matchVelocityState: hud.matchVelocityState,
  canEmplaceBase: hud.canEmplaceBase,
  launchMineState: hud.launchMineState,
  launchTorpedoState: hud.launchTorpedoState,
  launchNukeState: hud.launchNukeState,
  speed: hud.speed,
  fuelToStop: hud.fuelToStop,
  astrogationCtx: {
    selectedShipLanded: hud.selectedShipLanded,
    selectedShipDisabled: hud.selectedShipDisabled,
    selectedShipHasBurn: hud.selectedShipHasBurn,
    allShipsHaveBurns: hud.allShipsHaveBurns,
    multipleShipsAlive: hud.multipleShipsAlive,
    hasSelection: hud.selectedId !== null,
    anyCrashed: crashWarning.anyCrashed,
    crashBody: crashWarning.crashBody,
  },
});
