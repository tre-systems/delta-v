import type { OrdnanceType, ShipType } from '../constants';
import type { HexCoord, HexKey, HexVec } from '../hex';
import type { CombatTargetKey, GameId, OrdnanceId, ShipId } from '../ids';
import type { ScenarioKey } from '../scenario-definitions';

// --- Result type ---

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// --- Primitive ID types ---

export type PlayerId = 0 | 1;

// Re-export OrdnanceType from constants (where it lives alongside ShipType).
export type { OrdnanceType } from '../constants';

// --- Win condition ---

// Non-null when the game has ended. Replaces the old `winner` + `winReason` pair.
export type GameOutcome = { winner: PlayerId; reason: string };

// --- Game state ---

// Game phases (adapted from rulebook p.2 sequence of play).
// Movement is resolved inline after astrogation/ordnance; resupply is automatic on landing at a base.
export type Phase =
  | 'waiting'
  | 'fleetBuilding'
  | 'astrogation'
  | 'ordnance'
  | 'logistics'
  | 'combat'
  | 'gameOver';

// Valid phase transitions. Each key maps to the set of phases it can transition to.
// `gameOver` is reachable from any in-game phase (via victory checks) and is terminal.
//
// waiting ──► fleetBuilding ──► astrogation ◄─────────────────────┐
//                                   │                              │
//                                   ├──► ordnance ──┐              │
//                                   │               ▼              │
//                                   ├────────────► combat ──► logistics ──► advanceTurn
//                                   │
//                                   └────────────► logistics
//
// Any in-game phase ──► gameOver
export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  waiting: ['fleetBuilding', 'astrogation'],
  fleetBuilding: ['astrogation', 'gameOver'],
  astrogation: ['ordnance', 'logistics', 'combat', 'astrogation', 'gameOver'],
  ordnance: ['logistics', 'combat', 'astrogation', 'gameOver'],
  logistics: ['astrogation', 'gameOver'],
  combat: ['logistics', 'astrogation', 'gameOver'],
  gameOver: [],
} as const;

// Type-level successor phases for a given phase.
export type PhaseSuccessor<P extends Phase> =
  (typeof PHASE_TRANSITIONS)[P][number];

export enum ErrorCode {
  INVALID_PHASE = 'INVALID_PHASE',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  INVALID_PLAYER = 'INVALID_PLAYER',
  INVALID_SHIP = 'INVALID_SHIP',
  INVALID_TARGET = 'INVALID_TARGET',
  INVALID_SELECTION = 'INVALID_SELECTION',
  INVALID_INPUT = 'INVALID_INPUT',
  MALFORMED_JSON = 'MALFORMED_JSON',
  UNKNOWN_ACTION_TYPE = 'UNKNOWN_ACTION_TYPE',
  CHAT_TOO_LONG = 'CHAT_TOO_LONG',
  NOT_ALLOWED = 'NOT_ALLOWED',
  RESOURCE_LIMIT = 'RESOURCE_LIMIT',
  STATE_CONFLICT = 'STATE_CONFLICT',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_FULL = 'ROOM_FULL',
  GAME_IN_PROGRESS = 'GAME_IN_PROGRESS',
  GAME_COMPLETED = 'GAME_COMPLETED',
}

export interface EngineError {
  code: ErrorCode;
  message: string;
}

export const CURRENT_GAME_STATE_SCHEMA_VERSION = 1;

export interface GameState {
  schemaVersion?: number;
  gameId: GameId;
  scenario: ScenarioKey;
  scenarioRules: ScenarioRules;
  escapeMoralVictoryAchieved: boolean;
  turnNumber: number;
  phase: Phase;
  activePlayer: PlayerId;
  ships: Ship[];
  ordnance: Ordnance[];
  pendingAstrogationOrders: AstrogationOrder[] | null;
  pendingAsteroidHazards: AsteroidHazard[];
  destroyedAsteroids: HexKey[];
  destroyedBases: HexKey[];
  // Tracks which targets have been attacked during the current combat
  // phase (sequential combat). Cleared by advanceTurn.
  combatTargetedThisPhase?: CombatTargetKey[];
  players: [PlayerState, PlayerState];
  outcome: GameOutcome | null;
}

export type ShipLifecycle = 'active' | 'landed' | 'destroyed';
export type ShipControl = 'own' | 'captured' | 'surrendered';

export interface PositionedEntity {
  position: HexCoord;
  velocity: HexVec;
}

