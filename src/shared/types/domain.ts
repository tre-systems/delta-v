import type { HexCoord, HexVec } from '../hex';

// --- Game state ---

export type Phase =
  | 'waiting'
  | 'fleetBuilding'
  | 'astrogation'
  | 'ordnance'
  | 'movement'
  | 'logistics'
  | 'combat'
  | 'resupply'
  | 'gameOver';

export enum ErrorCode {
  INVALID_PHASE = 'INVALID_PHASE',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  INVALID_PLAYER = 'INVALID_PLAYER',
  INVALID_SHIP = 'INVALID_SHIP',
  INVALID_TARGET = 'INVALID_TARGET',
  INVALID_SELECTION = 'INVALID_SELECTION',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_ALLOWED = 'NOT_ALLOWED',
  RESOURCE_LIMIT = 'RESOURCE_LIMIT',
  STATE_CONFLICT = 'STATE_CONFLICT',
}

export interface EngineError {
  code: ErrorCode;
  message: string;
}

export const CURRENT_GAME_STATE_SCHEMA_VERSION = 1;

export interface GameState {
  schemaVersion?: number;
  gameId: string;
  scenario: string;
  scenarioRules: ScenarioRules;
  escapeMoralVictoryAchieved: boolean;
  turnNumber: number;
  phase: Phase;
  activePlayer: number;
  ships: Ship[];
  ordnance: Ordnance[];
  pendingAstrogationOrders: AstrogationOrder[] | null;
  pendingAsteroidHazards: AsteroidHazard[];
  destroyedAsteroids: string[];
  destroyedBases: string[];
  players: [PlayerState, PlayerState];
  winner: number | null;
  winReason: string | null;
}

export type ShipLifecycle = 'active' | 'landed' | 'destroyed';
export type ShipControl = 'own' | 'captured' | 'surrendered';

export interface Ship {
  id: string;
  type: string;
  owner: number;
  originalOwner: number;
  position: HexCoord;
  lastMovementPath?: HexCoord[];
  velocity: HexVec;
  fuel: number;
  cargoUsed: number;
  nukesLaunchedSinceResupply: number;
  resuppliedThisTurn: boolean;
  lifecycle: ShipLifecycle;
  control: ShipControl;
  detected: boolean;
  heroismAvailable: boolean;
  overloadUsed: boolean;
  baseStatus?: 'carryingBase' | 'emplaced';
  identity?: { hasFugitives: boolean; revealed: boolean };
  /** Colonists / passengers (rescue scenarios); share cargo capacity with ordnance mass. */
  passengersAboard?: number;
  pendingGravityEffects?: GravityEffect[];
  deathCause?: string;
  killedBy?: string; // ship ID or label of the attacker

  damage: {
    disabledTurns: number;
  };
}

export type OrdnanceLifecycle = 'active' | 'destroyed';

export interface Ordnance {
  id: string;
  type: 'mine' | 'torpedo' | 'nuke';
  owner: number;
  sourceShipId?: string | null;
  position: HexCoord;
  velocity: HexVec;
  turnsRemaining: number;
  lifecycle: OrdnanceLifecycle;
  pendingGravityEffects?: GravityEffect[];
}

export interface PlayerState {
  connected: boolean;
  ready: boolean;
  targetBody: string;
  homeBody: string;
  bases: string[];
  escapeWins: boolean;
  credits?: number;
  visitedBodies?: string[];
  totalFuelSpent?: number;
}

// --- Movement ---

export interface AstrogationOrder {
  shipId: string;
  burn: number | null;
  overload?: number | null;
  weakGravityChoices?: Record<string, boolean>;
}

export interface CourseResult {
  destination: HexCoord;
  path: HexCoord[];
  newVelocity: HexVec;
  fuelSpent: number;
  gravityEffects: GravityEffect[];
  enteredGravityEffects: GravityEffect[];
  crashed: boolean;
  crashBody: string | null;
  landedAt: string | null;
}

export interface GravityEffect {
  hex: HexCoord;
  direction: number;
  bodyName: string;
  strength: 'full' | 'weak';
  ignored: boolean;
}

export interface AsteroidHazard {
  shipId: string;
  hex: HexCoord;
}

