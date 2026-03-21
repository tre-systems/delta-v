import type { HexCoord } from '../../shared/hex';
import type { CombatAttack } from '../../shared/types/domain';

export interface PlanningState {
  selectedShipId: string | null;

  // shipId -> burn direction (or null for no burn)
  burns: Map<string, number | null>;

  // shipId -> overload direction (warships only, 2 fuel total)
  overloads: Map<string, number | null>;

  // shipId -> { hexKey: true to ignore }
  weakGravityChoices: Map<string, Record<string, boolean>>;

  // direction for torpedo launch boost
  torpedoAccel: number | null;
  torpedoAccelSteps: 1 | 2 | null;

  // enemy ship targeted for combat
  combatTargetId: string | null;
  combatTargetType: 'ship' | 'ordnance' | null;
  combatAttackerIds: string[];
  combatAttackStrength: number | null;

  // multi-target: attacks queued before sending
  queuedAttacks: CombatAttack[];

  // current hex being hovered by mouse
  hoverHex: HexCoord | null;

  // hexKey of last ship-selection click, for cycling stacked ships
  lastSelectedHex: string | null;
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