export interface Ship extends PositionedEntity {
  id: ShipId;
  type: ShipType;
  owner: PlayerId;
  originalOwner: PlayerId;
  lastMovementPath?: HexCoord[];
  fuel: number;
  cargoUsed: number;
  // Tracks launched nukes since the last resupply/maintenance stop.
  // Non-warships may launch only one nuke between resupplies.
  nukesLaunchedSinceResupply: number;
  // True during a turn in which the ship resupplied; prevents firing/ordnance (rulebook p.8).
  resuppliedThisTurn: boolean;
  lifecycle: ShipLifecycle;
  control: ShipControl;
  detected: boolean;
  // True once the ship has earned heroism and gains +1 on gun attacks (rulebook p.8).
  heroismAvailable: boolean;
  // Warships get one overload maneuver between maintenance stopovers (rulebook p.4).
  overloadUsed: boolean;
  // Only transports and packets (BaseCarrierType) may carry/emplace orbital bases (rulebook p.7).
  baseStatus?: 'carryingBase' | 'emplaced';
  identity?: { hasFugitives: boolean; revealed: boolean };
  // Colonists / passengers (rescue scenarios); share cargo capacity with ordnance mass.
  passengersAboard?: number;
  pendingGravityEffects?: GravityEffect[];
  // Hex direction (0..5) of the most recent burn. Used client-side to
  // orient the ship icon opposite the last thrust; absent until the
  // ship has performed its first burn.
  lastBurnDirection?: number;
  deathCause?: string;
  killedBy?: ShipId | null; // ship ID or label of the attacker, null for environmental deaths

  // True when this ship has already attacked during the current
  // sequential combat phase. Cleared by advanceTurn.
  firedThisPhase?: boolean;

  // Damage state. Ships recover 1 disabled turn per game turn (rulebook p.6).
  // At DAMAGE_ELIMINATION_THRESHOLD cumulative turns, the ship is destroyed.
  damage: {
    disabledTurns: number;
  };
}

// --- Ship lifecycle narrowing ---

// A ship that is still in play (moving, fighting, etc.).
export type ActiveShip = Ship & { lifecycle: 'active' };
// A ship that has landed on a celestial body.
export type LandedShip = Ship & { lifecycle: 'landed' };
// A destroyed ship -- deathCause is always present; killedBy identifies the attacker (absent for environmental deaths).
export type DestroyedShip = Ship & {
  lifecycle: 'destroyed';
  deathCause: string;
};

export const isActive = (ship: Ship): ship is ActiveShip =>
  ship.lifecycle === 'active';
export const isLanded = (ship: Ship): ship is LandedShip =>
  ship.lifecycle === 'landed';
export const isDestroyed = (ship: Ship): ship is DestroyedShip =>
  ship.lifecycle === 'destroyed';

export type OrdnanceLifecycle = 'active' | 'destroyed';

export interface Ordnance extends PositionedEntity {
  id: OrdnanceId;
  type: OrdnanceType;
  owner: PlayerId;
  sourceShipId: ShipId | null;
  turnsRemaining: number;
  lifecycle: OrdnanceLifecycle;
  pendingGravityEffects?: GravityEffect[];
}

export interface PlayerState {
  connected: boolean;
  ready: boolean;
  targetBody: string;
  homeBody: string;
  bases: HexKey[];
  escapeWins: boolean;
  credits?: number;
  visitedBodies?: string[];
  totalFuelSpent?: number;
}

// --- Movement ---

export interface AstrogationOrder {
  shipId: ShipId;
  burn: number | null;
  overload: number | null;
  weakGravityChoices?: Record<HexKey, boolean>;
  // When true, the ship attempts to land from orbit
  // rather than continuing normal trajectory.
  land?: boolean;
}

interface CourseResultBase {
  destination: HexCoord;
  path: HexCoord[];
  newVelocity: HexVec;
  fuelSpent: number;
  gravityEffects: GravityEffect[];
  enteredGravityEffects: GravityEffect[];
}

export type CourseResult = CourseResultBase &
  (
    | { outcome: 'crash'; crashBody: string; crashHex: HexCoord }
    | { outcome: 'landing'; landedAt: string }
    | { outcome: 'normal' }
  );

export interface GravityInfo {
  direction: number;
  bodyName: string;
  strength: 'full' | 'weak';
}

export interface GravityEffect extends GravityInfo {
  hex: HexCoord;
  ignored: boolean;
}

export interface AsteroidHazard {
  shipId: ShipId;
  hex: HexCoord;
}

export interface OrdnanceLaunch {
  shipId: ShipId;
  ordnanceType: OrdnanceType;
  torpedoAccel: number | null;
  torpedoAccelSteps: 1 | 2 | null;
}

export interface PathSegment {
  from: HexCoord;
  to: HexCoord;
  path: HexCoord[];
}

export interface OrdnanceMovement extends PathSegment {
  ordnanceId: OrdnanceId;
  owner?: PlayerId;
  ordnanceType?: OrdnanceType;
  detonated: boolean;
}

interface ShipMovementBase extends PathSegment {
  shipId: ShipId;
  newVelocity: HexVec;
  fuelSpent: number;
  gravityEffects: GravityEffect[];
  // True when the ship had a queued burn/overload that was silently
  // suppressed because the ship was disabled at resolution time. Lets
  // the client surface a "burn cancelled" log line instead of leaving
  // the player wondering why the ship drifted instead of burning.
  burnCancelledByDisable?: boolean;
}

export type ShipMovement = ShipMovementBase &
  (
    | { outcome: 'crash' }
    | { outcome: 'landing'; landedAt: string }
    | { outcome: 'normal' }
  );

// --- Map ---

export interface MapHex {
  terrain: 'space' | 'asteroid' | 'planetSurface' | 'sunSurface';

