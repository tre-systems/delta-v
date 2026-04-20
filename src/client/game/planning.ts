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

export type ShipSelectionView = Pick<
  PlanningState,
  'selectedShipId' | 'lastSelectedHex'
>;

export type PlanningSelectionView = ShipSelectionView &
  Pick<PlanningState, 'hoverHex'>;

export type AstrogationPlanningView = Pick<
  PlanningState,
  | 'burns'
  | 'overloads'
  | 'landingShips'
  | 'weakGravityChoices'
  | 'acknowledgedShips'
>;

export type OrdnancePlanningView = Pick<
  PlanningState,
  | 'torpedoAimingActive'
  | 'torpedoAccel'
  | 'torpedoAccelSteps'
  | 'queuedOrdnanceLaunches'
  | 'acknowledgedOrdnanceShips'
>;

export type CombatPlanningView = Pick<
  PlanningState,
  | 'combatTargetId'
  | 'combatTargetType'
  | 'combatAttackerIds'
  | 'combatAttackStrength'
  | 'queuedAttacks'
>;

export type AstrogationPlanningSnapshot = ShipSelectionView &
  AstrogationPlanningView;
export type OrdnancePlanningSnapshot = ShipSelectionView &
  Pick<
    OrdnancePlanningView,
    'torpedoAimingActive' | 'torpedoAccel' | 'torpedoAccelSteps'
  >;
export type CombatPlanningSnapshot = Pick<ShipSelectionView, 'selectedShipId'> &
  CombatPlanningView;
export type HudPlanningSnapshot = Pick<ShipSelectionView, 'selectedShipId'> &
  AstrogationPlanningView &
  Pick<
    OrdnancePlanningView,
    | 'torpedoAimingActive'
    | 'torpedoAccelSteps'
    | 'queuedOrdnanceLaunches'
    | 'acknowledgedOrdnanceShips'
  > &
  Pick<
    CombatPlanningView,
    'queuedAttacks' | 'combatTargetId' | 'combatTargetType'
  >;
export type KeyboardPlanningSnapshot = Pick<
  ShipSelectionView,
  'selectedShipId'
> &
  Pick<AstrogationPlanningView, 'acknowledgedShips'> &
  Pick<
    OrdnancePlanningView,
    | 'torpedoAimingActive'
    | 'torpedoAccel'
    | 'torpedoAccelSteps'
    | 'acknowledgedOrdnanceShips'
  > &
  Pick<CombatPlanningView, 'combatTargetId' | 'queuedAttacks'>;
export type InteractivePlanningSnapshot = PlanningSelectionView &
  AstrogationPlanningView &
  OrdnancePlanningView &
  CombatPlanningView;

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

export type PlanningSelectionStore = PlanningSelectionView &
  Pick<PlanningStore, 'setSelectedShipId' | 'selectShip' | 'setHoverHex'>;

export type AstrogationPlanningStore = AstrogationPlanningView &
  Pick<
    PlanningStore,
    | 'enterPhase'
    | 'clearShipPlanning'
    | 'resetAstrogationPlanning'
    | 'setShipBurn'
    | 'setShipOverload'
    | 'setShipLanding'
    | 'setShipWeakGravityChoices'
    | 'acknowledgeShip'
  >;

export type OrdnancePlanningStore = OrdnancePlanningView &
  Pick<
    PlanningStore,
    | 'enterPhase'
    | 'setTorpedoAimingActive'
    | 'setTorpedoAcceleration'
    | 'clearTorpedoAcceleration'
    | 'queueOrdnanceLaunch'
    | 'acknowledgeOrdnanceShip'
    | 'takeQueuedOrdnanceLaunches'
    | 'resetOrdnancePlanning'
  >;

export type CombatPlanningStore = CombatPlanningView &
  Pick<
    PlanningStore,
    | 'enterPhase'
    | 'applyCombatPlanUpdate'
    | 'clearCombatSelectionState'
    | 'resetCombatPlanning'
    | 'queueCombatAttack'
    | 'popQueuedAttack'
    | 'takeQueuedAttacks'
    | 'setCombatAttackStrength'
  >;

