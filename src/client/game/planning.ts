import type { HexCoord } from '../../shared/hex';
import type { CombatAttack } from '../../shared/types';

export interface PlanningState {
  selectedShipId: string | null;
  burns: Map<string, number | null>; // shipId -> burn direction (or null for no burn)
  overloads: Map<string, number | null>; // shipId -> overload direction (warships only, 2 fuel total)
  weakGravityChoices: Map<string, Record<string, boolean>>; // shipId -> { hexKey: true to ignore }
  torpedoAccel: number | null; // direction for torpedo launch boost
  torpedoAccelSteps: 1 | 2 | null;
  combatTargetId: string | null; // enemy ship targeted for combat
  combatTargetType: 'ship' | 'ordnance' | null;
  combatAttackerIds: string[];
  combatAttackStrength: number | null;
  queuedAttacks: CombatAttack[]; // multi-target: attacks queued before sending
  hoverHex: HexCoord | null; // current hex being hovered by mouse
  lastSelectedHex: string | null; // hexKey of last ship-selection click, for cycling stacked ships
}

export const createInitialPlanningState = (): PlanningState => ({
  selectedShipId: null,
  burns: new Map(),
  overloads: new Map(),
  weakGravityChoices: new Map(),
  torpedoAccel: null,
  torpedoAccelSteps: null,
  combatTargetId: null,
  combatTargetType: null,
  combatAttackerIds: [],
  combatAttackStrength: null,
  queuedAttacks: [],
  hoverHex: null,
  lastSelectedHex: null,
});
