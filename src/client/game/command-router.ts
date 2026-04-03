import { SHIP_STATS } from '../../shared/constants';
import { hexKey } from '../../shared/hex';
import type {
  FleetPurchase,
  GameState,
  PlayerId,
} from '../../shared/types/domain';
import { isMuted, playSelect, setMuted } from '../audio';
import {
  type AstrogationActionDeps,
  clearSelectedBurn,
  confirmOrders,
  setBurnDirection,
  skipShipBurn,
  undoSelectedShipBurn,
} from './astrogation-actions';
import {
  adjustCombatStrength,
  type CombatActionDeps,
  clearCombatSelection,
  confirmSingleAttack,
  endCombatPhase,
  fireAllAttacks,
  queueAttack,
  resetCombatStrengthToMax,
  sendSkipCombat,
} from './combat-actions';
import type { GameCommand } from './commands';
import type { LogisticsStore } from './logistics-store';
import {
  confirmOrdnance,
  type OrdnanceActionDeps,
  queueOrdnanceLaunch,
  sendEmplaceBase,
  skipOrdnanceShip,
} from './ordnance-actions';
import type { ClientState } from './phase';
import type { PlanningStore } from './planning';
import type { GameTransport } from './transport';

// Canonical read-only session accessors for command dispatch.
// All reads go through getters backed by reactive session state to avoid
// stale snapshots and dual-path inconsistencies (backlog #26).
export interface CommandRouterSessionRead {
  getState: () => ClientState;
  getPlayerId: () => PlayerId;
  getGameState: () => GameState | null;
  getTransport: () => GameTransport | null;
  getLogisticsState: () => LogisticsStore | null;
  planningState: PlanningStore;
}

interface CommandRouterUI {
  overlay: {
    showToast: (message: string, type: 'error' | 'info' | 'success') => void;
  };
  log: { toggle: () => void };
}

interface CommandRouterRenderer {
  centerOnHex: (position: { q: number; r: number }) => void;
  camera: {
    pan: (dx: number, dy: number) => void;
    zoomAt: (x: number, y: number, factor: number) => void;
  };
}

export interface CommandRouterDeps {
  ctx: CommandRouterSessionRead;
  astrogationDeps: AstrogationActionDeps;
  combatDeps: CombatActionDeps;
  ordnanceDeps: OrdnanceActionDeps;
  ui: CommandRouterUI;
  renderer: CommandRouterRenderer;
  getCanvasCenter: () => { x: number; y: number };
  cycleShip: (direction: number) => void;
  focusNearestEnemy: () => void;
  focusOwnFleet: () => void;
  sendFleetReady: (purchases: FleetPurchase[]) => void;
  sendRematch: () => void;
  exitToMenu: () => void;
  toggleHelp: () => void;
  updateSoundButton: () => void;
}

const setCombatPlan = (
  planningState: PlanningStore,
  plan: Extract<GameCommand, { type: 'setCombatPlan' }>,
): void => {
  planningState.applyCombatPlanUpdate(plan.plan, plan.selectedShipId);
};

const undoQueuedAttack = (deps: CommandRouterDeps): void => {
  const count = deps.ctx.planningState.popQueuedAttack();

  deps.ui.overlay.showToast(
    count > 0 ? `Undid last attack (${count} queued)` : 'Attack queue cleared',
    'info',
  );
};

const getActiveLogisticsContext = (
  deps: CommandRouterDeps,
): {
  transport: GameTransport;
  logisticsState: LogisticsStore | null;
} | null => {
  if (deps.ctx.getState() !== 'playing_logistics') {
    return null;
  }

  const transport = deps.ctx.getTransport();

  if (!transport) {
    return null;
  }

  return {
    transport,
    logisticsState: deps.ctx.getLogisticsState(),
  };
};

const skipLogistics = (deps: CommandRouterDeps): void => {
  const logisticsContext = getActiveLogisticsContext(deps);

  if (logisticsContext) {
    logisticsContext.transport.skipLogistics();
  }
};

const confirmTransfers = (deps: CommandRouterDeps): void => {
  const logisticsContext = getActiveLogisticsContext(deps);

  if (!logisticsContext?.logisticsState) {
    return;
  }

  const orders = logisticsContext.logisticsState.buildTransferOrders();

  if (orders.length > 0) {
    logisticsContext.transport.submitLogistics(orders);
  } else {
    logisticsContext.transport.skipLogistics();
  }
};

