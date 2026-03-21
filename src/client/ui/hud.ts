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
  skipLogisticsVisible: boolean;
  confirmTransfersVisible: boolean;
  showTransferPanel: boolean;
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
  anyCrashed?: boolean;
  crashBody?: string | null;
}

const getAstrogationStatusText = (
  ctx: AstrogationContext,
  isMobile: boolean,
): string => {
  if (!ctx.hasSelection && ctx.multipleShipsAlive) {
    return 'Select a ship to begin';
  }

  if (ctx.selectedShipDisabled) {
    return 'Ship disabled \u2014 will drift this turn';
  }

  if (ctx.selectedShipLanded && !ctx.selectedShipHasBurn) {
    return isMobile
      ? 'Tap a direction to take off (costs 1 fuel)'
      : 'Click a direction to take off (costs 1 fuel)';
  }

  if (ctx.anyCrashed) {
    const body = ctx.crashBody ?? 'a body';
    return `Warning: course crashes into ${body}!`;
  }

  if (ctx.allShipsHaveBurns && ctx.multipleShipsAlive) {
    return isMobile
      ? 'All burns set \u00b7 Confirm'
      : 'All burns set \u00b7 Confirm (Enter)';
  }

  if (ctx.selectedShipHasBurn && ctx.multipleShipsAlive) {
    return isMobile
      ? 'Burn set \u00b7 Select another ship or Confirm'
      : 'Burn set \u00b7 Select another ship or Confirm (Enter)';
  }

  if (ctx.selectedShipHasBurn) {
    return isMobile
      ? 'Burn set \u00b7 Confirm'
      : 'Burn set \u00b7 Confirm (Enter)';
  }

  return isMobile
    ? 'Tap adjacent hex to set burn direction'
    : 'Click adjacent hex to set burn direction';
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
  canEmplaceBase: boolean;
  launchMineState: HUDActionState;
  launchTorpedoState: HUDActionState;
  launchNukeState: HUDActionState;
  astrogationCtx: AstrogationContext;
  speed: number;
  fuelToStop: number;
  isMobile: boolean;
}

export interface HUDActionState {
  visible: boolean;
  disabled: boolean;
  title: string;
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
    canEmplaceBase,
    launchMineState,
    launchTorpedoState,
    launchNukeState,
    astrogationCtx,
    speed,
    fuelToStop,
    isMobile,
  } = input;

  const showOrdnance = isMyTurn && phase === 'ordnance';

  return {
    turnText: `Turn ${turn}`,
    phaseText: isMyTurn ? phase.toUpperCase() : "OPPONENT'S TURN",
    objectiveText: objective,
    fuelGaugeText:
      showOrdnance && cargoMax > 0
        ? `Cargo: ${cargoFree}/${cargoMax}`
        : speed > 0
          ? `Fuel: ${fuel}/${maxFuel} \u00b7 Speed ${speed} (${fuelToStop} to stop)`
          : astrogationCtx.selectedShipLanded
            ? `Fuel: ${fuel}/${maxFuel} \u00b7 Landed`
            : `Fuel: ${fuel}/${maxFuel}`,
    statusText: !isMyTurn
      ? null
      : phase === 'astrogation'
        ? getAstrogationStatusText(astrogationCtx, isMobile)
        : phase === 'ordnance'
          ? isMobile
            ? 'Launch ordnance or skip'
            : 'Launch ordnance or skip (Enter)'
          : phase === 'combat'
            ? isMobile
              ? 'Tap enemies to target \u00b7 Fire All to attack'
              : 'Click enemies to target \u00b7 Fire All to attack (Enter)'
            : phase === 'logistics'
              ? isMobile
                ? 'Transfer fuel/cargo or skip'
                : 'Transfer fuel/cargo or skip (Enter)'
              : null,
    undoVisible: isMyTurn && phase === 'astrogation' && hasBurns,
    confirmVisible: isMyTurn && phase === 'astrogation',

    launchMine: showOrdnance
      ? {
          visible: launchMineState.visible,
          disabled: launchMineState.disabled,
          opacity: launchMineState.disabled ? '0.4' : '1',
          title: launchMineState.title,
        }
      : createHiddenButton(),

    launchTorpedo: showOrdnance
      ? {
          visible: launchTorpedoState.visible,
          disabled: launchTorpedoState.disabled,
          opacity: launchTorpedoState.disabled ? '0.4' : '1',
          title: launchTorpedoState.title,
        }
      : createHiddenButton(),

    launchNuke: showOrdnance
      ? {
          visible: launchNukeState.visible,
          disabled: launchNukeState.disabled,
          opacity: launchNukeState.disabled ? '0.4' : '1',
          title: launchNukeState.title,
        }
      : createHiddenButton(),

    emplaceBaseVisible: showOrdnance && canEmplaceBase,
    skipOrdnanceVisible: showOrdnance,
    skipCombatVisible: isMyTurn && phase === 'combat',
    skipLogisticsVisible: isMyTurn && phase === 'logistics',
    confirmTransfersVisible: isMyTurn && phase === 'logistics',
    showTransferPanel: isMyTurn && phase === 'logistics',
  };
};
