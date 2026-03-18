import { ORDNANCE_MASS } from '../../shared/constants';

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

export interface AstrogationContext {
  selectedShipLanded: boolean;
  selectedShipDisabled: boolean;
  selectedShipHasBurn: boolean;
  allShipsHaveBurns: boolean;
  multipleShipsAlive: boolean;
  hasSelection: boolean;
}

const getAstrogationStatusText = (ctx: AstrogationContext): string => {
  if (!ctx.hasSelection && ctx.multipleShipsAlive) return 'Select a ship to begin';
  if (ctx.selectedShipDisabled) return 'Ship disabled — will drift this turn';
  if (ctx.selectedShipLanded && !ctx.selectedShipHasBurn) return 'Click a direction to take off (costs 1 fuel)';
  if (ctx.allShipsHaveBurns) return 'All burns set · Confirm (Enter)';
  if (ctx.selectedShipHasBurn && ctx.multipleShipsAlive) return 'Burn set · Select another ship or Confirm (Enter)';
  if (ctx.selectedShipHasBurn) return 'Burn set · Confirm (Enter)';
  return 'Click adjacent hex to set burn direction';
};

export interface HUDInput {
  turn: number;
  phase: string;
  isMyTurn: boolean;
  fuel: number;
  maxFuel: number;
  hasBurns: boolean;
  cargoFree: number;
  cargoMax: number;
  objective: string;
  isWarship: boolean;
  canEmplaceBase: boolean;
  astrogationCtx: AstrogationContext;
}

export const buildHUDView = (input: HUDInput): HUDView => {
  const {
    turn,
    phase,
    isMyTurn,
    fuel,
    maxFuel,
    hasBurns,
    cargoFree,
    cargoMax,
    objective,
    isWarship,
    canEmplaceBase,
    astrogationCtx,
  } = input;
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
        ? getAstrogationStatusText(astrogationCtx)
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
