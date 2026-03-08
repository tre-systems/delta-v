import type { HexCoord, HexVec } from './hex';

// --- Game state ---

export type Phase = 'waiting' | 'astrogation' | 'ordnance' | 'movement' | 'combat' | 'resupply' | 'gameOver';

export interface GameState {
  gameId: string;
  scenario: string;
  turnNumber: number;
  phase: Phase;
  activePlayer: number; // 0 or 1
  ships: Ship[];
  ordnance: Ordnance[];
  players: [PlayerState, PlayerState];
  winner: number | null;
  winReason: string | null;
}

export interface Ship {
  id: string;
  type: string; // key into SHIP_STATS
  owner: number; // 0 or 1
  position: HexCoord;
  velocity: HexVec;
  fuel: number;
  cargoUsed: number; // mass of ordnance consumed from cargo capacity
  landed: boolean;
  destroyed: boolean;
  detected: boolean; // true if within detection range of opponent's ships/bases
  damage: {
    disabledTurns: number; // 0 = operational, cumulative >= 6 = eliminated
  };
}

export interface Ordnance {
  id: string;
  type: 'mine' | 'torpedo' | 'nuke';
  owner: number;
  position: HexCoord;
  velocity: HexVec;
  turnsRemaining: number; // self-destruct countdown (5 turns)
  destroyed: boolean;
}

export interface PlayerState {
  connected: boolean;
  ready: boolean;
  targetBody: string; // body name they must land on ('' if no landing target)
  homeBody: string; // body name for base ownership / resupply
  escapeWins: boolean; // true if this player wins by escaping the map
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
  gravityEffects: GravityEffect[];
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

export interface OrdnanceLaunch {
  shipId: string;
  ordnanceType: 'mine' | 'torpedo' | 'nuke';
  torpedoAccel?: number | null; // HEX_DIRECTIONS index for torpedo/nuke terminal guidance
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
}

export interface CombatResult {
  attackerIds: string[];
  targetId: string;
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
  type: 'asteroidHit' | 'crash' | 'mineDetonation' | 'torpedoHit' | 'nukeDetonation';
  shipId: string;
  hex: HexCoord;
  dieRoll: number;
  damageType: 'none' | 'disabled' | 'eliminated';
  disabledTurns: number;
  ordnanceId?: string;
}

// --- Network messages ---

export type C2S =
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | { type: 'skipOrdnance' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'skipCombat' }
  | { type: 'rematch' }
  | { type: 'ping'; t: number };

export type S2C =
  | { type: 'welcome'; playerId: number; code: string }
  | { type: 'matchFound' }
  | { type: 'gameStart'; state: GameState }
  | { type: 'movementResult'; movements: ShipMovement[]; ordnanceMovements: OrdnanceMovement[]; events: MovementEvent[]; state: GameState }
  | { type: 'combatResult'; results: CombatResult[]; state: GameState }
  | { type: 'stateUpdate'; state: GameState }
  | { type: 'gameOver'; winner: number; reason: string }
  | { type: 'rematchPending' }
  | { type: 'opponentDisconnected' }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

// --- Scenario ---

export interface ScenarioShip {
  type: string;
  position: HexCoord;
  velocity: HexVec;
  startLanded?: boolean; // default true — set false for ships in orbit
}

export interface ScenarioPlayer {
  ships: ScenarioShip[];
  targetBody: string;
  homeBody: string; // body name for base ownership / resupply
  escapeWins: boolean; // true if this player wins by escaping
}

export interface ScenarioDefinition {
  name: string;
  description: string;
  players: ScenarioPlayer[];
}
