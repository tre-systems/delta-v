import { ORDNANCE_MASS } from '../shared/constants';

export interface UIButtonView {
  visible: boolean;
  disabled: boolean;
  opacity: string;
  title: string;
}

export interface HUDView {
  turnText: string;
  phaseText: string;
  objectiveText: string;
  fuelGaugeText: string;
  statusText: string | null;
  undoVisible: boolean;
  confirmVisible: boolean;
  launchMine: UIButtonView;
  launchTorpedo: UIButtonView;
  launchNuke: UIButtonView;
  emplaceBaseVisible: boolean;
  skipOrdnanceVisible: boolean;
  skipCombatVisible: boolean;
}

const createHiddenButton = (): UIButtonView => {
  return {
    visible: false,
    disabled: false,
    opacity: '1',
    title: '',
  };
};

export const buildHUDView = (
  turn: number,
  phase: string,
  isMyTurn: boolean,
  fuel: number,
  maxFuel: number,
  hasBurns = false,
  cargoFree = 0,
  cargoMax = 0,
  objective = '',
  isWarship = false,
  canEmplaceBase = false,
): HUDView => {
  const showOrdnance = isMyTurn && phase === 'ordnance';
  const canMine = cargoFree >= ORDNANCE_MASS.mine;
  const canTorpedo = isWarship && cargoFree >= ORDNANCE_MASS.torpedo;
  const canNuke = cargoFree >= ORDNANCE_MASS.nuke;

  return {
    turnText: `Turn ${turn}`,
    phaseText: isMyTurn ? phase.toUpperCase() : "OPPONENT'S TURN",
    objectiveText: objective,
    fuelGaugeText: showOrdnance && cargoMax > 0 ? `Cargo: ${cargoFree}/${cargoMax}` : `Fuel: ${fuel}/${maxFuel}`,
    statusText: !isMyTurn
      ? 'Waiting for opponent...'
      : phase === 'astrogation'
        ? 'Select ship · Choose burn direction (1-6) · Confirm (Enter)'
        : phase === 'ordnance'
          ? 'Launch ordnance or skip (Enter)'
          : phase === 'combat'
            ? 'Click enemies to target · Fire All to attack (Enter)'
            : null,
    undoVisible: isMyTurn && phase === 'astrogation' && hasBurns,
    confirmVisible: isMyTurn && phase === 'astrogation',
    launchMine: showOrdnance
      ? {
          visible: true,
          disabled: !canMine,
          opacity: canMine ? '1' : '0.4',
          title: '',
        }
      : createHiddenButton(),
    launchTorpedo: showOrdnance
      ? {
          visible: true,
          disabled: !canTorpedo,
          opacity: canTorpedo ? '1' : '0.4',
          title: isWarship ? '' : 'Warships only',
        }
      : createHiddenButton(),
    launchNuke: showOrdnance
      ? {
          visible: true,
          disabled: !canNuke,
          opacity: canNuke ? '1' : '0.4',
          title: '',
        }
      : createHiddenButton(),
    emplaceBaseVisible: showOrdnance && canEmplaceBase,
    skipOrdnanceVisible: showOrdnance,
    skipCombatVisible: isMyTurn && phase === 'combat',
  };
};
