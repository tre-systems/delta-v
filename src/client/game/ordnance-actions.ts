import { must } from '../../shared/assert';
import {
  getOrderableShipsForPlayer,
  hasValidOrdnanceLaunch,
} from '../../shared/engine/util';
import type {
  GameState,
  OrdnanceType,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  getFirstBaseEmplacementShipId,
  resolveBaseEmplacementPlan,
  resolveOrdnanceLaunchPlan,
} from './ordnance';
import type { OrdnancePlanningStore, PlanningSelectionStore } from './planning';
import type { GameTransport } from './transport';
export interface OrdnanceActionDeps {
  getGameState: () => GameState | null;
  getClientState: () => string;
  getPlayerId: () => PlayerId;
  getMap: () => SolarSystemMap;
  getTransport: () => GameTransport | null;
  planningState: PlanningSelectionStore & OrdnancePlanningStore;
  showToast: (msg: string, type: 'error' | 'info' | 'success') => void;
  logText: (text: string) => void;
}

// Find the next ordnance-eligible ship that hasn't been acknowledged.
const advanceToNextOrdnanceShip = (deps: OrdnanceActionDeps): void => {
  const gameState = deps.getGameState();
  if (!gameState) return;
  deps.planningState.setTorpedoAimingActive(false);

  const orderable = getOrderableShipsForPlayer(gameState, deps.getPlayerId());

  const launchable = orderable.filter(
    (s) =>
      !deps.planningState.acknowledgedOrdnanceShips.has(s.id) &&
      hasValidOrdnanceLaunch(gameState, s),
  );

  if (launchable.length > 0) {
    deps.planningState.selectShip(launchable[0].id);
  } else {
    const actionableShipId = getFirstBaseEmplacementShipId(
      gameState,
      deps.getPlayerId(),
      deps.getMap(),
    );

    if (actionableShipId) {
      deps.planningState.selectShip(actionableShipId);
      return;
    }

    deps.planningState.setSelectedShipId(null);
  }
};

// Queue a launch locally (batch model). Acknowledges the ship and
// auto-advances to the next launchable ship.
export const queueOrdnanceLaunch = (
  deps: OrdnanceActionDeps,
  ordType: OrdnanceType,
) => {
  const gameState = deps.getGameState();

  if (!gameState || deps.getClientState() !== 'playing_ordnance') return;

  // Torpedoes need a direction pick first
  if (ordType === 'torpedo' && !deps.planningState.torpedoAimingActive) {
    deps.planningState.clearTorpedoAcceleration();
    deps.planningState.setTorpedoAimingActive(true);
    deps.showToast(
      'Torpedo aiming: choose an adjacent hex for boost, or queue again for a straight shot',
      'info',
    );
    return;
  }

  const plan = resolveOrdnanceLaunchPlan(
    gameState,
    deps.planningState,
    ordType,
  );

  if (!plan.ok) {
    if (plan.message) {
      deps.showToast(plan.message, must(plan.level));
    }
    return;
  }

  const launch = must(plan.launch);
  deps.planningState.queueOrdnanceLaunch(launch);
  deps.planningState.acknowledgeOrdnanceShip(launch.shipId);
  deps.planningState.setTorpedoAimingActive(false);

  const boostHint =
    ordType === 'torpedo' && launch.torpedoAccel !== null
      ? ` with \u00d7${launch.torpedoAccelSteps ?? 1} boost`
      : '';
  deps.showToast(`${plan.shipName}: ${ordType} queued${boostHint}`, 'success');
  deps.logText(`${plan.shipName} launched ${ordType}`);
  advanceToNextOrdnanceShip(deps);
};

// Acknowledge the current ship without launching anything.
export const skipOrdnanceShip = (deps: OrdnanceActionDeps) => {
  const gameState = deps.getGameState();
  if (!gameState || deps.getClientState() !== 'playing_ordnance') return;

  const shipId = deps.planningState.selectedShipId;
  if (shipId) {
    deps.planningState.acknowledgeOrdnanceShip(shipId);
  }
  advanceToNextOrdnanceShip(deps);
};

// Send all queued ordnance launches to the server (or skip if none).
export const confirmOrdnance = (deps: OrdnanceActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();

  if (!gameState || deps.getClientState() !== 'playing_ordnance' || !transport)
    return;

  const launches = deps.planningState.takeQueuedOrdnanceLaunches();
  if (launches.length > 0) {
    transport.submitOrdnance(launches);
  } else {
    transport.skipOrdnance();
  }
};

export const sendEmplaceBase = (deps: OrdnanceActionDeps) => {
  const gameState = deps.getGameState();
  const transport = deps.getTransport();

  if (!gameState || deps.getClientState() !== 'playing_ordnance' || !transport)
    return;
  const plan = resolveBaseEmplacementPlan(
    gameState,
    must(deps.planningState.selectedShipId),
    deps.getMap(),
  );

  if (!plan.ok) {
    if (plan.message) {
      deps.showToast(plan.message, must(plan.level));
    }
    return;
  }
  transport.submitEmplacement(must(plan.emplacements));
};

// Check if all ordnance-eligible ships have been acknowledged.
export const allOrdnanceShipsAcknowledged = (
  deps: OrdnanceActionDeps,
): boolean => {
  const gameState = deps.getGameState();
  if (!gameState) return true;

  const orderable = getOrderableShipsForPlayer(gameState, deps.getPlayerId());

  return orderable
    .filter((s) => hasValidOrdnanceLaunch(gameState, s))
    .every((s) => deps.planningState.acknowledgedOrdnanceShips.has(s.id));
};

// Enter the ordnance phase: auto-select the first launchable ship.
export const enterOrdnancePhase = (deps: OrdnanceActionDeps): void => {
  deps.planningState.enterPhase('ordnance');
  advanceToNextOrdnanceShip(deps);
};