export const createPlanningStore = (): PlanningStore => {
  const revisionSignal = signal(0);

  const notifyPlanningChanged = (): void => {
    revisionSignal.update((n) => n + 1);
  };

  const planningStore: PlanningStore = {
    revisionSignal,
    ...createSelectionState(),
    ...createAstrogationPlanningState(),
    ...createOrdnancePlanningState(),
    ...createCombatPlanningState(),
    setSelectedShipId: (shipId: string | null): void => {
      if (planningStore.selectedShipId === shipId) {
        return;
      }
      planningStore.selectedShipId = shipId;
      notifyPlanningChanged();
    },
    selectShip: (shipId: string, lastSelectedHex?: string | null): void => {
      planningStore.selectedShipId = shipId;

      if (lastSelectedHex !== undefined) {
        planningStore.lastSelectedHex = lastSelectedHex;
      }
      notifyPlanningChanged();
    },
    clearShipPlanning: (shipId: string): void => {
      planningStore.burns.delete(shipId);
      planningStore.overloads.delete(shipId);
      planningStore.landingShips.delete(shipId);
      planningStore.weakGravityChoices.delete(shipId);
      notifyPlanningChanged();
    },
    enterPhase: (
      phase: PlanningPhase,
      selectedShipId: string | null = null,
    ): void => {
      planningStore.selectedShipId = selectedShipId;
      resetAstrogationState();
      resetOrdnanceState();
      resetCombatState();

      switch (phase) {
        case 'astrogation':
          planningStore.lastSelectedHex = null;
          break;
        case 'ordnance':
        case 'combat':
          break;
        default: {
          const _exhaustive: never = phase;
          void _exhaustive;
        }
      }

      notifyPlanningChanged();
    },
    resetAstrogationPlanning: (): void => {
      planningStore.enterPhase('astrogation', null);
    },
    setShipBurn: (
      shipId: string,
      burn: number | null,
      clearOverload = false,
    ): void => {
      planningStore.burns.set(shipId, burn);

      if (clearOverload) {
        planningStore.overloads.delete(shipId);
      }
      notifyPlanningChanged();
    },
    setShipOverload: (shipId: string, direction: number | null): void => {
      planningStore.overloads.set(shipId, direction);
      notifyPlanningChanged();
    },
    setShipLanding: (shipId: string, landing: boolean): void => {
      if (landing) {
        planningStore.landingShips.add(shipId);
      } else {
        planningStore.landingShips.delete(shipId);
      }
      notifyPlanningChanged();
    },
    setShipWeakGravityChoices: (
      shipId: string,
      choices: Record<string, boolean>,
    ): void => {
      planningStore.weakGravityChoices.set(shipId, choices);
      notifyPlanningChanged();
    },
    applyCombatPlanUpdate: (
      plan: CombatTargetPlan,
      selectedShipId?: string,
    ): void => {
      planningStore.combatTargetId = plan.combatTargetId;
      planningStore.combatTargetType = plan.combatTargetType;
      planningStore.combatAttackerIds = [...plan.combatAttackerIds];
      planningStore.combatAttackStrength = plan.combatAttackStrength;

      if (selectedShipId !== undefined) {
        planningStore.selectedShipId = selectedShipId;
      }
      notifyPlanningChanged();
    },
    clearCombatSelectionState: (): void => {
      planningStore.combatTargetId = null;
      planningStore.combatTargetType = null;
      planningStore.combatAttackerIds = [];
      planningStore.combatAttackStrength = null;
      notifyPlanningChanged();
    },
    resetCombatPlanning: (): void => {
      resetCombatState();
      notifyPlanningChanged();
    },
    queueCombatAttack: (attack: CombatAttack): number => {
      planningStore.queuedAttacks.push(attack);
      notifyPlanningChanged();
      return planningStore.queuedAttacks.length;
    },
    popQueuedAttack: (): number => {
      planningStore.queuedAttacks.pop();
      notifyPlanningChanged();
      return planningStore.queuedAttacks.length;
    },
    takeQueuedAttacks: (): CombatAttack[] => {
      const attacks = [...planningStore.queuedAttacks];
      planningStore.queuedAttacks = [];
      notifyPlanningChanged();
      return attacks;
    },
    setCombatAttackStrength: (strength: number | null): void => {
      planningStore.combatAttackStrength = strength;
      notifyPlanningChanged();
    },
    setTorpedoAimingActive: (active: boolean): void => {
      planningStore.torpedoAimingActive = active;

      if (!active) {
        planningStore.torpedoAccel = null;
        planningStore.torpedoAccelSteps = null;
      }
      notifyPlanningChanged();
    },
    setTorpedoAcceleration: (
      direction: number | null,
      steps: 1 | 2 | null,
    ): void => {
      planningStore.torpedoAccel = direction;
      planningStore.torpedoAccelSteps = steps;
      notifyPlanningChanged();
    },
    clearTorpedoAcceleration: (): void => {
      planningStore.torpedoAimingActive = false;
      planningStore.torpedoAccel = null;
      planningStore.torpedoAccelSteps = null;
      notifyPlanningChanged();
    },
    acknowledgeShip: (shipId: string): void => {
      planningStore.acknowledgedShips.add(shipId);
      notifyPlanningChanged();
    },
    queueOrdnanceLaunch: (launch: OrdnanceLaunch): void => {
      planningStore.queuedOrdnanceLaunches.push(launch);
      notifyPlanningChanged();
    },
    acknowledgeOrdnanceShip: (shipId: string): void => {
      planningStore.acknowledgedOrdnanceShips.add(shipId);
      notifyPlanningChanged();
    },
    takeQueuedOrdnanceLaunches: (): OrdnanceLaunch[] => {
      const launches = [...planningStore.queuedOrdnanceLaunches];
      planningStore.queuedOrdnanceLaunches = [];
      notifyPlanningChanged();
      return launches;
    },
    resetOrdnancePlanning: (): void => {
      resetOrdnanceState();
      notifyPlanningChanged();
    },
    setHoverHex: (hex: HexCoord | null): void => {
      planningStore.hoverHex = hex;
      notifyPlanningChanged();
    },
  };

  function resetAstrogationState(): void {
    Object.assign(planningStore, createAstrogationPlanningState());
  }

  function resetOrdnanceState(): void {
    Object.assign(planningStore, createOrdnancePlanningState());
  }

  function resetCombatState(): void {
    Object.assign(planningStore, createCombatPlanningState());
  }

  return planningStore;
};
