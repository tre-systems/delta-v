import { must } from '../../shared/assert';
import type {
  GameState,
  OrdnanceType,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import {
  getFirstUnacknowledgedOrdnanceActionableShipId,
  getOrdnanceActionableShipIds,
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

  const actionableShipId = getFirstUnacknowledgedOrdnanceActionableShipId(
    gameState,
    deps.getPlayerId(),
    deps.planningState.acknowledgedOrdnanceShips,
    deps.getMap(),
  );

  if (actionableShipId) {
    deps.planningState.selectShip(actionableShipId);
    return;
  }

  deps.planningState.setSelectedShipId(null);
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
    deps.logText(TOAST.gameplay.torpedoAimingIntro);
    return;
  }

  const plan = resolveOrdnanceLaunchPlan(
    gameState,
    deps.planningState,
    ordType,
    deps.getMap(),
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

  // Launches are already logged to the game log; avoid duplicating the same
  // event as a toast in the same tick.
  deps.logText(`${plan.shipName} launched ${ordType}`);
  advanceToNextOrdnanceShip(deps);

  if (allOrdnanceShipsAcknowledged(deps)) {
    confirmOrdnance(deps);
  }
};

// Acknowledge the current ship without launching anything.
// Auto-confirms the phase when all ships have been acknowledged.
export const skipOrdnanceShip = (deps: OrdnanceActionDeps) => {
  const gameState = deps.getGameState();
  if (!gameState || deps.getClientState() !== 'playing_ordnance') return;

  const shipId = deps.planningState.selectedShipId;
  if (shipId) {
    deps.planningState.acknowledgeOrdnanceShip(shipId);
  }
  advanceToNextOrdnanceShip(deps);

  if (allOrdnanceShipsAcknowledged(deps)) {
    confirmOrdnance(deps);
  }
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

  return getOrdnanceActionableShipIds(
    gameState,
    deps.getPlayerId(),
    deps.getMap(),
  ).every((shipId) => deps.planningState.acknowledgedOrdnanceShips.has(shipId));
};

// Enter the ordnance phase: auto-select the first launchable ship.
export const enterOrdnancePhase = (deps: OrdnanceActionDeps): void => {
  deps.planningState.enterPhase('ordnance');
  advanceToNextOrdnanceShip(deps);
};
