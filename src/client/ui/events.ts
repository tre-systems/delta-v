import type { AIDifficulty } from '../../shared/ai/types';
import type { FleetPurchase, OrdnanceType } from '../../shared/types/domain';

export type { AIDifficulty } from '../../shared/ai/types';

export type UIEvent =
  // Menu / lobby
  | { type: 'browseScenarios' }
  | { type: 'quickMatch' }
  | { type: 'cancelQuickMatch' }
  | { type: 'acceptOfficialBotMatch' }
  | { type: 'selectScenario'; scenario: string }
  | {
      type: 'startSinglePlayer';
      scenario: string;
      difficulty: AIDifficulty;
      /** Replays the guided first-flight tutorial for this local match. */
      training?: true;
    }
  | { type: 'join'; code: string; playerToken?: string | null }
  // In-game actions
  | { type: 'undo' }
  | { type: 'skipShip' }
  | { type: 'confirm' }
  | { type: 'landFromOrbit' }
  | { type: 'selectFleet' }
  | { type: 'launchOrdnance'; ordType: OrdnanceType }
  | { type: 'emplaceBase' }
  | { type: 'skipOrdnance' }
  | { type: 'skipOrdnanceShip' }
  | { type: 'confirmOrdnance' }
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
  | { type: 'replayPlayPause' }
  | { type: 'replayStart' }
  | { type: 'replayPrev' }
  | { type: 'replayNext' }
  | { type: 'replayEnd' }
  | { type: 'replayCycleSpeed' }
  | { type: 'exitReplay' }
  | { type: 'exit' }
  | { type: 'selectShip'; shipId: string }
  | { type: 'chat'; text: string };
