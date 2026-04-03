// Ship type definitions

// Warships: can overload drives, launch torpedoes, and initiate attacks (rulebook p.4-5).
export type WarshipType =
  | 'corvette'
  | 'corsair'
  | 'frigate'
  | 'dreadnaught'
  | 'torch';

// Civilian ships: defensive-only, cannot overload or launch torpedoes (rulebook p.4).
export type CivilianType = 'transport' | 'tanker' | 'liner';

// Ships that can carry and emplace an orbital base (rulebook p.7).
export type BaseCarrierType = 'transport' | 'packet';

// All ship types. Packet is neither warship nor civilian: it can attack
// but cannot overload (rulebook p.4). Orbital base is a stationary structure.
export type ShipType = WarshipType | CivilianType | 'packet' | 'orbitalBase';

// Runtime set of warship types, for guards that can't narrow via the type system alone.
export const WARSHIP_TYPES: ReadonlySet<ShipType> = new Set<WarshipType>([
  'corvette',
  'corsair',
  'frigate',
  'dreadnaught',
  'torch',
]);

// Runtime set of civilian ship types.
export const CIVILIAN_TYPES: ReadonlySet<ShipType> = new Set<CivilianType>([
  'transport',
  'tanker',
  'liner',
]);

// Ship types that can carry and emplace orbital bases.
export const BASE_CARRIER_TYPES: ReadonlySet<ShipType> =
  new Set<BaseCarrierType>(['transport', 'packet']);

export const isWarshipType = (type: ShipType): type is WarshipType =>
  WARSHIP_TYPES.has(type);

export const isCivilianType = (type: ShipType): type is CivilianType =>
  CIVILIAN_TYPES.has(type);

export const isBaseCarrierType = (type: ShipType): type is BaseCarrierType =>
  BASE_CARRIER_TYPES.has(type);

export interface ShipStats {
  // Display name shown in the UI.
  name: string;
  // Gun combat strength (rulebook p.1 ship table).
  combat: number;
  // If true, this ship has a "D" suffix on combat strength: it can only defend,
  // not initiate attacks or counterattack (rulebook p.1). Civilians only.
  defensiveOnly: boolean;
  // Maximum fuel capacity. Infinity for torch ships and orbital bases.
  fuel: number;
  // Maximum cargo capacity in mass units. Infinity for orbital bases.
  cargo: number;
  // Purchase cost in MegaCredits during fleet building (rulebook p.1 ship table).
  cost: number;
  // Whether the ship can use overloaded drive burns (2 fuel for 2-hex acceleration).
  // Warships only; civilians, packets, and orbital bases cannot (rulebook p.4).
  canOverload: boolean;
  // Whether the ship can launch torpedoes.
  // Warships and orbital bases only (rulebook p.6).
  canLaunchTorpedoes: boolean;
  // Whether the ship can operate (fire guns, launch ordnance, resupply) at D1 damage.
  // Orbital bases only (rulebook p.6).
  operatesAtD1: boolean;
  // Whether the ship can fire guns at any damage level.
  // Dreadnaughts only (rulebook p.6).
  operatesWhileDisabled: boolean;
  // Whether the ship's fuel supply is sealed and cannot be transferred to other ships.
  // Torch ships only (rulebook p.8).
  fuelSealed: boolean;
}

