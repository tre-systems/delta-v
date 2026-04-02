import type { FleetPurchase, OrdnanceType } from '../../shared/types/domain';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export type UIEvent =
  // Menu / lobby
  | { type: 'selectScenario'; scenario: string }
  | { type: 'startSinglePlayer'; scenario: string; difficulty: AIDifficulty }
  | { type: 'join'; code: string; playerToken?: string | null }
  // In-game actions
  | { type: 'undo' }
  | { type: 'skipShip' }
  | { type: 'confirm' }
  | { type: 'matchVelocity' }
  | { type: 'landFromOrbit' }
  | { type: 'launchOrdnance'; ordType: OrdnanceType }
  | { type: 'emplaceBase' }
  | { type: 'skipOrdnance' }
  | { type: 'attack' }
  | { type: 'fireAll' }
  | { type: 'skipCombat' }
  | { type: 'skipLogistics' }
  | { type: 'confirmTransfers' }
  | { type: 'fleetReady'; purchases: FleetPurchase[] }
  | { type: 'rematch' }
  | { type: 'replayMatchPrev' }
  | { type: 'replayMatchNext' }
  | { type: 'toggleReplay' }
  | { type: 'replayStart' }
  | { type: 'replayPrev' }
  | { type: 'replayNext' }
  | { type: 'replayEnd' }
  | { type: 'exit' }
  | { type: 'selectShip'; shipId: string }
  | { type: 'chat'; text: string }
  // Navigation
  | { type: 'backToMenu' };
