// Ship type definitions
export interface ShipStats {
  name: string;
  combat: number;
  defensiveOnly: boolean; // "D" suffix — can only counterattack
  fuel: number;
  cargo: number;
  cost: number;
  canOverload: boolean;   // Warships can burn 2 fuel for 2-hex acceleration
}

export const SHIP_STATS: Record<string, ShipStats> = {
  transport:   { name: 'Transport',   combat: 1,  defensiveOnly: true,  fuel: 10, cargo: 50, cost: 10,  canOverload: false },
  packet:      { name: 'Packet',      combat: 2,  defensiveOnly: false, fuel: 10, cargo: 50, cost: 20,  canOverload: false },
  tanker:      { name: 'Tanker',      combat: 1,  defensiveOnly: true,  fuel: 50, cargo: 0,  cost: 10,  canOverload: false },
  liner:       { name: 'Liner',       combat: 2,  defensiveOnly: true,  fuel: 10, cargo: 0,  cost: 50,  canOverload: false },
  corvette:    { name: 'Corvette',    combat: 2,  defensiveOnly: false, fuel: 20, cargo: 5,  cost: 40,  canOverload: true },
  corsair:     { name: 'Corsair',     combat: 4,  defensiveOnly: false, fuel: 20, cargo: 10, cost: 80,  canOverload: true },
  frigate:     { name: 'Frigate',     combat: 8,  defensiveOnly: false, fuel: 20, cargo: 40, cost: 150, canOverload: true },
  dreadnaught: { name: 'Dreadnaught', combat: 15, defensiveOnly: false, fuel: 15, cargo: 50, cost: 600, canOverload: true },
  torch:       { name: 'Torch',       combat: 8,  defensiveOnly: false, fuel: Infinity, cargo: 10, cost: 400, canOverload: true },
};

// Ordnance definitions
export const ORDNANCE_MASS: Record<string, number> = {
  mine: 10,
  torpedo: 20,
};

export const ORDNANCE_LIFETIME = 5; // self-destruct after 5 turns

// Detection ranges
export const SHIP_DETECTION_RANGE = 3;
export const BASE_DETECTION_RANGE = 5;

// Animation durations (ms)
export const MOVEMENT_ANIM_DURATION = 2000;
export const CAMERA_LERP_SPEED = 5;

// Game constants
export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const CODE_LENGTH = 5;