  gravity?: GravityInfo;

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
  hexes: Map<HexKey, MapHex>;
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
  attackerIds: ShipId[];
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
  attackStrength: number | null;
}

export type ShipTargetCombatAttack = CombatAttack & {
  targetType: 'ship';
  targetId: ShipId;
};

export type OrdnanceTargetCombatAttack = CombatAttack & {
  targetType: 'ordnance';
  targetId: OrdnanceId;
};

export type DamageType = 'none' | 'disabled' | 'eliminated';
export type AttackType = 'gun' | 'baseDefense' | 'asteroidHazard' | 'antiNuke';

export interface CombatResult {
  attackerIds: ShipId[];
  targetId: ShipId | OrdnanceId;
  targetType: 'ship' | 'ordnance';
  attackType: AttackType;
  odds: string;
  attackStrength: number;
  defendStrength: number;
  rangeMod: number;
  velocityMod: number;
  dieRoll: number;
  modifiedRoll: number;
  damageType: DamageType;
  disabledTurns: number;
  counterattack: CombatResult | null;
}

export type ShipTargetCombatResult = CombatResult & {
  targetType: 'ship';
  targetId: ShipId;
};

export type OrdnanceTargetCombatResult = CombatResult & {
  targetType: 'ordnance';
  targetId: OrdnanceId;
};

export const isShipTargetCombatResult = (
  result: CombatResult,
): result is ShipTargetCombatResult => result.targetType === 'ship';

export const isOrdnanceTargetCombatResult = (
  result: CombatResult,
): result is OrdnanceTargetCombatResult => result.targetType === 'ordnance';

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
  shipId: ShipId;
  hex: HexCoord;
  dieRoll: number;
  damageType: 'none' | 'disabled' | 'eliminated' | 'captured';
  disabledTurns: number;
  ordnanceId?: OrdnanceId;
  capturedBy?: ShipId;
}

// --- Actions ---

export interface OrbitalBaseEmplacement {
  shipId: ShipId;
}

export type PurchasableShipType = Exclude<ShipType, 'orbitalBase'>;

export type FleetPurchaseOption = PurchasableShipType | 'orbitalBaseCargo';

export interface ShipFleetPurchase {
  kind: 'ship';
  shipType: PurchasableShipType;
}

export interface OrbitalBaseCargoPurchase {
  kind: 'orbitalBaseCargo';
}

export type FleetPurchase = ShipFleetPurchase | OrbitalBaseCargoPurchase;

export const isShipFleetPurchase = (
  purchase: FleetPurchase,
): purchase is ShipFleetPurchase => purchase.kind === 'ship';

export const isOrbitalBaseCargoPurchase = (
  purchase: FleetPurchase,
): purchase is OrbitalBaseCargoPurchase => purchase.kind === 'orbitalBaseCargo';

export const getFleetPurchaseOption = (
  purchase: FleetPurchase,
): FleetPurchaseOption =>
  isShipFleetPurchase(purchase) ? purchase.shipType : 'orbitalBaseCargo';

export interface TransferOrder {
  sourceShipId: ShipId;
  targetShipId: ShipId;
  transferType: 'fuel' | 'cargo' | 'passengers';
  amount: number;
}

// --- Scenario rules (embedded in GameState) ---

export interface Reinforcement {
  turn: number;
  playerId: PlayerId;
  ships: ScenarioShip[];
}

export interface FleetConversion {
  turn: number;
  fromPlayer: PlayerId;
  toPlayer: PlayerId;
  shipTypes?: ShipType[];
}

export interface ScenarioRules {
  allowedOrdnanceTypes?: OrdnanceType[];
  availableFleetPurchases?: FleetPurchaseOption[];
  planetaryDefenseEnabled?: boolean;
  hiddenIdentityInspection?: boolean;
  escapeEdge?: 'any' | 'north';
  combatDisabled?: boolean;
  checkpointBodies?: string[];
  sharedBases?: string[];
  logisticsEnabled?: boolean;
  // Enable passenger transfers in logistics (same geometry rules as fuel/cargo).
  passengerRescueEnabled?: boolean;
  // Landing on targetBody only wins if the landed ship carries at least one passenger.
  targetWinRequiresPassengers?: boolean;
  reinforcements?: Reinforcement[];
  fleetConversion?: FleetConversion;
  // Scenario-scoped AI scoring overrides. Only the listed fields are
  // replaced; everything else falls through to the base difficulty
  // config. Used by duel to reduce combat-closing pressure so the AI
  // plays range-managed engagements instead of rushing. Typed as a
  // loose record here because the concrete AIDifficultyConfig lives in
  // the ai module and domain.ts must not import from there.
  aiConfigOverrides?: Readonly<Record<string, unknown>>;
}

// ScenarioShip is needed here because Reinforcement
// references it. The full scenario config types
// (ScenarioDefinition, ScenarioPlayer) live in scenario.ts.
export interface ScenarioShip {
  type: ShipType;
  position: HexCoord;
  velocity: HexVec;
  startLanded?: boolean;
  startInOrbit?: boolean;
  initialPassengers?: number;
}
