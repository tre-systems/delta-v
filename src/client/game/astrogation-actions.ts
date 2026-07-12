import {
  getOrderableShipsForPlayer,
  isOrderableShip,
} from '../../shared/engine/util';
import type { HexCoord } from '../../shared/hex';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { playCancel, playConfirm, playInvalid, playSelect } from '../audio';
import { buildAstrogationOrders } from './astrogation-orders';
import { deriveBurnChangePlan } from './burn';
import { planFleetSteer } from './fleet-steer';
import type {
  AstrogationPlanningStore,
  PlanningSelectionStore,
} from './planning';
import type { GameTransport } from './transport';
export interface AstrogationActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getPlayerId: () => PlayerId;
  getTransport: () => GameTransport | null;
  getMap: () => SolarSystemMap | null;
  planningState: PlanningSelectionStore & AstrogationPlanningStore;
  logText: (text: string) => void;
  track?: (event: string, props?: Record<string, unknown>) => void;
}

export const setBurnDirection = (
  deps: AstrogationActionDeps,
  dir: number | null,
  shipId?: string,
) => {
  if (deps.getClientState() !== 'playing_astrogation') return;
  const targetId = shipId ?? deps.planningState.selectedShipId;

  if (!targetId) return;

  if (dir === null) {
    deps.planningState.clearShipPlanning(targetId);
    playCancel();
    return;
  }
  const currentBurn = deps.planningState.burns.get(targetId) ?? null;
  const plan = deriveBurnChangePlan(
    deps.getGameState(),
    targetId,
    dir,
    currentBurn,
  );

  if (plan.kind === 'error') {
    deps.logText(plan.message);
    playInvalid();
    return;
  }

  if (plan.kind === 'noop') {
    return;
  }

  deps.planningState.setShipBurn(
    plan.shipId,
    plan.nextBurn,
    plan.clearOverload,
  );
  if (deps.planningState.landingShips.has(plan.shipId)) {
    deps.planningState.setShipLanding(plan.shipId, false);
  }
  deps.planningState.acknowledgeShip(plan.shipId);
  playSelect();

  // Auto-advance to the next ship in rotation that still needs acknowledgment
  const gameState = deps.getGameState();

  if (gameState) {
    const orderable = getOrderableShipsForPlayer(
      gameState,
      deps.getPlayerId() as PlayerId,
    );
    const currentIdx = orderable.findIndex((s) => s.id === plan.shipId);

    for (let offset = 1; offset < orderable.length; offset++) {
      const next = orderable[(currentIdx + offset) % orderable.length];

      if (
        !deps.planningState.acknowledgedShips.has(next.id) &&
        next.damage.disabledTurns === 0
      ) {
        deps.planningState.selectShip(next.id);
        return;
      }
    }
  }
};

// Acknowledge the current ship without setting a burn (it will drift).
// Auto-advances to the next unacknowledged ship.
export const skipShipBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;
  if (!shipId) return;

  deps.planningState.setShipLanding(shipId, false);
  deps.planningState.acknowledgeShip(shipId);
  playSelect();

  const gameState = deps.getGameState();
  if (gameState) {
    const orderable = getOrderableShipsForPlayer(
      gameState,
      deps.getPlayerId() as PlayerId,
    );
    const currentIdx = orderable.findIndex((s) => s.id === shipId);

    for (let offset = 1; offset < orderable.length; offset++) {
      const next = orderable[(currentIdx + offset) % orderable.length];
      if (
        !deps.planningState.acknowledgedShips.has(next.id) &&
        next.damage.disabledTurns === 0
      ) {
        deps.planningState.selectShip(next.id);
        return;
      }
    }
  }
};

export const clearSelectedBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;

  if (!shipId) return;
  deps.planningState.clearShipPlanning(shipId);
  playCancel();
};

export const undoSelectedShipBurn = (deps: AstrogationActionDeps) => {
  if (!deps.getGameState() || deps.getClientState() !== 'playing_astrogation')
    return;
  const shipId = deps.planningState.selectedShipId;

  if (shipId) {
    deps.planningState.clearShipPlanning(shipId);
    playCancel();
  }
};

// Steer every ship in the fleet group toward the clicked hex: pick each
// ship's best single burn (or drift) and acknowledge it, so a large fleet
// can be pointed at a destination in one click instead of ship by ship.
export const steerFleet = (
  deps: AstrogationActionDeps,
  targetHex: HexCoord,
) => {
  const gameState = deps.getGameState();
  const map = deps.getMap();

  if (!gameState || !map || deps.getClientState() !== 'playing_astrogation') {
    return;
  }

  const group = deps.planningState.selectedShipIds;

  if (!group || group.size < 2) {
    return;
  }

  const playerId = deps.getPlayerId() as PlayerId;
  // Orderable includes landed ships — steering launches them toward the
  // target together, which is the whole point of a fleet takeoff.
  const ships = gameState.ships.filter(
    (ship) =>
      group.has(ship.id) &&
      ship.owner === playerId &&
      isOrderableShip(ship) &&
      ship.damage.disabledTurns === 0,
  );

  const orders = planFleetSteer(
    ships,
    targetHex,
    map,
    gameState.destroyedBases,
  );

  if (orders.length === 0) {
    playInvalid();
    return;
  }

  for (const order of orders) {
    deps.planningState.setShipBurn(order.shipId, order.burn, true);
    deps.planningState.setShipLanding(order.shipId, false);
    deps.planningState.acknowledgeShip(order.shipId);
  }

  deps.track?.('fleet_steer_used', { ships: orders.length });
  playConfirm();
};

export const confirmOrders = (deps: AstrogationActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();

  if (
    !gameState ||
    deps.getClientState() !== 'playing_astrogation' ||
    !transport
  )
    return;
  const orders = buildAstrogationOrders(
    gameState,
    deps.getPlayerId() as PlayerId,
    deps.planningState,
  );
  playConfirm();
  transport.submitAstrogation(orders);
};
