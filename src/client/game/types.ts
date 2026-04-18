import type { ShipType } from '../../shared/constants';
import type {
  AstrogationOrder,
  GameState,
  PlayerId,
  Ship,
} from '../../shared/types/domain';
import type { AstrogationPlanningView, HudPlanningSnapshot } from './planning';

export interface ShipFate {
  id: string;
  name: string;
  type: ShipType;
  status: 'survived' | 'destroyed' | 'captured';
  owner: PlayerId | -1;
  deathCause?: string;
  killedBy?: string;
}

export interface GameOverStats {
  playerId: PlayerId | -1;
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
  emplaceBaseState: OrdnanceActionState;
  fleetStatus: string;
  /** Plain-language summary for `#fleetStatus` (visible text uses compact M/T/N). */
  fleetStatusAriaLabel: string;
  selectedShipLanded: boolean;
  selectedShipDisabled: boolean;
  selectedShipHasBurn: boolean;
  selectedShipInOrbit: boolean;
  selectedShipLandingSet: boolean;
  torpedoAimingActive: boolean;
  torpedoAccelSteps: 1 | 2 | null;
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

export type AstrogationOrdersPlanningSnapshot = Pick<
  AstrogationPlanningView,
  'burns' | 'overloads' | 'landingShips' | 'weakGravityChoices'
>;

export type BuildAstrogationOrders = (
  state: GameState,
  playerId: PlayerId | -1,
  planning: AstrogationOrdersPlanningSnapshot,
) => AstrogationOrder[];

export type DeriveHudViewModel = (
  state: GameState,
  playerId: PlayerId | -1,
  planning: HudPlanningSnapshot,
) => HudViewModel;
