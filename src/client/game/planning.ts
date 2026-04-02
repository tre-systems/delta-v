import type { HexCoord } from '../../shared/hex';
import type { CombatAttack, OrdnanceLaunch } from '../../shared/types/domain';
import type { Signal } from '../reactive';
import { signal } from '../reactive';
import type { CombatTargetPlan } from './combat';

type CombatTargetType = 'ship' | 'ordnance' | null;

interface PlanningSelectionState {
  selectedShipId: string | null;
  hoverHex: HexCoord | null;
  lastSelectedHex: string | null;
}

interface AstrogationPlanningState {
  burns: Map<string, number | null>;
  overloads: Map<string, number | null>;
  landingShips: Set<string>;
  weakGravityChoices: Map<string, Record<string, boolean>>;
  acknowledgedShips: Set<string>;
}

interface OrdnancePlanningState {
  torpedoAimingActive: boolean;
  torpedoAccel: number | null;
  torpedoAccelSteps: 1 | 2 | null;
  queuedOrdnanceLaunches: OrdnanceLaunch[];
  acknowledgedOrdnanceShips: Set<string>;
}

interface CombatPlanningState {
  combatTargetId: string | null;
  combatTargetType: CombatTargetType;
  combatAttackerIds: string[];
  combatAttackStrength: number | null;
  queuedAttacks: CombatAttack[];
}

interface PlanningData {
  selection: PlanningSelectionState;
  astrogation: AstrogationPlanningState;
  ordnance: OrdnancePlanningState;
  combat: CombatPlanningState;
}

const createSelectionState = (): PlanningSelectionState => ({
  selectedShipId: null,
  hoverHex: null,
  lastSelectedHex: null,
});

const createAstrogationPlanningState = (): AstrogationPlanningState => ({
  burns: new Map(),
  overloads: new Map(),
  landingShips: new Set(),
  weakGravityChoices: new Map(),
  acknowledgedShips: new Set(),
});

const createOrdnancePlanningState = (): OrdnancePlanningState => ({
  torpedoAimingActive: false,
  torpedoAccel: null,
  torpedoAccelSteps: null,
  queuedOrdnanceLaunches: [],
  acknowledgedOrdnanceShips: new Set(),
});

const createCombatPlanningState = (): CombatPlanningState => ({
  combatTargetId: null,
  combatTargetType: null,
  combatAttackerIds: [],
  combatAttackStrength: null,
  queuedAttacks: [],
});

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
  combatTargetType: CombatTargetType;
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

export type PlanningPhase = 'astrogation' | 'ordnance' | 'combat';

export interface PlanningStore extends PlanningState {
  readonly revisionSignal: Signal<number>;
  setSelectedShipId: (shipId: string | null) => void;
  selectShip: (shipId: string, lastSelectedHex?: string | null) => void;
  clearShipPlanning: (shipId: string) => void;
  enterPhase: (phase: PlanningPhase, selectedShipId?: string | null) => void;
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
  planningStore: PlanningStore,
  key: K,
  value: PlanningStore[K],
): void => {
  Object.defineProperty(planningStore, key, {
    enumerable: false,
    configurable: false,
    writable: false,
    value,
  });
};

const definePlanningAlias = <K extends keyof PlanningState>(
  planningStore: PlanningStore,
  key: K,
  get: () => PlanningState[K],
  set: (next: PlanningState[K]) => void,
): void => {
  Object.defineProperty(planningStore, key, {
    enumerable: true,
    configurable: false,
    get,
    set,
  });
};

