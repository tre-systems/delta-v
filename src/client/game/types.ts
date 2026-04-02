import type { ShipType } from '../../shared/constants';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  Ship,
} from '../../shared/types/domain';
import type { PlanningState } from './planning';

export interface ShipFate {
  id: string;
  name: string;
  type: ShipType;
  status: 'survived' | 'destroyed' | 'captured';
  owner: PlayerId;
  deathCause?: string;
  killedBy?: string;
}

export interface GameOverStats {
  playerId: PlayerId;
  scenario: string;
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
  canEmplaceBase: boolean;
  fleetStatus: string;
  selectedShipLanded: boolean;
  selectedShipDisabled: boolean;
  selectedShipHasBurn: boolean;
  selectedShipInOrbit: boolean;
  selectedShipLandingSet: boolean;
  allShipsAcknowledged: boolean;
  allOrdnanceShipsAcknowledged: boolean;
  queuedOrdnanceType: string | null;
  queuedLaunchCount: number;
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

export type PlanningSnapshot = Pick<
  PlanningState,
  | 'selectedShipId'
  | 'burns'
  | 'overloads'
  | 'landingShips'
  | 'weakGravityChoices'
  | 'acknowledgedShips'
  | 'acknowledgedOrdnanceShips'
  | 'queuedOrdnanceLaunches'
>;

export type BuildAstrogationOrders = (
  state: GameState,
  playerId: PlayerId,
  planning: PlanningSnapshot,
) => AstrogationOrder[];

export type DeriveHudViewModel = (
  state: GameState,
  playerId: PlayerId,
  planning: PlanningSnapshot,
) => HudViewModel;
