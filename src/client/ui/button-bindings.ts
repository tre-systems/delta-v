import type { UIEvent } from './events';

export interface UIButtonEventBinding {
  id: string;
  event: UIEvent;
}

export const ACTION_BUTTON_BINDINGS = [
  { id: 'undoBtn', event: { type: 'undo' } },
  { id: 'confirmBtn', event: { type: 'confirm' } },
  { id: 'landFromOrbitBtn', event: { type: 'landFromOrbit' } },
  { id: 'matchVelocityBtn', event: { type: 'matchVelocity' } },
  {
    id: 'launchMineBtn',
    event: { type: 'launchOrdnance', ordType: 'mine' },
  },
  {
    id: 'launchTorpedoBtn',
    event: { type: 'launchOrdnance', ordType: 'torpedo' },
  },
  {
    id: 'launchNukeBtn',
    event: { type: 'launchOrdnance', ordType: 'nuke' },
  },
  { id: 'emplaceBaseBtn', event: { type: 'emplaceBase' } },
  { id: 'skipOrdnanceBtn', event: { type: 'skipOrdnance' } },
  { id: 'attackBtn', event: { type: 'attack' } },
  { id: 'fireBtn', event: { type: 'fireAll' } },
  { id: 'skipCombatBtn', event: { type: 'skipCombat' } },
  { id: 'skipLogisticsBtn', event: { type: 'skipLogistics' } },
  { id: 'confirmTransfersBtn', event: { type: 'confirmTransfers' } },
] as const satisfies readonly UIButtonEventBinding[];

export const STATIC_BUTTON_BINDINGS = [
  ...ACTION_BUTTON_BINDINGS,
  { id: 'rematchBtn', event: { type: 'rematch' } },
  { id: 'replayMatchPrevBtn', event: { type: 'replayMatchPrev' } },
  { id: 'replayMatchNextBtn', event: { type: 'replayMatchNext' } },
  { id: 'replayToggleBtn', event: { type: 'toggleReplay' } },
  { id: 'replayStartBtn', event: { type: 'replayStart' } },
  { id: 'replayPrevBtn', event: { type: 'replayPrev' } },
  { id: 'replayNextBtn', event: { type: 'replayNext' } },
  { id: 'replayEndBtn', event: { type: 'replayEnd' } },
  { id: 'replayBarStartBtn', event: { type: 'replayStart' } },
  { id: 'replayBarPrevBtn', event: { type: 'replayPrev' } },
  { id: 'replayBarNextBtn', event: { type: 'replayNext' } },
  { id: 'replayBarEndBtn', event: { type: 'replayEnd' } },
  { id: 'replayBarExitBtn', event: { type: 'toggleReplay' } },
  { id: 'exitBtn', event: { type: 'exit' } },
] as const satisfies readonly UIButtonEventBinding[];

export const ACTION_BUTTON_IDS = ACTION_BUTTON_BINDINGS.map(({ id }) => id);
