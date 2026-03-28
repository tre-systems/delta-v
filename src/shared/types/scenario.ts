import type { HexCoord } from '../hex';
import type {
  FleetPurchaseOption,
  ScenarioRules,
  ScenarioShip,
} from './domain';

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
