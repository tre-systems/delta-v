import type { HexCoord, HexVec } from './hex';

// --- Game state ---

export type Phase =
  | 'waiting'
  | 'fleetBuilding'
  | 'astrogation'
  | 'ordnance'
  | 'movement'
  | 'combat'
  | 'resupply'
  | 'gameOver';

export interface GameState {
  gameId: string;
  scenario: string;
  scenarioRules: ScenarioRules;
  escapeMoralVictoryAchieved: boolean;
  turnNumber: number;
  phase: Phase;
  activePlayer: number; // 0 or 1
  ships: Ship[];
  ordnance: Ordnance[];
  pendingAstrogationOrders: AstrogationOrder[] | null;
  pendingAsteroidHazards: AsteroidHazard[];
  destroyedAsteroids: string[]; // hexKey[] for asteroids removed by nukes
  destroyedBases: string[]; // hexKey[] for bases destroyed by nuke detonation
  players: [PlayerState, PlayerState];
  winner: number | null;
  winReason: string | null;
}

export interface Ship {
  id: string;
  type: string; // key into SHIP_STATS
  owner: number; // 0 or 1
  position: HexCoord;
  lastMovementPath?: HexCoord[]; // path flown on the active player's most recent movement phase
  velocity: HexVec;
  fuel: number;
  cargoUsed: number; // mass of ordnance consumed from cargo capacity
  nukesLaunchedSinceResupply?: number;
  resuppliedThisTurn: boolean; // true if ship resupplied this turn (cannot fire/launch)
  landed: boolean;
  destroyed: boolean;
  detected: boolean; // true if within detection range of opponent's ships/bases
  captured?: boolean; // true if captured by enemy — cannot fire/attack until base resupply
  heroismAvailable?: boolean; // heroic ships add +1 to gun combat rolls whenever they attack
  overloadUsed?: boolean; // true if ship has used its one overload allowance since last maintenance
  carryingOrbitalBase?: boolean; // transport/packet carrying an unemplaced orbital base
  emplaced?: boolean; // true for orbital bases that have been placed (stationary, cannot move)
  hasFugitives?: boolean; // Escape scenario: true if this transport carries the fugitives (hidden from opponent)
  identityRevealed?: boolean; // hidden-identity scenarios: true once inspection reveals this ship's role
  pendingGravityEffects?: GravityEffect[]; // gravity entered last turn that applies this turn
  damage: {
    disabledTurns: number; // 0 = operational, cumulative >= 6 = eliminated
  };
}

export interface Ordnance {
  id: string;
  type: 'mine' | 'torpedo' | 'nuke';
  owner: number;
  sourceShipId?: string | null;
  position: HexCoord;
  velocity: HexVec;
  turnsRemaining: number; // self-destruct countdown (5 turns)
  destroyed: boolean;
  pendingGravityEffects?: GravityEffect[]; // gravity entered last turn that applies this turn
}

export interface PlayerState {
  connected: boolean;
  ready: boolean;
  targetBody: string; // body name they must land on ('' if no landing target)
  homeBody: string; // default home world / scenario identity
  bases: string[]; // hexKey[] for bases this player controls
  escapeWins: boolean; // true if this player wins by escaping the map
  credits?: number; // MegaCredits remaining for fleet-building scenarios
  visitedBodies?: string[]; // checkpoint body names visited (Grand Tour race)
  totalFuelSpent?: number; // cumulative fuel spent (race tiebreaker)
}

// --- Movement ---

export interface AstrogationOrder {
  shipId: string;
  burn: number | null; // HEX_DIRECTIONS index (0-5) or null
  overload?: number | null; // second burn direction for warships (costs 2 fuel total)
  weakGravityChoices?: Record<string, boolean>; // hexKey -> true to ignore weak gravity
}

export interface CourseResult {
  destination: HexCoord;
  path: HexCoord[];
  newVelocity: HexVec;
  fuelSpent: number;
  gravityEffects: GravityEffect[]; // gravity applied this turn from last turn's entries
  enteredGravityEffects: GravityEffect[]; // gravity entered this turn that applies next turn
  crashed: boolean;
  crashBody: string | null;
  landedAt: string | null; // body name if landed
}

export interface GravityEffect {
  hex: HexCoord;
  direction: number; // HEX_DIRECTIONS index
  bodyName: string;
  strength: 'full' | 'weak';
  ignored: boolean; // true if player chose to ignore weak gravity
}

