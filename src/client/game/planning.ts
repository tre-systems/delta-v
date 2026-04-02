import type { HexCoord } from '../../shared/hex';
import type { CombatAttack, OrdnanceLaunch } from '../../shared/types/domain';
import type { Signal } from '../reactive';
import { signal } from '../reactive';
import type { CombatTargetPlan } from './combat';

export interface PlanningState {
  readonly revisionSignal?: Signal<number>;
  selectedShipId: string | null;

  // shipId -> burn direction (or null for no burn)
  burns: Map<string, number | null>;

  // shipId -> overload direction (warships only, 2 fuel total)
  overloads: Map<string, number | null>;

  // ships that are attempting to land from orbit
  landingShips: Set<string>;

  // shipId -> { hexKey: true to ignore }
  weakGravityChoices: Map<string, Record<string, boolean>>;

  // torpedo aiming mode (direction picker active)
  torpedoAimingActive: boolean;

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

  // ships explicitly acknowledged during astrogation (burn set or skipped)
  acknowledgedShips: Set<string>;

  // ordnance launches queued during ordnance phase (batch submit)
  queuedOrdnanceLaunches: OrdnanceLaunch[];

  // ships acknowledged during ordnance phase (launched or skipped)
  acknowledgedOrdnanceShips: Set<string>;

  // current hex being hovered by mouse
  hoverHex: HexCoord | null;

  // hexKey of last ship-selection click, for cycling stacked ships
  lastSelectedHex: string | null;
}

export interface PlanningStore extends PlanningState {
  readonly revisionSignal: Signal<number>;
  setSelectedShipId: (shipId: string | null) => void;
  selectShip: (shipId: string, lastSelectedHex?: string | null) => void;
  clearShipPlanning: (shipId: string) => void;
  resetAstrogationPlanning: () => void;
  setShipBurn: (
    shipId: string,
    burn: number | null,
    clearOverload?: boolean,
  ) => void;
  setShipOverload: (shipId: string, direction: number | null) => void;
  setShipLanding: (shipId: string, landing: boolean) => void;
  setShipWeakGravityChoices: (
    shipId: string,
    choices: Record<string, boolean>,
  ) => void;
  applyCombatPlanUpdate: (
    plan: CombatTargetPlan,
    selectedShipId?: string,
  ) => void;
  clearCombatSelectionState: () => void;
  resetCombatPlanning: () => void;
  queueCombatAttack: (attack: CombatAttack) => number;
  popQueuedAttack: () => number;
  takeQueuedAttacks: () => CombatAttack[];
  setCombatAttackStrength: (strength: number | null) => void;
  setTorpedoAimingActive: (active: boolean) => void;
  setTorpedoAcceleration: (
    direction: number | null,
    steps: 1 | 2 | null,
  ) => void;
  clearTorpedoAcceleration: () => void;
  acknowledgeShip: (shipId: string) => void;
  queueOrdnanceLaunch: (launch: OrdnanceLaunch) => void;
  acknowledgeOrdnanceShip: (shipId: string) => void;
  takeQueuedOrdnanceLaunches: () => OrdnanceLaunch[];
  resetOrdnancePlanning: () => void;
  setHoverHex: (hex: HexCoord | null) => void;
}

const defineHiddenPlanningMember = <K extends keyof PlanningStore>(
  planningState: PlanningStore,
  key: K,
  value: PlanningStore[K],
): void => {
  Object.defineProperty(planningState, key, {
    enumerable: false,
    configurable: false,
    writable: false,
    value,
  });
};

