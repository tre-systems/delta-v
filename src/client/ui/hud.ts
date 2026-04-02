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
  /** Degrees for rotating a right-pointing objective arrow; null hides the compass. */
  objectiveCompassDegrees: number | null;
  fuelGaugeText: string;
  statusText: string | null;
  undoVisible: boolean;
  confirmVisible: boolean;
  matchVelocity: UIButtonView;
  launchMine: UIButtonView;
  launchTorpedo: UIButtonView;
  launchNuke: UIButtonView;
  landFromOrbit: UIButtonView;
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
  selectedShipInOrbit?: boolean;
  selectedShipLandingSet?: boolean;
  allShipsAcknowledged: boolean;
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
      ? 'Tap a direction to burn (1 fuel)'
      : 'Click a direction to burn (1 fuel)';
  }

  if (ctx.anyCrashed) {
    const body = ctx.crashBody ?? 'a body';
    return `Warning: course crashes into ${body}!`;
  }

  if (ctx.allShipsAcknowledged && ctx.multipleShipsAlive) {
    return isMobile
      ? 'All ships set \u00b7 Confirm'
      : 'All ships set \u00b7 Confirm (Enter)';
  }

  if (ctx.selectedShipHasBurn && ctx.multipleShipsAlive) {
    return isMobile
      ? 'Burn set \u00b7 Select another ship'
      : 'Burn set \u00b7 Select another ship';
  }

  if (ctx.selectedShipHasBurn) {
    return isMobile
      ? 'Burn set \u00b7 Confirm'
      : 'Burn set \u00b7 Confirm (Enter)';
  }

  return isMobile ? 'Set burn or skip (S)' : 'Set burn or skip ship (S)';
};

const getOrdnanceStatusText = (input: HUDInput, isMobile: boolean): string => {
  const {
    launchMineState,
    launchTorpedoState,
    launchNukeState,
    cargoMax,
    allOrdnanceShipsAcknowledged,
  } = input;

  if (allOrdnanceShipsAcknowledged) {
    return isMobile
      ? 'All ships set \u00b7 Confirm'
      : 'All ships set \u00b7 Confirm (Enter)';
  }

  const hasSelection = cargoMax > 0;

  if (!hasSelection) {
    return isMobile
      ? 'Select a ship to launch ordnance'
      : 'Select a ship to launch ordnance';
  }

  const available: string[] = [];

  if (launchMineState.visible && !launchMineState.disabled)
    available.push(isMobile ? 'Mine' : 'Mine (N)');
  if (launchTorpedoState.visible && !launchTorpedoState.disabled)
    available.push(isMobile ? 'Torpedo' : 'Torpedo (T)');
  if (launchNukeState.visible && !launchNukeState.disabled)
    available.push(isMobile ? 'Nuke' : 'Nuke (K)');

  if (available.length === 0) {
    const reason =
      launchMineState.title ||
      launchTorpedoState.title ||
      launchNukeState.title;
    const hint = reason ? ` \u2014 ${reason.toLowerCase()}` : '';

    return isMobile
      ? `Cannot launch${hint} \u00b7 skip (S)`
      : `Cannot launch${hint} \u00b7 skip ship (S)`;
  }

  return isMobile
    ? `Launch ${available.join(', ')} or skip (S)`
    : `Launch ${available.join(', ')} \u00b7 skip ship (S)`;
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
  /** Screen bearing for HUD compass; computed in `HudController`. */
  objectiveBearingDeg: number | null;
  matchVelocityState: HUDActionState;
  canEmplaceBase: boolean;
  launchMineState: HUDActionState;
  launchTorpedoState: HUDActionState;
  launchNukeState: HUDActionState;
  allOrdnanceShipsAcknowledged: boolean;
  astrogationCtx: AstrogationContext;
  speed: number;
  fuelToStop: number;
  statusOverrideText?: string | null;
  suppressActionButtons?: boolean;
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
    objectiveBearingDeg,
    matchVelocityState,
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

  const compassHiddenPhases = new Set(['waiting', 'fleetBuilding', 'gameOver']);

  const objectiveCompassDegrees =
    !compassHiddenPhases.has(phase) && objectiveBearingDeg !== null
      ? objectiveBearingDeg
      : null;

  return {
    turnText: `Turn ${turn}`,
    phaseText: isMyTurn ? phase.toUpperCase() : "OPPONENT'S TURN",
    objectiveText: objective,
    objectiveCompassDegrees,
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
          ? getOrdnanceStatusText(input, isMobile)
          : phase === 'combat'
            ? isMobile
              ? 'Tap enemies to target \u00b7 Fire All to attack'
              : 'Click enemies to target \u00b7 Fire All (Enter)'
            : phase === 'logistics'
              ? isMobile
                ? 'Transfer fuel/cargo or skip'
                : 'Transfer fuel/cargo or skip (Enter)'
              : null,
    undoVisible: isMyTurn && phase === 'astrogation' && hasBurns,
    confirmVisible:
      isMyTurn &&
      phase === 'astrogation' &&
      astrogationCtx.allShipsAcknowledged,
    landFromOrbit:
      isMyTurn && phase === 'astrogation' && astrogationCtx.selectedShipInOrbit
        ? {
            visible: true,
            disabled: false,
            opacity: astrogationCtx.selectedShipLandingSet ? '1' : '0.7',
            title: astrogationCtx.selectedShipLandingSet
              ? 'Landing queued \u2014 click to cancel'
              : 'Land from orbit (1 fuel)',
          }
        : createHiddenButton(),

    matchVelocity:
      isMyTurn && phase === 'astrogation'
        ? {
            visible: matchVelocityState.visible,
            disabled: matchVelocityState.disabled,
            opacity: matchVelocityState.disabled ? '0.4' : '1',
            title: matchVelocityState.title,
          }
        : createHiddenButton(),

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
    skipOrdnanceVisible: showOrdnance && input.allOrdnanceShipsAcknowledged,
    skipCombatVisible: false,
    skipLogisticsVisible: isMyTurn && phase === 'logistics',
    confirmTransfersVisible: isMyTurn && phase === 'logistics',
    showTransferPanel: isMyTurn && phase === 'logistics',
  };
};