const selectShip = (
  deps: CommandRouterDeps,
  shipId: Extract<GameCommand, { type: 'selectShip' }>['shipId'],
): void => {
  const gameState = deps.ctx.getGameState();
  const ship = gameState?.ships.find((candidate) => candidate.id === shipId);

  if (ship) {
    deps.ctx.planningState.selectShip(shipId, hexKey(ship.position));
    deps.renderer.centerOnHex(ship.position);

    const myAlive = gameState?.ships.filter(
      (candidate) =>
        candidate.owner === deps.ctx.getPlayerId() &&
        candidate.lifecycle !== 'destroyed',
    );

    if (myAlive && myAlive.length > 1) {
      const name = SHIP_STATS[ship.type]?.name ?? ship.type;
      deps.ui.overlay.showToast(`Selected: ${name}`, 'info');
    }
  } else {
    deps.ctx.planningState.setSelectedShipId(shipId);
  }
};

type CommandType = GameCommand['type'];
type CommandHandler<T extends CommandType = CommandType> = (
  deps: CommandRouterDeps,
  cmd: Extract<GameCommand, { type: T }>,
) => void;

type CommandHandlerMap = {
  [T in CommandType]: CommandHandler<T>;
};

type PartialCommandHandlerMap<T extends CommandType> = {
  [K in T]: CommandHandler<K>;
};

const astrogationHandlers = {
  confirmOrders: (deps) => confirmOrders(deps.astrogationDeps),
  undoBurn: (deps) => undoSelectedShipBurn(deps.astrogationDeps),
  landFromOrbit: (deps) => {
    const shipId = deps.ctx.planningState.selectedShipId;
    if (!shipId) return;
    const current = deps.ctx.planningState.landingShips.has(shipId);
    deps.ctx.planningState.setShipLanding(shipId, !current);
    if (!current) {
      // Auto-set a burn so confirm works immediately
      const burn = deps.ctx.planningState.burns.get(shipId);
      if (burn === undefined || burn === null) {
        deps.ctx.planningState.setShipBurn(shipId, 0);
      }
    }
  },
  setBurnDirection: (deps, cmd) =>
    setBurnDirection(deps.astrogationDeps, cmd.direction, cmd.shipId),
  setOverloadDirection: (deps, cmd) => {
    deps.ctx.planningState.setShipOverload(cmd.shipId, cmd.direction);
    playSelect();
  },
  setWeakGravityChoices: (deps, cmd) =>
    deps.ctx.planningState.setShipWeakGravityChoices(cmd.shipId, cmd.choices),
  clearSelectedBurn: (deps) => clearSelectedBurn(deps.astrogationDeps),
  skipShipBurn: (deps) => skipShipBurn(deps.astrogationDeps),
} satisfies PartialCommandHandlerMap<
  | 'confirmOrders'
  | 'undoBurn'
  | 'landFromOrbit'
  | 'setBurnDirection'
  | 'setOverloadDirection'
  | 'setWeakGravityChoices'
  | 'clearSelectedBurn'
  | 'skipShipBurn'
>;

const combatHandlers = {
  queueAttack: (deps) => queueAttack(deps.combatDeps),
  fireAllAttacks: (deps) => fireAllAttacks(deps.combatDeps),
  confirmSingleAttack: (deps) => confirmSingleAttack(deps.combatDeps),
  endCombat: (deps) => endCombatPhase(deps.combatDeps),
  skipCombat: (deps) => sendSkipCombat(deps.combatDeps),
  adjustCombatStrength: (deps, cmd) =>
    adjustCombatStrength(deps.combatDeps, cmd.delta),
  resetCombatStrength: (deps) => resetCombatStrengthToMax(deps.combatDeps),
  setCombatPlan: (deps, cmd) => setCombatPlan(deps.ctx.planningState, cmd),
  clearCombatSelection: (deps) => clearCombatSelection(deps.combatDeps),
  undoQueuedAttack,
} satisfies PartialCommandHandlerMap<
  | 'queueAttack'
  | 'fireAllAttacks'
  | 'confirmSingleAttack'
  | 'endCombat'
  | 'skipCombat'
  | 'adjustCombatStrength'
  | 'resetCombatStrength'
  | 'setCombatPlan'
  | 'clearCombatSelection'
  | 'undoQueuedAttack'
