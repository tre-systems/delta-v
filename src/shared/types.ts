import type { HexCoord, HexVec } from './hex';

// --- Game state ---

export type Phase = 'waiting' | 'astrogation' | 'movement' | 'gameOver';

export interface GameState {
  gameId: string;
  scenario: string;
  turnNumber: number;
  phase: Phase;
  activePlayer: number; // 0 or 1
  ships: Ship[];
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
  landed: boolean;
}

export interface PlayerState {
  connected: boolean;
  ready: boolean;
  targetBody: string; // body name they must land on
}

// --- Movement ---

export interface AstrogationOrder {
  shipId: string;
  burn: number | null; // HEX_DIRECTIONS index (0-5) or null
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

// --- Network messages ---

export type C2S =
  | { type: 'join'; code: string }
  | { type: 'ready' }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'rematch' }
  | { type: 'ping'; t: number };

export type S2C =
  | { type: 'welcome'; playerId: number; code: string }
  | { type: 'matchFound' }
  | { type: 'gameStart'; state: GameState }
  | { type: 'movementResult'; movements: ShipMovement[]; state: GameState }
  | { type: 'stateUpdate'; state: GameState }
  | { type: 'gameOver'; winner: number; reason: string }
  | { type: 'opponentDisconnected' }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

// --- Scenario ---

export interface ScenarioShip {
  type: string;
  position: HexCoord;
  velocity: HexVec;
}

export interface ScenarioPlayer {
  ships: ScenarioShip[];
  targetBody: string;
}

export interface ScenarioDefinition {
  name: string;
  players: ScenarioPlayer[];
}
