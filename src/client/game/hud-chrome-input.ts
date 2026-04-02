import type { HUDInput } from '../ui/hud';
import type { ClientState } from './phase';
import type { HudViewModel } from './types';

/** Sole mapping from pure `HudViewModel` + crash probe into the HUD chrome payload (see `HudController.updateHUD`). */
export const buildHudChromeInputFromViewModel = (
  hud: HudViewModel,
  crashWarning: { anyCrashed: boolean; crashBody: string | null },
  objectiveBearingDeg: number | null,
  clientState: ClientState,
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
  objectiveBearingDeg,
  canEmplaceBase: hud.canEmplaceBase,
  launchMineState: hud.launchMineState,
  launchTorpedoState: hud.launchTorpedoState,
  launchNukeState: hud.launchNukeState,
  allOrdnanceShipsAcknowledged: hud.allOrdnanceShipsAcknowledged,
  queuedOrdnanceType: hud.queuedOrdnanceType,
  queuedLaunchCount: hud.queuedLaunchCount,
  speed: hud.speed,
  fuelToStop: hud.fuelToStop,
  statusOverrideText:
    clientState === 'playing_movementAnim' ? 'Ships moving...' : null,
  suppressActionButtons:
    clientState === 'playing_movementAnim' || clientState === 'gameOver',
  astrogationCtx: {
    selectedShipLanded: hud.selectedShipLanded,
    selectedShipDisabled: hud.selectedShipDisabled,
    selectedShipHasBurn: hud.selectedShipHasBurn,
    selectedShipInOrbit: hud.selectedShipInOrbit,
    selectedShipLandingSet: hud.selectedShipLandingSet,
    allShipsAcknowledged: hud.allShipsAcknowledged,
    multipleShipsAlive: hud.multipleShipsAlive,
    hasSelection: hud.selectedId !== null,
    anyCrashed: crashWarning.anyCrashed,
    crashBody: crashWarning.crashBody,
  },
});
