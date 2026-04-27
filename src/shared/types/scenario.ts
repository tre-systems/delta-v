import type { HexCoord } from '../hex';
import type {
  FleetPurchaseOption,
  ScenarioRules,
  ScenarioShip,
} from './domain';

// Re-export the derived key union so consumers can import from the types barrel.
export type { ScenarioKey } from '../scenario-definitions';

// --- Scenario configuration ---

/** Optional lobby card metadata (not authoritative rules text). */
export interface ScenarioLobbyMeta {
  beginnerFriendly?: boolean;
  hook?: string;
  length?: 'short' | 'medium' | 'long';
  complexity?: 'low' | 'medium' | 'high';
  mechanics?: string[];
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
  tags?: string[];
  lobbyMeta?: ScenarioLobbyMeta;
  players: ScenarioPlayer[];
  rules?: ScenarioRules;
  startingPlayer?: 0 | 1;
  startingCredits?: number | [number, number];
  availableFleetPurchases?: FleetPurchaseOption[];
}
