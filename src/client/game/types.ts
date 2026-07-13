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
  ratingDelta?: number;
  trainingComplete?: boolean;
  shipFates: ShipFate[];
}

export interface HudViewModel {
  turn: number;
  phase: GameState['phase'];
  isMyTurn: boolean;
  /** True for the replay/watch-only viewer (playerId === -1). */
  isSpectator: boolean;
  /** Player whose turn it is — used for spectator-framed labels like "P1 ASTROGATION". */
  activePlayer: PlayerId;
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
  /** Body reached by the selected ship's legal landing course. */
  selectedShipLandingBody: string | null;
  selectedShipLandingSet: boolean;
  torpedoAimingActive: boolean;
  torpedoAccelSteps: 1 | 2 | null;
  allShipsAcknowledged: boolean;
  /** Orderable ships this turn (astrogation progress denominator). */
  orderableTotal: number;
  /** Orderable ships already ordered or auto-skipped (progress numerator). */
  orderableOrdered: number;
  /** Ships currently in the fleet-steer group (0 = single-select mode). */
  fleetGroupSize: number;
  allOrdnanceShipsAcknowledged: boolean;
  queuedOrdnanceType: string | null;
  queuedLaunchCount: number;
  /** Batch-combat attacks queued locally before FIRE ALL (not single-ship resolution). */
  queuedCombatAttackCount: number;
  /** Short label for the focused combat target (HUD status line). */
  combatTargetLabel: string | null;
  /** True when even a natural 6 cannot damage the focused target. */
  combatAttackImpossible: boolean;
  multipleShipsAlive: boolean;
  speed: number;
  fuelToStop: number;
  /** Compact preview of the selected ship's currently plotted course. */
  courseSummary: string | null;
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
