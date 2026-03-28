import {
  type AIDifficulty,
  buildAIFleetPurchases as buildSharedAIFleetPurchases,
} from '../../shared/ai';
import { processFleetReady } from '../../shared/engine/game-engine';
import type {
  FleetPurchase,
  FleetPurchaseOption,
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { ScenarioDefinition } from '../../shared/types/scenario';

export type LocalFleetReadyResult =
  | { kind: 'error'; error: string }
  | { kind: 'success'; state: GameState; aiError?: string };

export interface FleetReadyDeps {
  processReady?: typeof processFleetReady;
  buildAIPurchases?: typeof buildAIFleetPurchases;
}

export const buildAIFleetPurchases = (
  state: GameState,
  playerId: PlayerId,
  availableFleetPurchases: FleetPurchaseOption[] | undefined,
  difficulty: AIDifficulty,
): FleetPurchase[] => {
  return buildSharedAIFleetPurchases(
    state,
    playerId,
    difficulty,
    availableFleetPurchases,
  );
};

export const resolveLocalFleetReady = (
  state: GameState,
  playerId: PlayerId,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
  scenario: ScenarioDefinition,
  difficulty: AIDifficulty,
  deps: FleetReadyDeps = {},
): LocalFleetReadyResult => {
  const processReady = deps.processReady ?? processFleetReady;
  const availableFleetPurchases =
    state.scenarioRules.availableFleetPurchases ??
    scenario.availableFleetPurchases;

  const playerResult = processReady(state, playerId, purchases, map);

  if ('error' in playerResult) {
    return { kind: 'error', error: playerResult.error.message };
  }

  const buildAIPurchases = deps.buildAIPurchases ?? buildAIFleetPurchases;

  const aiPlayerId: PlayerId = playerId === 0 ? 1 : 0;
  const aiPurchases = buildAIPurchases(
    playerResult.state,
    aiPlayerId,
    playerResult.state.scenarioRules.availableFleetPurchases ??
      availableFleetPurchases,
    difficulty,
  );

  const aiResult = processReady(
    playerResult.state,
    aiPlayerId,
    aiPurchases,
    map,
  );

  if ('error' in aiResult) {
    return {
      kind: 'success',
      state: playerResult.state,
      aiError: aiResult.error.message,
    };
  }

  return { kind: 'success', state: aiResult.state };
};