export interface OrdnanceLaunch {
  shipId: string;
  ordnanceType: 'mine' | 'torpedo' | 'nuke';
  torpedoAccel?: number | null;
  torpedoAccelSteps?: 1 | 2 | null;
}

export interface OrdnanceMovement {
  ordnanceId: string;
  from: HexCoord;
  to: HexCoord;
  path: HexCoord[];
  detonated: boolean;
}

export interface ShipMovement {
  shipId: string;
  from: HexCoord;
  to: HexCoord;
  path: HexCoord[];
  newVelocity: HexVec;
  fuelSpent: number;
  gravityEffects: GravityEffect[];
  crashed: boolean;
  landedAt: string | null;
}

// --- Map ---

export interface MapHex {
  terrain: 'space' | 'asteroid' | 'planetSurface' | 'sunSurface';

  gravity?: {
    direction: number;
    strength: 'full' | 'weak';
    bodyName: string;
  };

  base?: {
    name: string;
    bodyName: string;
  };

  body?: {
    name: string;
    destructive: boolean;
  };
}

export interface CelestialBody {
  name: string;
  center: HexCoord;
  surfaceRadius: number;
  color: string;
  renderRadius: number;
}

export interface SolarSystemMap {
  hexes: Map<string, MapHex>;
  bodies: CelestialBody[];
  gravityBodies?: Set<string>;
  bounds: {
    minQ: number;
    maxQ: number;
    minR: number;
    maxR: number;
  };
}

// --- Combat ---

export interface CombatAttack {
  attackerIds: string[];
  targetId: string;
  targetType?: 'ship' | 'ordnance';
  attackStrength?: number | null;
}

export interface CombatResult {
  attackerIds: string[];
  targetId: string;
  targetType: 'ship' | 'ordnance';
  attackType: 'gun' | 'baseDefense' | 'asteroidHazard' | 'antiNuke';
  odds: string;
  attackStrength: number;
  defendStrength: number;
  rangeMod: number;
  velocityMod: number;
  dieRoll: number;
  modifiedRoll: number;
  damageType: 'none' | 'disabled' | 'eliminated';
  disabledTurns: number;
  counterattack: CombatResult | null;
}

// --- Movement events ---

export interface MovementEvent {
  type:
    | 'asteroidHit'
    | 'crash'
    | 'ramming'
    | 'mineDetonation'
    | 'torpedoHit'
    | 'nukeDetonation'
    | 'capture';
  shipId: string;
  hex: HexCoord;
  dieRoll: number;
  damageType: 'none' | 'disabled' | 'eliminated' | 'captured';
  disabledTurns: number;
  ordnanceId?: string;
  capturedBy?: string;
}

// --- Actions ---

export interface OrbitalBaseEmplacement {
  shipId: string;
}

export interface FleetPurchase {
  shipType: string;
}

export interface TransferOrder {
  sourceShipId: string;
  targetShipId: string;
  transferType: 'fuel' | 'cargo' | 'passengers';
  amount: number;
}

// --- Scenario rules (embedded in GameState) ---

export interface Reinforcement {
  turn: number;
  playerId: number;
  ships: ScenarioShip[];
}

export interface FleetConversion {
  turn: number;
  fromPlayer: number;
  toPlayer: number;
  shipTypes?: string[];
}

export interface ScenarioRules {
  allowedOrdnanceTypes?: Array<Ordnance['type']>;
  planetaryDefenseEnabled?: boolean;
  hiddenIdentityInspection?: boolean;
  escapeEdge?: 'any' | 'north';
  combatDisabled?: boolean;
  checkpointBodies?: string[];
  sharedBases?: string[];
  logisticsEnabled?: boolean;
  /** Enable passenger transfers in logistics (same geometry rules as fuel/cargo). */
  passengerRescueEnabled?: boolean;
  /** Landing on targetBody only wins if the landed ship carries at least one passenger. */
  targetWinRequiresPassengers?: boolean;
  reinforcements?: Reinforcement[];
  fleetConversion?: FleetConversion;
}

// ScenarioShip is needed here because Reinforcement
// references it. The full scenario config types
// (ScenarioDefinition, ScenarioPlayer) live in scenario.ts.
export interface ScenarioShip {
  type: string;
  position: HexCoord;
  velocity: HexVec;
  startLanded?: boolean;
  startInOrbit?: boolean;
  initialPassengers?: number;
}
