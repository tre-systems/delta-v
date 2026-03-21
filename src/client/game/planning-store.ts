import type { HexCoord } from '../../shared/hex';
import type { CombatAttack } from '../../shared/types/domain';
import type { CombatTargetPlan } from './combat';
import type { PlanningState } from './planning';

type SelectedShipState = Pick<PlanningState, 'selectedShipId'>;
type ShipSelectionState = Pick<
  PlanningState,
  'selectedShipId' | 'lastSelectedHex'
>;

export const setSelectedShipId = (
  planningState: SelectedShipState,
  shipId: string | null,
): void => {
  planningState.selectedShipId = shipId;
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
};

export const clearShipPlanning = (
  planningState: PlanningState,
  shipId: string,
): void => {
  planningState.burns.delete(shipId);
  planningState.overloads.delete(shipId);
  planningState.weakGravityChoices.delete(shipId);
};

export const resetAstrogationPlanning = (
  planningState: PlanningState,
): void => {
  planningState.selectedShipId = null;
  planningState.lastSelectedHex = null;
  planningState.burns.clear();
  planningState.overloads.clear();
  planningState.weakGravityChoices.clear();
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
};

export const setShipOverload = (
  planningState: PlanningState,
  shipId: string,
  direction: number | null,
): void => {
  planningState.overloads.set(shipId, direction);
};

export const setShipWeakGravityChoices = (
  planningState: PlanningState,
  shipId: string,
  choices: Record<string, boolean>,
): void => {
  planningState.weakGravityChoices.set(shipId, choices);
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
};

export const clearCombatSelectionState = (
  planningState: PlanningState,
): void => {
  planningState.combatTargetId = null;
  planningState.combatTargetType = null;
  planningState.combatAttackerIds = [];
  planningState.combatAttackStrength = null;
};

export const resetCombatPlanning = (planningState: PlanningState): void => {
  clearCombatSelectionState(planningState);
  planningState.queuedAttacks = [];
};

export const queueCombatAttack = (
  planningState: PlanningState,
  attack: CombatAttack,
): number => {
  planningState.queuedAttacks.push(attack);
  return planningState.queuedAttacks.length;
};

export const popQueuedAttack = (planningState: PlanningState): number => {
  planningState.queuedAttacks.pop();
  return planningState.queuedAttacks.length;
};

export const takeQueuedAttacks = (
  planningState: PlanningState,
): CombatAttack[] => {
  const attacks = [...planningState.queuedAttacks];
  planningState.queuedAttacks = [];
  return attacks;
};

export const setCombatAttackStrength = (
  planningState: PlanningState,
  strength: number | null,
): void => {
  planningState.combatAttackStrength = strength;
};

export const setTorpedoAcceleration = (
  planningState: PlanningState,
  direction: number | null,
  steps: 1 | 2 | null,
): void => {
  planningState.torpedoAccel = direction;
  planningState.torpedoAccelSteps = steps;
};

export const clearTorpedoAcceleration = (
  planningState: PlanningState,
): void => {
  planningState.torpedoAccel = null;
  planningState.torpedoAccelSteps = null;
};

export const setHoverHex = (
  planningState: PlanningState,
  hex: HexCoord | null,
): void => {
  planningState.hoverHex = hex;
};