export const SHIP_STATS: Readonly<Record<ShipType, Readonly<ShipStats>>> = {
  transport: {
    name: 'Transport',
    combat: 1,
    defensiveOnly: true,
    fuel: 10,
    cargo: 50,
    cost: 10,
    canOverload: false,
    canLaunchTorpedoes: false,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  packet: {
    name: 'Packet',
    combat: 2,
    defensiveOnly: false,
    fuel: 10,
    cargo: 50,
    cost: 20,
    canOverload: false,
    canLaunchTorpedoes: false,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  tanker: {
    name: 'Tanker',
    combat: 1,
    defensiveOnly: true,
    fuel: 50,
    cargo: 0,
    cost: 10,
    canOverload: false,
    canLaunchTorpedoes: false,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  liner: {
    name: 'Liner',
    combat: 2,
    defensiveOnly: true,
    fuel: 10,
    cargo: 0,
    cost: 50,
    canOverload: false,
    canLaunchTorpedoes: false,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  corvette: {
    name: 'Corvette',
    combat: 2,
    defensiveOnly: false,
    fuel: 20,
    cargo: 5,
    cost: 40,
    canOverload: true,
    canLaunchTorpedoes: true,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  corsair: {
    name: 'Corsair',
    combat: 4,
    defensiveOnly: false,
    fuel: 20,
    cargo: 10,
    cost: 80,
    canOverload: true,
    canLaunchTorpedoes: true,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  frigate: {
    name: 'Frigate',
    combat: 8,
    defensiveOnly: false,
    fuel: 20,
    cargo: 40,
    cost: 150,
    canOverload: true,
    canLaunchTorpedoes: true,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
  dreadnaught: {
    name: 'Dreadnaught',
    combat: 15,
    defensiveOnly: false,
    fuel: 15,
    cargo: 50,
    cost: 600,
    canOverload: true,
    canLaunchTorpedoes: true,
    operatesAtD1: false,
    operatesWhileDisabled: true,
    fuelSealed: false,
  },
  torch: {
    name: 'Torch',
    combat: 8,
    defensiveOnly: false,
    fuel: Infinity,
    cargo: 10,
    cost: 400,
    canOverload: true,
    canLaunchTorpedoes: true,
    operatesAtD1: false,
    operatesWhileDisabled: false,
    fuelSealed: true,
  },
  orbitalBase: {
    name: 'Orbital Base',
    combat: 16,
    defensiveOnly: false,
    fuel: Infinity,
    cargo: Infinity,
    cost: 1000,
    canOverload: false,
    canLaunchTorpedoes: true,
    operatesAtD1: true,
    operatesWhileDisabled: false,
    fuelSealed: false,
  },
};

// Ordnance definitions

// The three ordnance types that ships can launch (rulebook p.5-6).
export type OrdnanceType = 'mine' | 'torpedo' | 'nuke';

// Mass in cargo units per ordnance type (rulebook p.9 equipment table).
export const ORDNANCE_MASS: Readonly<Record<OrdnanceType, number>> = {
  mine: 10,
  torpedo: 20,
  nuke: 20,
};

// Cargo mass to carry an orbital base (rulebook p.7).
export const ORBITAL_BASE_MASS = 50;

// Ordnance self-destructs after this many turns (rulebook p.5-6).
export const ORDNANCE_LIFETIME = 5;

// Cumulative disabled turns that destroy a ship (rulebook p.6: D6 = destroyed).
export const DAMAGE_ELIMINATION_THRESHOLD = 6;

// Ship & orbital base detector range in hexes (rulebook p.8).
export const SHIP_DETECTION_RANGE = 3;
// Planetary base detector range in hexes (rulebook p.8).
export const BASE_DETECTION_RANGE = 5;

// Combat modifiers
// Relative velocity above this threshold applies die roll penalty (rulebook p.5).
export const VELOCITY_MODIFIER_THRESHOLD = 2;
// Planetary defense fires at fixed 2:1 odds (rulebook p.8).
export const BASE_COMBAT_ODDS = '2:1';
// Anti-nuke fire uses 2:1 odds (rulebook p.6).
export const ANTI_NUKE_ODDS = '2:1';
// Planetary defense range: the gravity hex directly above the base (rulebook p.8).
export const BASE_FIRE_RANGE = 1;

// Movement costs
// Fuel cost for a single burn (one hex of acceleration, rulebook p.2).
export const BURN_FUEL_COST = 1;
// Total fuel cost for an overload maneuver (two hexes of acceleration, rulebook p.4).
export const OVERLOAD_TOTAL_FUEL_COST = 2;
// Ship must be moving at this speed to land via orbit (rulebook p.4).
export const LANDING_SPEED_REQUIRED = 1;

// Animation durations (ms)
export const MOVEMENT_ANIM_DURATION = 2000;
export const CAMERA_LERP_SPEED = 5;

// Game constants
export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
export const TURN_TIMEOUT_MS = 2 * 60 * 1000;
export const CODE_LENGTH = 5;