export const createPlanningStore = (): PlanningStore => {
  const planningStore = {} as PlanningStore;
  const data: PlanningData = {
    selection: createSelectionState(),
    astrogation: createAstrogationPlanningState(),
    ordnance: createOrdnancePlanningState(),
    combat: createCombatPlanningState(),
  };

  const notifyPlanningChanged = (): void => {
    planningStore.revisionSignal.update((n) => n + 1);
  };

  definePlanningAlias(
    planningStore,
    'selectedShipId',
    () => data.selection.selectedShipId,
    (next) => {
      data.selection.selectedShipId = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'hoverHex',
    () => data.selection.hoverHex,
    (next) => {
      data.selection.hoverHex = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'lastSelectedHex',
    () => data.selection.lastSelectedHex,
    (next) => {
      data.selection.lastSelectedHex = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'burns',
    () => data.astrogation.burns,
    (next) => {
      data.astrogation.burns = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'overloads',
    () => data.astrogation.overloads,
    (next) => {
      data.astrogation.overloads = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'landingShips',
    () => data.astrogation.landingShips,
    (next) => {
      data.astrogation.landingShips = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'weakGravityChoices',
    () => data.astrogation.weakGravityChoices,
    (next) => {
      data.astrogation.weakGravityChoices = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'acknowledgedShips',
    () => data.astrogation.acknowledgedShips,
    (next) => {
      data.astrogation.acknowledgedShips = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'torpedoAimingActive',
    () => data.ordnance.torpedoAimingActive,
    (next) => {
      data.ordnance.torpedoAimingActive = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'torpedoAccel',
    () => data.ordnance.torpedoAccel,
    (next) => {
      data.ordnance.torpedoAccel = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'torpedoAccelSteps',
    () => data.ordnance.torpedoAccelSteps,
    (next) => {
      data.ordnance.torpedoAccelSteps = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'queuedOrdnanceLaunches',
    () => data.ordnance.queuedOrdnanceLaunches,
    (next) => {
      data.ordnance.queuedOrdnanceLaunches = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'acknowledgedOrdnanceShips',
    () => data.ordnance.acknowledgedOrdnanceShips,
    (next) => {
      data.ordnance.acknowledgedOrdnanceShips = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'combatTargetId',
    () => data.combat.combatTargetId,
    (next) => {
      data.combat.combatTargetId = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'combatTargetType',
    () => data.combat.combatTargetType,
    (next) => {
      data.combat.combatTargetType = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'combatAttackerIds',
    () => data.combat.combatAttackerIds,
    (next) => {
      data.combat.combatAttackerIds = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'combatAttackStrength',
    () => data.combat.combatAttackStrength,
    (next) => {
      data.combat.combatAttackStrength = next;
    },
  );
  definePlanningAlias(
    planningStore,
    'queuedAttacks',
    () => data.combat.queuedAttacks,
    (next) => {
      data.combat.queuedAttacks = next;
    },
  );

  defineHiddenPlanningMember(planningStore, 'revisionSignal', signal(0));
  defineHiddenPlanningMember(
    planningStore,
    'setSelectedShipId',
    (shipId: string | null): void => {
      if (data.selection.selectedShipId === shipId) {
        return;
      }
      data.selection.selectedShipId = shipId;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'selectShip',
    (shipId: string, lastSelectedHex?: string | null): void => {
      data.selection.selectedShipId = shipId;

      if (lastSelectedHex !== undefined) {
        data.selection.lastSelectedHex = lastSelectedHex;
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'clearShipPlanning',
    (shipId: string): void => {
      data.astrogation.burns.delete(shipId);
      data.astrogation.overloads.delete(shipId);
      data.astrogation.landingShips.delete(shipId);
      data.astrogation.weakGravityChoices.delete(shipId);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'enterPhase',
    (phase: PlanningPhase, selectedShipId: string | null = null): void => {
      data.selection.selectedShipId = selectedShipId;
      data.astrogation = createAstrogationPlanningState();
      data.ordnance = createOrdnancePlanningState();
      data.combat = createCombatPlanningState();

      switch (phase) {
        case 'astrogation':
          data.selection.lastSelectedHex = null;
          break;
        case 'ordnance':
          break;
        case 'combat':
          break;
        default: {
          const _exhaustive: never = phase;
          void _exhaustive;
          return;
        }
      }

      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'resetAstrogationPlanning',
    (): void => {
      planningStore.enterPhase('astrogation', null);
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipBurn',
    (shipId: string, burn: number | null, clearOverload = false): void => {
      data.astrogation.burns.set(shipId, burn);

      if (clearOverload) {
        data.astrogation.overloads.delete(shipId);
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipOverload',
    (shipId: string, direction: number | null): void => {
      data.astrogation.overloads.set(shipId, direction);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipLanding',
    (shipId: string, landing: boolean): void => {
      if (landing) {
        data.astrogation.landingShips.add(shipId);
      } else {
        data.astrogation.landingShips.delete(shipId);
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setShipWeakGravityChoices',
    (shipId: string, choices: Record<string, boolean>): void => {
      data.astrogation.weakGravityChoices.set(shipId, choices);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'applyCombatPlanUpdate',
    (plan: CombatTargetPlan, selectedShipId?: string): void => {
      data.combat.combatTargetId = plan.combatTargetId;
      data.combat.combatTargetType = plan.combatTargetType;
      data.combat.combatAttackerIds = [...plan.combatAttackerIds];
      data.combat.combatAttackStrength = plan.combatAttackStrength;

      if (selectedShipId !== undefined) {
        data.selection.selectedShipId = selectedShipId;
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'clearCombatSelectionState',
    (): void => {
      data.combat.combatTargetId = null;
      data.combat.combatTargetType = null;
      data.combat.combatAttackerIds = [];
      data.combat.combatAttackStrength = null;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(planningStore, 'resetCombatPlanning', (): void => {
    data.combat = createCombatPlanningState();
    notifyPlanningChanged();
  });
  defineHiddenPlanningMember(
    planningStore,
    'queueCombatAttack',
    (attack: CombatAttack): number => {
      data.combat.queuedAttacks.push(attack);
      notifyPlanningChanged();
      return data.combat.queuedAttacks.length;
    },
  );
  defineHiddenPlanningMember(planningStore, 'popQueuedAttack', (): number => {
    data.combat.queuedAttacks.pop();
    notifyPlanningChanged();
    return data.combat.queuedAttacks.length;
  });
  defineHiddenPlanningMember(
    planningStore,
    'takeQueuedAttacks',
    (): CombatAttack[] => {
      const attacks = [...data.combat.queuedAttacks];
      data.combat.queuedAttacks = [];
      notifyPlanningChanged();
      return attacks;
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setCombatAttackStrength',
    (strength: number | null): void => {
      data.combat.combatAttackStrength = strength;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setTorpedoAimingActive',
    (active: boolean): void => {
      data.ordnance.torpedoAimingActive = active;

      if (!active) {
        data.ordnance.torpedoAccel = null;
        data.ordnance.torpedoAccelSteps = null;
      }
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setTorpedoAcceleration',
    (direction: number | null, steps: 1 | 2 | null): void => {
      data.ordnance.torpedoAccel = direction;
      data.ordnance.torpedoAccelSteps = steps;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'clearTorpedoAcceleration',
    (): void => {
      data.ordnance.torpedoAccel = null;
      data.ordnance.torpedoAccelSteps = null;
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'acknowledgeShip',
    (shipId: string): void => {
      data.astrogation.acknowledgedShips.add(shipId);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'queueOrdnanceLaunch',
    (launch: OrdnanceLaunch): void => {
      data.ordnance.queuedOrdnanceLaunches.push(launch);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'acknowledgeOrdnanceShip',
    (shipId: string): void => {
      data.ordnance.acknowledgedOrdnanceShips.add(shipId);
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'takeQueuedOrdnanceLaunches',
    (): OrdnanceLaunch[] => {
      const launches = [...data.ordnance.queuedOrdnanceLaunches];
      data.ordnance.queuedOrdnanceLaunches = [];
      notifyPlanningChanged();
      return launches;
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'resetOrdnancePlanning',
    (): void => {
      data.ordnance = createOrdnancePlanningState();
      notifyPlanningChanged();
    },
  );
  defineHiddenPlanningMember(
    planningStore,
    'setHoverHex',
    (hex: HexCoord | null): void => {
      data.selection.hoverHex = hex;
      notifyPlanningChanged();
    },
  );

  return planningStore;
};