export const createPlanningStore = (): PlanningStore => {
  const planningState: PlanningState = {
    selectedShipId: null,
    burns: new Map(),
    overloads: new Map(),
    landingShips: new Set(),
    weakGravityChoices: new Map(),
    torpedoAimingActive: false,
    torpedoAccel: null,
    torpedoAccelSteps: null,
    combatTargetId: null,
    combatTargetType: null,
    combatAttackerIds: [],
    combatAttackStrength: null,
    queuedAttacks: [],
    acknowledgedShips: new Set(),
    queuedOrdnanceLaunches: [],
    acknowledgedOrdnanceShips: new Set(),
    hoverHex: null,
    lastSelectedHex: null,
  };
  const planningStore = planningState as PlanningStore;

  const notifyPlanningChanged = (): void => {
    planningStore.revisionSignal.update((n) => n + 1);
  };

  defineHiddenPlanningMember(planningStore, 'revisionSignal', signal(0));
  defineHiddenPlanningMember(
    planningStore,
    'setSelectedShipId',
    (shipId: string | null): void => {
      if (planningStore.selectedShipId === shipId) return;
      planningStore.selectedShipId = shipId;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'selectShip',
    (shipId: string, lastSelectedHex?: string | null): void => {
      planningStore.selectedShipId = shipId;

      if (lastSelectedHex !== undefined) {
        planningStore.lastSelectedHex = lastSelectedHex;
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'clearShipPlanning',
    (shipId: string): void => {
      planningStore.burns.delete(shipId);
      planningStore.overloads.delete(shipId);
      planningStore.landingShips.delete(shipId);
      planningStore.weakGravityChoices.delete(shipId);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'resetAstrogationPlanning',
    (): void => {
      planningStore.selectedShipId = null;
      planningStore.lastSelectedHex = null;
      planningStore.burns.clear();
      planningStore.overloads.clear();
      planningStore.landingShips.clear();
      planningStore.weakGravityChoices.clear();
      planningStore.acknowledgedShips.clear();
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipBurn',
    (shipId: string, burn: number | null, clearOverload = false): void => {
      planningStore.burns.set(shipId, burn);

      if (clearOverload) {
        planningStore.overloads.delete(shipId);
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipOverload',
    (shipId: string, direction: number | null): void => {
      planningStore.overloads.set(shipId, direction);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipLanding',
    (shipId: string, landing: boolean): void => {
      if (landing) {
        planningStore.landingShips.add(shipId);
      } else {
        planningStore.landingShips.delete(shipId);
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipWeakGravityChoices',
    (shipId: string, choices: Record<string, boolean>): void => {
      planningStore.weakGravityChoices.set(shipId, choices);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'applyCombatPlanUpdate',
    (plan: CombatTargetPlan, selectedShipId?: string): void => {
      Object.assign(planningStore, plan);

      if (selectedShipId !== undefined) {
        planningStore.selectedShipId = selectedShipId;
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'clearCombatSelectionState',
    (): void => {
      planningStore.combatTargetId = null;
      planningStore.combatTargetType = null;
      planningStore.combatAttackerIds = [];
      planningStore.combatAttackStrength = null;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(planningStore, 'resetCombatPlanning', (): void => {
    planningStore.combatTargetId = null;
    planningStore.combatTargetType = null;
    planningStore.combatAttackerIds = [];
    planningStore.combatAttackStrength = null;
    planningStore.queuedAttacks = [];
    notifyPlanningChanged();
  });
  defineHiddenPlanningMember(
    planningStore,
    'queueCombatAttack',
    (attack: CombatAttack): number => {
      planningStore.queuedAttacks.push(attack);
      notifyPlanningChanged();
      return planningStore.queuedAttacks.length;
    },
  );
  defineHiddenPlanningMember(planningStore, 'popQueuedAttack', (): number => {
    planningStore.queuedAttacks.pop();
    notifyPlanningChanged();
    return planningStore.queuedAttacks.length;
  });
  defineHiddenPlanningMember(
    planningStore,
    'takeQueuedAttacks',
    (): CombatAttack[] => {
      const attacks = [...planningStore.queuedAttacks];
      planningStore.queuedAttacks = [];
      notifyPlanningChanged();
      return attacks;
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setCombatAttackStrength',
    (strength: number | null): void => {
      planningStore.combatAttackStrength = strength;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setTorpedoAimingActive',
    (active: boolean): void => {
      planningStore.torpedoAimingActive = active;
      if (!active) {
        planningStore.torpedoAccel = null;
        planningStore.torpedoAccelSteps = null;
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setTorpedoAcceleration',
    (direction: number | null, steps: 1 | 2 | null): void => {
      planningStore.torpedoAccel = direction;
      planningStore.torpedoAccelSteps = steps;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'clearTorpedoAcceleration',
    (): void => {
      planningStore.torpedoAccel = null;
      planningStore.torpedoAccelSteps = null;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'acknowledgeShip',
    (shipId: string): void => {
      planningStore.acknowledgedShips.add(shipId);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'queueOrdnanceLaunch',
    (launch: OrdnanceLaunch): void => {
      planningStore.queuedOrdnanceLaunches.push(launch);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'acknowledgeOrdnanceShip',
    (shipId: string): void => {
      planningStore.acknowledgedOrdnanceShips.add(shipId);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'takeQueuedOrdnanceLaunches',
    (): OrdnanceLaunch[] => {
      const launches = [...planningStore.queuedOrdnanceLaunches];
      planningStore.queuedOrdnanceLaunches = [];
      notifyPlanningChanged();
      return launches;
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'resetOrdnancePlanning',
    (): void => {
      planningStore.queuedOrdnanceLaunches = [];
      planningStore.acknowledgedOrdnanceShips.clear();
      planningStore.torpedoAimingActive = false;
      planningStore.torpedoAccel = null;
      planningStore.torpedoAccelSteps = null;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setHoverHex',
    (hex: HexCoord | null): void => {
      planningStore.hoverHex = hex;
      notifyPlanningChanged();
    },
  );

  return planningStore;
};
