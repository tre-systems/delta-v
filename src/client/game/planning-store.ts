import type { HexCoord } from '../../shared/hex';
import type { CombatAttack } from '../../shared/types/domain';
import type { CombatTargetPlan } from './combat';
import { bumpPlanningRevision, type PlanningState } from './planning';

type PlanningRevisionState = {
  revisionSignal?: PlanningState['revisionSignal'];
};

type SelectedShipState = PlanningRevisionState &
  Pick<PlanningState, 'selectedShipId'>;
type ShipSelectionState = PlanningRevisionState &
  Pick<PlanningState, 'selectedShipId' | 'lastSelectedHex'>;

const notifyPlanningChanged = (planningState: PlanningRevisionState): void => {
  bumpPlanningRevision(planningState);
};

export const setSelectedShipId = (
  planningState: SelectedShipState,
  shipId: string | null,
): void => {
  if (planningState.selectedShipId === shipId) return;
  planningState.selectedShipId = shipId;
  notifyPlanningChanged(planningState);
};

export const selectShip = (
  planningState: ShipSelectionState,
  shipId: string,
  lastSelectedHex?: string | null,
): void => {
  planningState.selectedShipId = shipId;

  if (lastSelectedHex !== undefined) {
    planningState.lastSelectedHex = lastSelectedHex;
  }
  notifyPlanningChanged(planningState);
};

export const clearShipPlanning = (
  planningState: PlanningState,
  shipId: string,
): void => {
  planningState.burns.delete(shipId);
  planningState.overloads.delete(shipId);
  planningState.weakGravityChoices.delete(shipId);
  notifyPlanningChanged(planningState);
};

export const resetAstrogationPlanning = (
  planningState: PlanningState,
): void => {
  planningState.selectedShipId = null;
  planningState.lastSelectedHex = null;
  planningState.burns.clear();
  planningState.overloads.clear();
  planningState.weakGravityChoices.clear();
  notifyPlanningChanged(planningState);
};

export const setShipBurn = (
  planningState: PlanningState,
  shipId: string,
  burn: number | null,
  clearOverload = false,
): void => {
  planningState.burns.set(shipId, burn);

  if (clearOverload) {
    planningState.overloads.delete(shipId);
  }
  notifyPlanningChanged(planningState);
};

export const setShipOverload = (
  planningState: PlanningState,
  shipId: string,
  direction: number | null,
): void => {
  planningState.overloads.set(shipId, direction);
  notifyPlanningChanged(planningState);
};

export const setShipWeakGravityChoices = (
  planningState: PlanningState,
  shipId: string,
  choices: Record<string, boolean>,
): void => {
  planningState.weakGravityChoices.set(shipId, choices);
  notifyPlanningChanged(planningState);
};

export const applyCombatPlanUpdate = (
  planningState: PlanningState,
  plan: CombatTargetPlan,
  selectedShipId?: string,
): void => {
  Object.assign(planningState, plan);

  if (selectedShipId !== undefined) {
    planningState.selectedShipId = selectedShipId;
  }
  notifyPlanningChanged(planningState);
};

export const clearCombatSelectionState = (
  planningState: PlanningState,
): void => {
  planningState.combatTargetId = null;
  planningState.combatTargetType = null;
  planningState.combatAttackerIds = [];
  planningState.combatAttackStrength = null;
  notifyPlanningChanged(planningState);
};

export const resetCombatPlanning = (planningState: PlanningState): void => {
  planningState.combatTargetId = null;
  planningState.combatTargetType = null;
  planningState.combatAttackerIds = [];
  planningState.combatAttackStrength = null;
  planningState.queuedAttacks = [];
  notifyPlanningChanged(planningState);
};

export const queueCombatAttack = (
  planningState: PlanningState,
  attack: CombatAttack,
): number => {
  planningState.queuedAttacks.push(attack);
  notifyPlanningChanged(planningState);
  return planningState.queuedAttacks.length;
};

export const popQueuedAttack = (planningState: PlanningState): number => {
  planningState.queuedAttacks.pop();
  notifyPlanningChanged(planningState);
  return planningState.queuedAttacks.length;
};

export const takeQueuedAttacks = (
  planningState: PlanningState,
): CombatAttack[] => {
  const attacks = [...planningState.queuedAttacks];
  planningState.queuedAttacks = [];
  notifyPlanningChanged(planningState);
  return attacks;
};

export const setCombatAttackStrength = (
  planningState: PlanningState,
  strength: number | null,
): void => {
  planningState.combatAttackStrength = strength;
  notifyPlanningChanged(planningState);
};

export const setTorpedoAcceleration = (
  planningState: PlanningState,
  direction: number | null,
  steps: 1 | 2 | null,
): void => {
  planningState.torpedoAccel = direction;
  planningState.torpedoAccelSteps = steps;
  notifyPlanningChanged(planningState);
};

export const clearTorpedoAcceleration = (
  planningState: PlanningState,
): void => {
  planningState.torpedoAccel = null;
  planningState.torpedoAccelSteps = null;
  notifyPlanningChanged(planningState);
};

export const setHoverHex = (
  planningState: PlanningState,
  hex: HexCoord | null,
): void => {
  planningState.hoverHex = hex;
  notifyPlanningChanged(planningState);
};
