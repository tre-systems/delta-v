import { SHIP_STATS } from '../../shared/constants';
import { hexKey } from '../../shared/hex';
import type { FleetPurchase, GameState } from '../../shared/types/domain';
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
import type { PlanningState } from './planning';
import {
  applyCombatPlanUpdate,
  clearTorpedoAcceleration,
  popQueuedAttack,
  setHoverHex,
  selectShip as setSelectedShip,
  setSelectedShipId,
  setShipOverload,
  setShipWeakGravityChoices,
  setTorpedoAcceleration,
} from './planning-store';
import type { GameTransport } from './transport';

interface CommandRouterContext {
  state: ClientState;
  playerId: number;
  gameState: GameState | null;
  transport: GameTransport | null;
  planningState: PlanningState;
}

interface CommandRouterUI {
  showAttackButton: (visible: boolean) => void;
  showFireButton: (visible: boolean, count: number) => void;
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
  ctx: CommandRouterContext;
  astrogationDeps: AstrogationActionDeps;
  combatDeps: CombatActionDeps;
  ordnanceDeps: OrdnanceActionDeps;
  logisticsUIState: LogisticsUIState | null;
  ui: CommandRouterUI;
  renderer: CommandRouterRenderer;
  getCanvasCenter: () => { x: number; y: number };
  updateHUD: () => void;
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
  planningState: PlanningState,
  plan: Extract<GameCommand, { type: 'setCombatPlan' }>,
): void => {
  applyCombatPlanUpdate(planningState, plan.plan, plan.selectedShipId);
};

const undoQueuedAttack = (deps: CommandRouterDeps): void => {
  const count = popQueuedAttack(deps.ctx.planningState);

  deps.ui.showFireButton(count > 0, count);
  deps.ui.overlay.showToast(
    count > 0 ? `Undid last attack (${count} queued)` : 'Attack queue cleared',
    'info',
  );
};

const skipLogistics = (deps: CommandRouterDeps): void => {
  const transport = deps.ctx.transport;

  if (deps.ctx.state === 'playing_logistics' && transport) {
    transport.skipLogistics();
  }
};

const confirmTransfers = (deps: CommandRouterDeps): void => {
  const transport = deps.ctx.transport;

  if (
    deps.ctx.state !== 'playing_logistics' ||
    !transport ||
    !deps.logisticsUIState
  ) {
    return;
  }

  const orders = buildTransferOrders(deps.logisticsUIState);

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
  const ship = deps.ctx.gameState?.ships.find(
    (candidate) => candidate.id === shipId,
  );

  if (ship) {
    setSelectedShip(deps.ctx.planningState, shipId, hexKey(ship.position));
    deps.renderer.centerOnHex(ship.position);

    const myAlive = deps.ctx.gameState?.ships.filter(
      (candidate) =>
        candidate.owner === deps.ctx.playerId &&
        candidate.lifecycle !== 'destroyed',
    );

    if (myAlive && myAlive.length > 1) {
      const name = SHIP_STATS[ship.type]?.name ?? ship.type;
      deps.ui.overlay.showToast(`Selected: ${name}`, 'info');
    }
  } else {
    setSelectedShipId(deps.ctx.planningState, shipId);
  }

  deps.updateHUD();
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
      setShipOverload(deps.ctx.planningState, cmd.shipId, cmd.direction);
      playSelect();
      deps.updateHUD();
      return;
    case 'setWeakGravityChoices':
      setShipWeakGravityChoices(
        deps.ctx.planningState,
        cmd.shipId,
        cmd.choices,
      );
      deps.updateHUD();
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
      deps.updateHUD();
      return;
    case 'clearCombatSelection':
      clearCombatSelection(deps.combatDeps);
      deps.ui.showAttackButton(false);
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
      setSelectedShipId(deps.ctx.planningState, null);
      deps.updateHUD();
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
      setTorpedoAcceleration(deps.ctx.planningState, cmd.direction, cmd.steps);
      deps.updateHUD();
      return;
    case 'clearTorpedoAcceleration':
      clearTorpedoAcceleration(deps.ctx.planningState);
      deps.updateHUD();
      return;
    case 'setHoverHex':
      setHoverHex(deps.ctx.planningState, cmd.hex);
      return;
    case 'requestRematch':
      deps.sendRematch();
      return;
    case 'exitToMenu':
      deps.exitToMenu();
      return;
  }
};
