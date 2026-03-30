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
  matchVelocityWithNearbyFriendly,
  setBurnDirection,
  undoSelectedShipBurn,
} from './astrogation-actions';
import {
  adjustCombatStrength,
  type CombatActionDeps,
  clearCombatSelection,
  fireAllAttacks,
  queueAttack,
  resetCombatStrengthToMax,
  sendSkipCombat,
} from './combat-actions';
import type { GameCommand } from './commands';
import { buildTransferOrders, type LogisticsUIState } from './logistics-ui';
import {
  type OrdnanceActionDeps,
  sendEmplaceBase,
  sendOrdnanceLaunch,
  sendSkipOrdnance,
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
  getLogisticsState: () => LogisticsUIState | null;
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

const skipLogistics = (deps: CommandRouterDeps): void => {
  const transport = deps.ctx.getTransport();

  if (deps.ctx.getState() === 'playing_logistics' && transport) {
    transport.skipLogistics();
  }
};

const confirmTransfers = (deps: CommandRouterDeps): void => {
  const transport = deps.ctx.getTransport();

  if (
    deps.ctx.getState() !== 'playing_logistics' ||
    !transport ||
    !deps.ctx.getLogisticsState()
  ) {
    return;
  }

  const logisticsState = deps.ctx.getLogisticsState();

  if (!logisticsState) {
    return;
  }

  const orders = buildTransferOrders(logisticsState);

  if (orders.length > 0) {
    transport.submitLogistics(orders);
  } else {
    transport.skipLogistics();
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

export const dispatchGameCommand = (
  deps: CommandRouterDeps,
  cmd: GameCommand,
): void => {
  switch (cmd.type) {
    case 'confirmOrders':
      confirmOrders(deps.astrogationDeps);
      return;
    case 'undoBurn':
      undoSelectedShipBurn(deps.astrogationDeps);
      return;
    case 'matchVelocity':
      matchVelocityWithNearbyFriendly(deps.astrogationDeps);
      return;
    case 'setBurnDirection':
      setBurnDirection(deps.astrogationDeps, cmd.direction, cmd.shipId);
      return;
    case 'setOverloadDirection':
      deps.ctx.planningState.setShipOverload(cmd.shipId, cmd.direction);
      playSelect();
      return;
    case 'setWeakGravityChoices':
      deps.ctx.planningState.setShipWeakGravityChoices(cmd.shipId, cmd.choices);
      return;
    case 'clearSelectedBurn':
      clearSelectedBurn(deps.astrogationDeps);
      return;
    case 'queueAttack':
      queueAttack(deps.combatDeps);
      return;
    case 'fireAllAttacks':
      fireAllAttacks(deps.combatDeps);
      return;
    case 'skipCombat':
      sendSkipCombat(deps.combatDeps);
      return;
    case 'adjustCombatStrength':
      adjustCombatStrength(deps.combatDeps, cmd.delta);
      return;
    case 'resetCombatStrength':
      resetCombatStrengthToMax(deps.combatDeps);
      return;
    case 'setCombatPlan':
      setCombatPlan(deps.ctx.planningState, cmd);
      return;
    case 'clearCombatSelection':
      clearCombatSelection(deps.combatDeps);
      return;
    case 'undoQueuedAttack':
      undoQueuedAttack(deps);
      return;
    case 'launchOrdnance':
      sendOrdnanceLaunch(deps.ordnanceDeps, cmd.ordType);
      return;
    case 'emplaceBase':
      sendEmplaceBase(deps.ordnanceDeps);
      return;
    case 'skipOrdnance':
      sendSkipOrdnance(deps.ordnanceDeps);
      return;
    case 'skipLogistics':
      skipLogistics(deps);
      return;
    case 'confirmTransfers':
      confirmTransfers(deps);
      return;
    case 'fleetReady':
      deps.sendFleetReady(cmd.purchases);
      return;
    case 'selectShip':
      selectShip(deps, cmd.shipId);
      return;
    case 'deselectShip':
      deps.ctx.planningState.setSelectedShipId(null);
      return;
    case 'cycleShip':
      deps.cycleShip(cmd.direction);
      return;
    case 'focusNearestEnemy':
      deps.focusNearestEnemy();
      return;
    case 'focusOwnFleet':
      deps.focusOwnFleet();
      return;
    case 'panCamera':
      deps.renderer.camera.pan(cmd.dx, cmd.dy);
      return;
    case 'zoomCamera': {
      const { x, y } = deps.getCanvasCenter();
      deps.renderer.camera.zoomAt(x, y, cmd.factor);
      return;
    }
    case 'toggleLog':
      deps.ui.log.toggle();
      return;
    case 'toggleHelp':
      deps.toggleHelp();
      return;
    case 'toggleMute':
      setMuted(!isMuted());
      deps.updateSoundButton();
      return;
    case 'setTorpedoAccel':
      deps.ctx.planningState.setTorpedoAcceleration(cmd.direction, cmd.steps);
      return;
    case 'clearTorpedoAcceleration':
      deps.ctx.planningState.clearTorpedoAcceleration();
      return;
    case 'setHoverHex':
      deps.ctx.planningState.setHoverHex(cmd.hex);
      return;
    case 'requestRematch':
      deps.sendRematch();
      return;
    case 'exitToMenu':
      deps.exitToMenu();
      return;
  }
};
