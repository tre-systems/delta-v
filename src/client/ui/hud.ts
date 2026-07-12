import { isUnlimited } from '../../shared/constants';
import { formatCapacity } from './formatters';

export interface UIButtonView {
  visible: boolean;
  disabled: boolean;
  opacity: string;
  title: string;
}

export interface UILabelButtonView extends UIButtonView {
  label: string;
  className: string;
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
  confirmLabel: string;
  skipShipLabel: string;
  launchMine: UIButtonView;
  launchTorpedo: UIButtonView;
  launchNuke: UIButtonView;
  landFromOrbit: UIButtonView;
  selectFleet: { visible: boolean; active: boolean };
  emplaceBase: UIButtonView;
  nextOrdnance: UILabelButtonView;
  confirmOrdnance: UILabelButtonView;
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

const createHiddenLabelButton = (): UILabelButtonView => {
  return {
    ...createHiddenButton(),
    label: '',
    className: 'btn',
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
  // Fleet-steer state; optional so existing test fixtures need not set it.
  fleetGroupSize?: number;
  orderableTotal?: number;
  orderableOrdered?: number;
  anyCrashed?: boolean;
  crashBody?: string | null;
}

const getAstrogationStatusText = (
  ctx: AstrogationContext,
  isMobile: boolean,
): string => {
  const fleetGroupSize = ctx.fleetGroupSize ?? 0;
  const orderableTotal = ctx.orderableTotal ?? 0;
  const orderableOrdered = ctx.orderableOrdered ?? 0;

  // Fleet-steer mode: a group is selected, so a hex click points them all.
  if (fleetGroupSize >= 2) {
    return isMobile
      ? `Fleet: ${fleetGroupSize} ships \u00b7 tap a destination`
      : `Fleet: ${fleetGroupSize} ships \u00b7 click a destination hex to steer them together`;
  }

  const progress =
    ctx.multipleShipsAlive && orderableTotal > 0
      ? ` \u00b7 ${orderableOrdered}/${orderableTotal} ordered`
      : '';

  if (!ctx.hasSelection && ctx.multipleShipsAlive) {
    // Nudge new players toward the fleet workflow on larger fleets.
    if (orderableTotal >= 4 && orderableOrdered === 0) {
      return isMobile
        ? 'Tip: SELECT FLEET, then tap a destination'
        : 'Tip: SELECT FLEET, then click a destination hex';
    }
    return `Select a ship to begin${progress}`;
  }

  if (ctx.selectedShipDisabled) {
    return isMobile
      ? 'Ship disabled \u2014 it must drift \u00b7 Confirm'
      : 'Ship disabled \u2014 it must drift \u00b7 Confirm (Enter)';
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
    return `Burn set \u00b7 Select another ship${progress}`;
  }

  if (ctx.selectedShipHasBurn) {
    return isMobile
      ? 'Burn set \u00b7 Confirm'
      : 'Burn set \u00b7 Confirm (Enter)';
  }

  if (ctx.multipleShipsAlive) {
    return isMobile
      ? `Set burn or skip (S)${progress}`
      : `Set burn or skip ship (S)${progress}`;
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

const collectOrdnanceSummary = (
  input: HUDInput,
): {
  ready: string[];
  blocked: string[];
} => {
  const ready: string[] = [];
  const blocked: string[] = [];
  const pushSummary = (
    label: string,
    state: HUDActionState,
    blockedPrefix = `${label}: `,
  ) => {
    if (!state.visible) return;
    if (!state.disabled) {
      ready.push(label);
      return;
    }

    if (state.title) {
      blocked.push(`${blockedPrefix}${lowerFirst(state.title)}`);
    }
  };

  pushSummary('Mine', input.launchMineState);
  pushSummary('Torpedo', input.launchTorpedoState);
  pushSummary('Nuke', input.launchNukeState);
  pushSummary('Base', input.emplaceBaseState);

  return { ready, blocked };
};

const getOrdnanceStatusText = (input: HUDInput, isMobile: boolean): string => {
  const {
    launchTorpedoState,
    torpedoAimingActive,
    torpedoAccelSteps,
    allOrdnanceShipsAcknowledged,
    queuedLaunchCount,
  } = input;

  if (allOrdnanceShipsAcknowledged) {
    const queued =
      queuedLaunchCount > 0 ? `${queuedLaunchCount} queued` : 'None queued';
    return isMobile
      ? `${queued} \u00b7 Ready to confirm phase`
      : `${queued} \u00b7 Ready to confirm phase (Enter)`;
  }

  const hasSelection = input.astrogationCtx.hasSelection;

  if (!hasSelection) {
    return 'Select a ship to review ordnance options';
  }

  if (torpedoAimingActive) {
    if (torpedoAccelSteps === 2) {
      return isMobile
        ? 'Torpedo \u00d72 selected \u00b7 Tap TORPEDO to queue, or tap the same hex to clear'
        : 'Torpedo \u00d72 selected \u00b7 Tap TORPEDO or press Enter to queue, or click the same hex to clear';
    }

    if (torpedoAccelSteps === 1) {
      return isMobile
        ? 'Torpedo \u00d71 selected \u00b7 Tap the same hex for \u00d72, or tap TORPEDO to queue'
        : 'Torpedo \u00d71 selected \u00b7 Click the same hex for \u00d72, or tap TORPEDO / press Enter to queue';
    }

    return isMobile
      ? 'Torpedo aiming \u00b7 Tap adjacent hex for boost, or tap TORPEDO again for straight'
      : 'Torpedo aiming \u00b7 Click adjacent hex for boost, or tap TORPEDO / press Enter for straight';
  }

  const summary = collectOrdnanceSummary(input);
  const segments: string[] = [];

  if (queuedLaunchCount > 0) {
    segments.push(`${queuedLaunchCount} queued`);
  }

  if (summary.ready.length > 0) {
    segments.push(`Ready: ${summary.ready.join(', ')}`);
  }

  if (summary.blocked.length > 0) {
    segments.push(`Blocked: ${summary.blocked.join('; ')}`);
  }

  if (summary.ready.length === 0 && summary.blocked.length === 0) {
    return isMobile
      ? 'No ordnance actions available'
      : 'No ordnance actions available \u00b7 press Skip (S)';
  }

  if (summary.ready.length === 0) {
    segments.push(isMobile ? 'Press SKIP' : 'Press Skip (S)');
  } else if (launchTorpedoState.visible && !launchTorpedoState.disabled) {
    segments.push(
      isMobile
        ? 'Boost first: tap an adjacent hex; TORPEDO now launches straight'
        : 'Boost first: click an adjacent hex; TORPEDO now launches straight',
    );
  }

  return segments.join(' \u00b7 ');
};

export interface HUDInput {
  turn: number;
  phase: string;
  isMyTurn: boolean;
  /** Replay/watch-only viewer — hides player-framed HUD fields. */
  isSpectator: boolean;
  /** Player whose turn it currently is; used for spectator turn labels. */
  activePlayer: 0 | 1;
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
  queuedCombatAttackCount: number;
  astrogationCtx: AstrogationContext;
  speed: number;
  fuelToStop: number;
  /** Selected ship's derived course, e.g. "Burn · −1 fuel · next speed 2". */
  courseSummary: string | null;
  statusOverrideText?: string | null;
  /** Combat-only: label for keyboard-selected target (see `deriveHudViewModel`). */
  combatHudHint?: string | null;
  /** True when even a natural 6 cannot damage the selected target. */
  combatAttackImpossible?: boolean;
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
    isSpectator,
    activePlayer,
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
    queuedCombatAttackCount,
    astrogationCtx,
    speed,
    fuelToStop,
    courseSummary,
    isMobile,
    combatHudHint,
    combatAttackImpossible,
  } = input;

  const showOrdnance = isMyTurn && phase === 'ordnance';

  const compassHiddenPhases = new Set(['waiting', 'fleetBuilding', 'gameOver']);

  const objectiveCompassDegrees =
    !compassHiddenPhases.has(phase) && objectiveBearingDeg !== null
      ? objectiveBearingDeg
      : null;

  const phaseText = isSpectator
    ? `P${activePlayer + 1} ${phase.toUpperCase()}`
    : isMyTurn
      ? phase.toUpperCase()
      : "OPPONENT'S TURN";

  return {
    turnText: `Turn ${turn}`,
    phaseText,
    objectiveText: objective,
    objectiveCompassDegrees,
    fuelGaugeText: isSpectator
      ? ''
      : showOrdnance && cargoMax > 0
        ? isUnlimited(cargoMax)
          ? 'Cargo: \u221e'
          : `Cargo: ${cargoFree}/${cargoMax}${getOrdnanceCapacityHint(cargoFree)}`
        : !astrogationCtx.hasSelection
          ? isMyTurn
            ? 'Select a ship'
            : 'No ship selected'
          : isMyTurn && phase === 'astrogation' && courseSummary
            ? `Fuel: ${formatCapacity(fuel)}/${formatCapacity(maxFuel)} \u00b7 ${courseSummary}`
            : speed > 0
              ? `Fuel: ${formatCapacity(fuel)}/${formatCapacity(maxFuel)} \u00b7 Speed ${speed} (${fuelToStop} to stop)`
              : astrogationCtx.selectedShipLanded
                ? `Fuel: ${formatCapacity(fuel)}/${formatCapacity(maxFuel)} \u00b7 Landed`
                : `Fuel: ${formatCapacity(fuel)}/${formatCapacity(maxFuel)}`,
    statusText: !isMyTurn
      ? null
      : phase === 'astrogation'
        ? getAstrogationStatusText(astrogationCtx, isMobile)
        : phase === 'ordnance'
          ? getOrdnanceStatusText(input, isMobile)
          : phase === 'combat'
            ? (() => {
                const q = queuedCombatAttackCount;
                const queueSuffix =
                  q > 0
                    ? isMobile
                      ? ` \u00b7 ${q} queued`
                      : ` \u00b7 ${q} attack${q === 1 ? '' : 's'} queued`
                    : '';
                const hintPrefix = combatHudHint ? `${combatHudHint} · ` : '';
                if (combatAttackImpossible) {
                  return `${hintPrefix}Choose another target · FINISH COMBAT`;
                }
                return isMobile
                  ? astrogationCtx.hasSelection
                    ? `${hintPrefix}Choose target \u00b7 ATTACK fires \u00b7 FINISH COMBAT${queueSuffix}`
                    : `${hintPrefix}Select ship or target enemy${queueSuffix}`
                  : astrogationCtx.hasSelection
                    ? `${hintPrefix}Choose target \u00b7 ATTACK/Enter fires \u00b7 FINISH COMBAT${queueSuffix}`
                    : `${hintPrefix}Select ship or target enemy${queueSuffix}`;
              })()
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
    confirmLabel: astrogationCtx.multipleShipsAlive
      ? isMobile
        ? 'CONFIRM'
        : 'CONFIRM COURSES'
      : astrogationCtx.selectedShipLanded &&
          !astrogationCtx.selectedShipHasBurn &&
          !astrogationCtx.selectedShipLandingSet
        ? 'STAY LANDED'
        : astrogationCtx.selectedShipHasBurn ||
            astrogationCtx.selectedShipLandingSet
          ? 'CONFIRM COURSE'
          : isMobile
            ? 'DRIFT (NO BURN)'
            : 'DRIFT WITHOUT BURNING',
    skipShipLabel: isMobile ? 'DRIFT SHIP' : 'DRIFT THIS SHIP',
    landFromOrbit:
      isMyTurn &&
      phase === 'astrogation' &&
      astrogationCtx.selectedShipInOrbit &&
      !astrogationCtx.selectedShipLanded
        ? {
            visible: true,
            disabled: false,
            opacity: astrogationCtx.selectedShipLandingSet ? '1' : '0.7',
            title: astrogationCtx.selectedShipLandingSet
              ? 'Landing queued \u2014 click to cancel'
              : 'Land from orbit (1 fuel)',
          }
        : createHiddenButton(),

    selectFleet: {
      visible:
        isMyTurn &&
        phase === 'astrogation' &&
        astrogationCtx.multipleShipsAlive,
      active: (astrogationCtx.fleetGroupSize ?? 0) >= 2,
    },

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
    nextOrdnance: showOrdnance
      ? {
          visible: !input.allOrdnanceShipsAcknowledged,
          disabled: !input.astrogationCtx.hasSelection,
          opacity: input.astrogationCtx.hasSelection ? '1' : '0.4',
          title: input.astrogationCtx.hasSelection
            ? 'This ship skips ordnance this turn'
            : 'Select a ship first',
          label: 'SKIP',
          className: 'btn btn-secondary',
        }
      : createHiddenLabelButton(),
    // CONFIRM PHASE used to sit next to SKIP, but every launch and every
    // skip already auto-advances + auto-confirms when the last ship is
    // done (see `queueOrdnanceLaunch` / `skipOrdnanceShip` in
    // ordnance-actions.ts). The extra button was always either disabled
    // or redundant with whatever click just happened.
    confirmOrdnance: createHiddenLabelButton(),
    queuedOrdnanceType: showOrdnance
      ? (input.queuedOrdnanceType ?? null)
      : null,
    skipCombatVisible: false,
    skipLogisticsVisible: isMyTurn && phase === 'logistics',
    confirmTransfersVisible: isMyTurn && phase === 'logistics',
    showTransferPanel: isMyTurn && phase === 'logistics',
  };
};
