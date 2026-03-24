import type {
  AstrogationOrder,
  GameState,
  Ship,
} from '../../shared/types/domain';
import type { PlanningState } from './planning';

export interface ShipFate {
  id: string;
  name: string;
  type: string;
  status: 'survived' | 'destroyed' | 'captured';
  owner: number;
}

export interface GameOverStats {
  playerId: number;
  turns: number;
  myShipsAlive: number;
  myShipsTotal: number;
  enemyShipsAlive: number;
  enemyShipsTotal: number;
  myShipsDestroyed: number;
  enemyShipsDestroyed: number;
  myFuelSpent: number;
  enemyFuelSpent: number;
  basesDestroyed: number;
  ordnanceInFlight: number;
  shipFates: ShipFate[];
}

export interface HudViewModel {
  turn: number;
  phase: GameState['phase'];
  isMyTurn: boolean;
  myShips: Ship[];
  selectedId: string | null;
  fuel: number;
  maxFuel: number;
  hasBurns: boolean;
  cargoFree: number;
  cargoMax: number;
  objective: string;
  canOverload: boolean;
  matchVelocityState: OrdnanceActionState;
  canEmplaceBase: boolean;
  fleetStatus: string;
  selectedShipLanded: boolean;
  selectedShipDisabled: boolean;
  selectedShipHasBurn: boolean;
  allShipsHaveBurns: boolean;
  multipleShipsAlive: boolean;
  speed: number;
  fuelToStop: number;
  launchMineState: OrdnanceActionState;
  launchTorpedoState: OrdnanceActionState;
  launchNukeState: OrdnanceActionState;
}

export interface OrdnanceActionState {
  visible: boolean;
  disabled: boolean;
  title: string;
}

export interface MatchVelocityPlan {
  targetShipId: string;
  burn: number;
  overload: number | null;
}

export type PlanningSnapshot = Pick<
  PlanningState,
  'selectedShipId' | 'burns' | 'overloads' | 'weakGravityChoices'
>;

export type BuildAstrogationOrders = (
  state: GameState,
  playerId: number,
  planning: PlanningSnapshot,
) => AstrogationOrder[];

export type DeriveHudViewModel = (
  state: GameState,
  playerId: number,
  planning: PlanningSnapshot,
) => HudViewModel;
