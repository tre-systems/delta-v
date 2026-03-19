import type { FleetPurchase } from '../../shared/types';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export type UIEvent =
  // Menu / lobby
  | { type: 'selectScenario'; scenario: string }
  | { type: 'startSinglePlayer'; scenario: string; difficulty: AIDifficulty }
  | { type: 'join'; code: string; playerToken?: string | null }
  // In-game actions
  | { type: 'undo' }
  | { type: 'confirm' }
  | { type: 'launchOrdnance'; ordType: 'mine' | 'torpedo' | 'nuke' }
  | { type: 'emplaceBase' }
  | { type: 'skipOrdnance' }
  | { type: 'attack' }
  | { type: 'fireAll' }
  | { type: 'skipCombat' }
  | { type: 'skipLogistics' }
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'rematch' }
  | { type: 'exit' }
  | { type: 'selectShip'; shipId: string }
  | { type: 'chat'; text: string };