>;

const logisticsHandlers = {
  skipLogistics,
  confirmTransfers,
} satisfies PartialCommandHandlerMap<'skipLogistics' | 'confirmTransfers'>;

const ordnanceHandlers = {
  launchOrdnance: (deps, cmd) =>
    queueOrdnanceLaunch(deps.ordnanceDeps, cmd.ordType),
  emplaceBase: (deps) => sendEmplaceBase(deps.ordnanceDeps),
  skipOrdnance: (deps) => confirmOrdnance(deps.ordnanceDeps),
  confirmOrdnance: (deps) => confirmOrdnance(deps.ordnanceDeps),
  skipOrdnanceShip: (deps) => skipOrdnanceShip(deps.ordnanceDeps),
  setTorpedoAccel: (deps, cmd) => {
    deps.ctx.planningState.setTorpedoAcceleration(cmd.direction, cmd.steps);
    if (deps.ctx.planningState.torpedoAimingActive) {
      queueOrdnanceLaunch(deps.ordnanceDeps, 'torpedo');
    }
  },
  clearTorpedoAcceleration: (deps) =>
    deps.ctx.planningState.clearTorpedoAcceleration(),
} satisfies PartialCommandHandlerMap<
  | 'launchOrdnance'
  | 'emplaceBase'
  | 'skipOrdnance'
  | 'confirmOrdnance'
  | 'skipOrdnanceShip'
  | 'setTorpedoAccel'
  | 'clearTorpedoAcceleration'
>;

const fleetAndNavigationHandlers = {
  fleetReady: (deps, cmd) => deps.sendFleetReady(cmd.purchases),
  selectShip: (deps, cmd) => selectShip(deps, cmd.shipId),
  deselectShip: (deps) => deps.ctx.planningState.setSelectedShipId(null),
  cycleShip: (deps, cmd) => deps.cycleShip(cmd.direction),
  focusNearestEnemy: (deps) => deps.focusNearestEnemy(),
  focusOwnFleet: (deps) => deps.focusOwnFleet(),
  panCamera: (deps, cmd) => deps.renderer.camera.pan(cmd.dx, cmd.dy),
  zoomCamera: (deps, cmd) => {
    const { x, y } = deps.getCanvasCenter();
    deps.renderer.camera.zoomAt(x, y, cmd.factor);
  },
  setHoverHex: (deps, cmd) => deps.ctx.planningState.setHoverHex(cmd.hex),
} satisfies PartialCommandHandlerMap<
  | 'fleetReady'
  | 'selectShip'
  | 'deselectShip'
  | 'cycleShip'
  | 'focusNearestEnemy'
  | 'focusOwnFleet'
  | 'panCamera'
  | 'zoomCamera'
  | 'setHoverHex'
>;

const uiAndLifecycleHandlers = {
  toggleLog: (deps) => deps.ui.log.toggle(),
  toggleHelp: (deps) => deps.toggleHelp(),
  toggleMute: (deps) => {
    setMuted(!isMuted());
    deps.updateSoundButton();
  },
  requestRematch: (deps) => deps.sendRematch(),
  exitToMenu: (deps) => deps.exitToMenu(),
} satisfies PartialCommandHandlerMap<
  'toggleLog' | 'toggleHelp' | 'toggleMute' | 'requestRematch' | 'exitToMenu'
>;

const commandHandlers = {
  ...astrogationHandlers,
  ...combatHandlers,
  ...logisticsHandlers,
  ...ordnanceHandlers,
  ...fleetAndNavigationHandlers,
  ...uiAndLifecycleHandlers,
} satisfies CommandHandlerMap;

export const dispatchGameCommand = <T extends GameCommand>(
  deps: CommandRouterDeps,
  cmd: T,
): void => {
  const handler = commandHandlers[cmd.type] as (
    deps: CommandRouterDeps,
    cmd: T,
  ) => void;

  handler(deps, cmd);
};
