import type { HexCoord, HexVec } from './hex';

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

export interface GameState {
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

export interface Ship {
  id: string;
  type: string;
  owner: number;
  position: HexCoord;
  lastMovementPath?: HexCoord[];
  velocity: HexVec;
  fuel: number;
  cargoUsed: number;
  nukesLaunchedSinceResupply?: number;
  resuppliedThisTurn: boolean;
  landed: boolean;
  destroyed: boolean;
  detected: boolean;
  captured?: boolean;
  surrendered?: boolean;
  heroismAvailable?: boolean;
  overloadUsed?: boolean;
  carryingOrbitalBase?: boolean;
  emplaced?: boolean;
  hasFugitives?: boolean;
  identityRevealed?: boolean;
  pendingGravityEffects?: GravityEffect[];

  damage: {
    disabledTurns: number;
  };
}

export interface Ordnance {
  id: string;
  type: 'mine' | 'torpedo' | 'nuke';
  owner: number;
  sourceShipId?: string | null;
  position: HexCoord;
  velocity: HexVec;
  turnsRemaining: number;
  destroyed: boolean;
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

// --- Network messages ---

export interface OrbitalBaseEmplacement {
  shipId: string;
}

export interface FleetPurchase {
  shipType: string;
}

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
  reinforcements?: Reinforcement[];
  fleetConversion?: FleetConversion;
}

export interface TransferOrder {
  sourceShipId: string;
  targetShipId: string;
  transferType: 'fuel' | 'cargo';
  amount: number;
}

export type C2S =
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'astrogation'; orders: AstrogationOrder[] }
  | { type: 'surrender'; shipIds: string[] }
  | { type: 'ordnance'; launches: OrdnanceLaunch[] }
  | {
      type: 'emplaceBase';
      emplacements: OrbitalBaseEmplacement[];
    }
  | { type: 'skipOrdnance' }
  | { type: 'beginCombat' }
  | { type: 'combat'; attacks: CombatAttack[] }
  | { type: 'skipCombat' }
  | { type: 'logistics'; transfers: TransferOrder[] }
  | { type: 'skipLogistics' }
  | { type: 'rematch' }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };

export type S2C =
  | {
      type: 'welcome';
      playerId: number;
      code: string;
      playerToken: string;
    }
  | { type: 'matchFound' }
  | { type: 'gameStart'; state: GameState }
  | {
      type: 'movementResult';
      movements: ShipMovement[];
      ordnanceMovements: OrdnanceMovement[];
      events: MovementEvent[];
      state: GameState;
    }
  | {
      type: 'combatResult';
      results: CombatResult[];
      state: GameState;
    }
  | { type: 'stateUpdate'; state: GameState }
  | { type: 'gameOver'; winner: number; reason: string }
  | { type: 'rematchPending' }
  | { type: 'opponentDisconnected' }
  | {
      type: 'chat';
      playerId: number;
      text: string;
    }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

// --- Scenario ---

export interface ScenarioShip {
  type: string;
  position: HexCoord;
  velocity: HexVec;
  startLanded?: boolean;
  startInOrbit?: boolean;
}

export interface ScenarioPlayer {
  ships: ScenarioShip[];
  targetBody: string;
  homeBody: string;
  bases?: HexCoord[];
  escapeWins: boolean;
  hiddenIdentity?: boolean;
}

export interface ScenarioDefinition {
  name: string;
  description: string;
  players: ScenarioPlayer[];
  rules?: ScenarioRules;
  startingPlayer?: 0 | 1;
  startingCredits?: number | [number, number];
  availableShipTypes?: string[];
}
