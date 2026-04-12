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
  skipShipVisible: boolean;
  confirmVisible: boolean;
  launchMine: UIButtonView;
  launchTorpedo: UIButtonView;
  launchNuke: UIButtonView;
  landFromOrbit: UIButtonView;
  emplaceBase: UIButtonView;
  skipOrdnanceVisible: boolean;
  skipOrdnanceLabel: string;
  skipOrdnanceIsConfirm: boolean;
  queuedOrdnanceType: string | null;
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

  if (ctx.multipleShipsAlive) {
    return isMobile ? 'Set burn or skip (S)' : 'Set burn or skip ship (S)';
  }

  return isMobile ? 'Set burn' : 'Set burn or confirm (Enter)';
};

const getOrdnanceCapacityHint = (cargoFree: number): string => {
  const fits: string[] = [];
  if (cargoFree >= 10) fits.push(`${Math.floor(cargoFree / 10)}M`);
  if (cargoFree >= 20) fits.push(`${Math.floor(cargoFree / 20)}T`);
  if (cargoFree >= 20) fits.push(`${Math.floor(cargoFree / 20)}N`);
  return fits.length > 0 ? ` (${fits.join(' ')})` : '';
};

const lowerFirst = (text: string): string =>
  text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text;

const joinActionList = (actions: string[]): string => {
  if (actions.length === 0) return '';
  if (actions.length === 1) return actions[0];
  if (actions.length === 2) return `${actions[0]} or ${actions[1]}`;
  return `${actions.slice(0, -1).join(', ')}, or ${actions.at(-1)}`;
};

const getPrimaryDisabledReason = (input: HUDInput): string | null => {
  const reasons = [
    input.launchMineState.visible && input.launchMineState.disabled
      ? input.launchMineState.title
      : '',
    input.launchTorpedoState.visible && input.launchTorpedoState.disabled
      ? input.launchTorpedoState.title
      : '',
    input.launchNukeState.visible && input.launchNukeState.disabled
      ? input.launchNukeState.title
      : '',
    input.emplaceBaseState.visible && input.emplaceBaseState.disabled
      ? input.emplaceBaseState.title
      : '',
  ].filter(Boolean);

  return reasons[0] ?? null;
};

const getOrdnanceStatusText = (input: HUDInput, isMobile: boolean): string => {
  const {
    emplaceBaseState,
    launchMineState,
    launchTorpedoState,
    launchNukeState,
    torpedoAimingActive,
    torpedoAccelSteps,
    allOrdnanceShipsAcknowledged,
    queuedLaunchCount,
  } = input;
  const multiShip = input.astrogationCtx.multipleShipsAlive;
  const skipLabel = multiShip
    ? isMobile
      ? 'Next Ship'
      : 'Next Ship (S)'
    : isMobile
      ? 'Skip'
      : 'Skip (S)';

  if (allOrdnanceShipsAcknowledged) {
    const queued =
      queuedLaunchCount > 0 ? `${queuedLaunchCount} queued` : 'None queued';
    return isMobile
      ? `${queued} \u00b7 Confirm Phase`
      : `${queued} \u00b7 Confirm Phase (Enter)`;
  }

  const hasSelection = input.astrogationCtx.hasSelection;

  if (!hasSelection) {
    return 'Select a ship to choose ordnance';
  }

  if (torpedoAimingActive) {
    if (torpedoAccelSteps === 2) {
      return isMobile
        ? 'Torpedo \u00d72 selected \u00b7 Tap TORPEDO to queue, or tap the same hex to clear'
        : 'Torpedo \u00d72 selected \u00b7 Press Enter to queue, or click the same hex to clear';
    }

    if (torpedoAccelSteps === 1) {
      return isMobile
        ? 'Torpedo \u00d71 selected \u00b7 Tap the same hex for \u00d72, or tap TORPEDO to queue'
        : 'Torpedo \u00d71 selected \u00b7 Click the same hex for \u00d72, or press Enter to queue';
    }

    return isMobile
      ? 'Torpedo aiming \u00b7 Tap adjacent hex for boost, or tap TORPEDO again for straight'
      : 'Torpedo aiming \u00b7 Click adjacent hex for boost, or press Enter for straight';
  }

  const available: string[] = [];

  if (launchMineState.visible && !launchMineState.disabled)
    available.push(isMobile ? 'Mine' : 'Mine (N)');
  if (launchTorpedoState.visible && !launchTorpedoState.disabled)
    available.push(isMobile ? 'Torpedo' : 'Torpedo (T)');
  if (launchNukeState.visible && !launchNukeState.disabled)
    available.push(isMobile ? 'Nuke' : 'Nuke (K)');
  if (emplaceBaseState.visible && !emplaceBaseState.disabled)
    available.push('Emplace Base');

  if (available.length === 0) {
    const reason = getPrimaryDisabledReason(input);
    const hint = reason ? ` \u2014 ${lowerFirst(reason)}` : '';

    return `No legal ordnance${hint} \u00b7 ${skipLabel}`;
  }

  const prompt = `Choose ${joinActionList([...available, skipLabel])}`;

  if (launchTorpedoState.visible && !launchTorpedoState.disabled) {
    return `${prompt} \u00b7 Torpedo boost uses an adjacent hex`;
  }

  return prompt;
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
  emplaceBaseState: HUDActionState;
  launchMineState: HUDActionState;
  launchTorpedoState: HUDActionState;
  launchNukeState: HUDActionState;
  torpedoAimingActive: boolean;
  torpedoAccelSteps: 1 | 2 | null;
  allOrdnanceShipsAcknowledged: boolean;
  queuedOrdnanceType: string | null;
  queuedLaunchCount: number;
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
    emplaceBaseState,
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
        ? `Cargo: ${cargoFree}/${cargoMax}${getOrdnanceCapacityHint(cargoFree)}`
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
    skipShipVisible:
      isMyTurn &&
      phase === 'astrogation' &&
      astrogationCtx.hasSelection &&
      !astrogationCtx.selectedShipDisabled &&
      !astrogationCtx.allShipsAcknowledged &&
      astrogationCtx.multipleShipsAlive,
    confirmVisible:
      isMyTurn &&
      phase === 'astrogation' &&
      (astrogationCtx.allShipsAcknowledged ||
        !astrogationCtx.multipleShipsAlive),
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

    emplaceBase: showOrdnance
      ? {
          visible: emplaceBaseState.visible,
          disabled: emplaceBaseState.disabled,
          opacity: emplaceBaseState.disabled ? '0.4' : '1',
          title: emplaceBaseState.title,
        }
      : createHiddenButton(),
    skipOrdnanceVisible: showOrdnance,
    skipOrdnanceLabel: input.allOrdnanceShipsAcknowledged
      ? 'CONFIRM PHASE'
      : input.astrogationCtx.multipleShipsAlive
        ? 'NEXT SHIP'
        : 'SKIP',
    skipOrdnanceIsConfirm: input.allOrdnanceShipsAcknowledged,
    queuedOrdnanceType: showOrdnance
      ? (input.queuedOrdnanceType ?? null)
      : null,
    skipCombatVisible: false,
    skipLogisticsVisible: isMyTurn && phase === 'logistics',
    confirmTransfersVisible: isMyTurn && phase === 'logistics',
    showTransferPanel: isMyTurn && phase === 'logistics',
  };
};
