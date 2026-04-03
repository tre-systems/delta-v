import type { HexCoord } from '../hex';
import type {
  FleetPurchaseOption,
  ScenarioRules,
  ScenarioShip,
} from './domain';

// Re-export the derived key union so consumers can import from the types barrel.
export type { ScenarioKey } from '../scenario-definitions';

// --- Scenario configuration ---

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
  tags?: string[];
  players: ScenarioPlayer[];
  rules?: ScenarioRules;
  startingPlayer?: 0 | 1;
  startingCredits?: number | [number, number];
  availableFleetPurchases?: FleetPurchaseOption[];
}
