// Ship type definitions

export interface ShipStats {
  name: string;
  combat: number;
  defensiveOnly: boolean;
  fuel: number;
  cargo: number;
  cost: number;
  canOverload: boolean;
}

export const SHIP_STATS: Record<string, ShipStats> = {
  transport: {
    name: 'Transport',
    combat: 1,
    defensiveOnly: true,
    fuel: 10,
    cargo: 50,
    cost: 10,
    canOverload: false,
  },
  packet: {
    name: 'Packet',
    combat: 2,
    defensiveOnly: false,
    fuel: 10,
    cargo: 50,
    cost: 20,
    canOverload: false,
  },
  tanker: {
    name: 'Tanker',
    combat: 1,
    defensiveOnly: true,
    fuel: 50,
    cargo: 0,
    cost: 10,
    canOverload: false,
  },
  liner: {
    name: 'Liner',
    combat: 2,
    defensiveOnly: true,
    fuel: 10,
    cargo: 0,
    cost: 50,
    canOverload: false,
  },
  corvette: {
    name: 'Corvette',
    combat: 2,
    defensiveOnly: false,
    fuel: 20,
    cargo: 5,
    cost: 40,
    canOverload: true,
  },
  corsair: {
    name: 'Corsair',
    combat: 4,
    defensiveOnly: false,
    fuel: 20,
    cargo: 10,
    cost: 80,
    canOverload: true,
  },
  frigate: {
    name: 'Frigate',
    combat: 8,
    defensiveOnly: false,
    fuel: 20,
    cargo: 40,
    cost: 150,
    canOverload: true,
  },
  dreadnaught: {
    name: 'Dreadnaught',
    combat: 15,
    defensiveOnly: false,
    fuel: 15,
    cargo: 50,
    cost: 600,
    canOverload: true,
  },
  torch: {
    name: 'Torch',
    combat: 8,
    defensiveOnly: false,
    fuel: Infinity,
    cargo: 10,
    cost: 400,
    canOverload: true,
  },
  orbitalBase: {
    name: 'Orbital Base',
    combat: 16,
    defensiveOnly: false,
    fuel: Infinity,
    cargo: Infinity,
    cost: 1000,
    canOverload: false,
  },
};

// Ordnance definitions

export const ORDNANCE_MASS: Record<string, number> = {
  mine: 10,
  torpedo: 20,
  nuke: 20,
};

// Cargo mass to carry an orbital base
export const ORBITAL_BASE_MASS = 50;

// Self-destruct after 5 turns
export const ORDNANCE_LIFETIME = 5;

// Damage thresholds
// Cumulative disabled turns that destroy a ship
export const DAMAGE_ELIMINATION_THRESHOLD = 6;

// Detection ranges
export const SHIP_DETECTION_RANGE = 3;
export const BASE_DETECTION_RANGE = 5;

// Combat modifiers
export const VELOCITY_MODIFIER_THRESHOLD = 2;
export const BASE_COMBAT_ODDS = '2:1';
export const ANTI_NUKE_ODDS = '2:1';
export const BASE_FIRE_RANGE = 1;

// Movement costs
export const BURN_FUEL_COST = 1;
export const OVERLOAD_TOTAL_FUEL_COST = 2;
export const LANDING_SPEED_REQUIRED = 1;

// Animation durations (ms)
export const MOVEMENT_ANIM_DURATION = 2000;
export const CAMERA_LERP_SPEED = 5;

// Game constants
export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
export const TURN_TIMEOUT_MS = 2 * 60 * 1000;
export const CODE_LENGTH = 5;