export interface AsteroidHazard {
  shipId: string;
  hex: HexCoord;
}

export interface OrdnanceLaunch {
  shipId: string;
  ordnanceType: 'mine' | 'torpedo' | 'nuke';
  torpedoAccel?: number | null; // HEX_DIRECTIONS index for torpedo launch boost
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
    direction: number; // HEX_DIRECTIONS index
    strength: 'full' | 'weak';
    bodyName: string;
  };
  base?: {
    name: string;
    bodyName: string;
  };
  body?: {
    name: string;
    destructive: boolean; // true for Sol
  };
}

export interface CelestialBody {
  name: string;
  center: HexCoord;
  surfaceRadius: number;
  color: string;
  renderRadius: number; // pixel radius for rendering (relative to hex size)
}

export interface SolarSystemMap {
  hexes: Map<string, MapHex>;
  bodies: CelestialBody[];
  bounds: { minQ: number; maxQ: number; minR: number; maxR: number };
}

// --- Combat ---

export interface CombatAttack {
  attackerIds: string[];
  targetId: string;
  targetType?: 'ship' | 'ordnance';
  attackStrength?: number | null; // optional reduced-strength attack declaration
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

// --- Movement events (asteroid hazards, etc.) ---

export interface MovementEvent {
  type: 'asteroidHit' | 'crash' | 'ramming' | 'mineDetonation' | 'torpedoHit' | 'nukeDetonation' | 'capture';
  shipId: string;
  hex: HexCoord;
  dieRoll: number;
  damageType: 'none' | 'disabled' | 'eliminated' | 'captured';
  disabledTurns: number;
  ordnanceId?: string;
  capturedBy?: string; // id of the capturing ship
}

// --- Network messages ---

export interface OrbitalBaseEmplacement {
  shipId: string; // transport/packet carrying the base
}

export interface FleetPurchase {
  shipType: string; // key into SHIP_STATS
}

export interface ScenarioRules {
  allowedOrdnanceTypes?: Array<Ordnance['type']>;
  planetaryDefenseEnabled?: boolean;
  hiddenIdentityInspection?: boolean;
  escapeEdge?: 'any' | 'north';
  combatDisabled?: boolean; // skip gun/base-defense combat (asteroid hazards still resolve)
  checkpointBodies?: string[]; // body names that must be visited for race victory
  sharedBases?: string[]; // body names whose bases all players can use
}

export type C2S =
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | { type: 'emplaceBase'; emplacements: OrbitalBaseEmplacement[] }
  | { type: 'skipOrdnance' }
  | { type: 'beginCombat' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'skipCombat' }
  | { type: 'rematch' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };

export type S2C =
  | { type: 'welcome'; playerId: number; code: string; playerToken: string }
  | { type: 'matchFound' }
  | { type: 'gameStart'; state: GameState }
  | {
      type: 'movementResult';
      movements: ShipMovement[];
      ordnanceMovements: OrdnanceMovement[];
      events: MovementEvent[];
      state: GameState;
    }
  | { type: 'combatResult'; results: CombatResult[]; state: GameState }
  | { type: 'stateUpdate'; state: GameState }
  | { type: 'gameOver'; winner: number; reason: string }
  | { type: 'rematchPending' }
  | { type: 'opponentDisconnected' }
  | { type: 'chat'; playerId: number; text: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

// --- Scenario ---

export interface ScenarioShip {
  type: string;
  position: HexCoord;
  velocity: HexVec;
  startLanded?: boolean; // default true — set false for ships in orbit
  startInOrbit?: boolean; // queue the current gravity hex so orbit starts behave like an ongoing orbit
}

export interface ScenarioPlayer {
  ships: ScenarioShip[];
  targetBody: string;
  homeBody: string; // default home world / starting body
  bases?: HexCoord[]; // explicit controlled bases for scenarios that split a world's bases
  escapeWins: boolean; // true if this player wins by escaping
  hiddenIdentity?: boolean; // true if one ship carries hidden cargo (fugitives) — opponent doesn't know which
}

export interface ScenarioDefinition {
  name: string;
  description: string;
  players: ScenarioPlayer[];
  rules?: ScenarioRules;
  startingPlayer?: 0 | 1;
  startingCredits?: number | [number, number]; // per-player starting MegaCredits for fleet-building scenarios
  availableShipTypes?: string[]; // restricts purchasable ships (default: all non-orbital-base)
}
