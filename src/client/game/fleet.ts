import type { AIDifficulty } from '../../shared/ai';
import { SHIP_STATS } from '../../shared/constants';
import { processFleetReady } from '../../shared/engine/game-engine';
import type { FleetPurchase, GameState, ScenarioDefinition, SolarSystemMap } from '../../shared/types';

const AI_FLEET_PRIORITIES: Record<AIDifficulty, string[]> = {
  easy: ['corvette', 'corsair', 'packet'],
  normal: ['corsair', 'frigate', 'corvette'],
  hard: ['frigate', 'corsair', 'corvette'],
};

export type LocalFleetReadyResult =
  | { kind: 'error'; error: string }
  | { kind: 'success'; state: GameState; aiError?: string };

export interface FleetReadyDeps {
  processReady?: typeof processFleetReady;
  buildAIPurchases?: typeof buildAIFleetPurchases;
}

export const buildAIFleetPurchases = (
  credits: number,
  availableShipTypes: string[] | undefined,
  difficulty: AIDifficulty,
): FleetPurchase[] => {
  const available = availableShipTypes ?? Object.keys(SHIP_STATS).filter((shipType) => shipType !== 'orbitalBase');
  const purchases: FleetPurchase[] = [];
  let remaining = credits;

  for (const shipType of AI_FLEET_PRIORITIES[difficulty]) {
    if (!available.includes(shipType)) continue;
    const cost = SHIP_STATS[shipType]?.cost ?? Infinity;
    while (remaining >= cost) {
      purchases.push({ shipType });
      remaining -= cost;
    }
  }

  return purchases;
};

export const resolveLocalFleetReady = (
  state: GameState,
  playerId: number,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
  scenario: ScenarioDefinition,
  difficulty: AIDifficulty,
  deps: FleetReadyDeps = {},
): LocalFleetReadyResult => {
  const processReady = deps.processReady ?? processFleetReady;
  const playerResult = processReady(state, playerId, purchases, map, scenario.availableShipTypes);
  if ('error' in playerResult) {
    return { kind: 'error', error: playerResult.error };
  }

  const buildAIPurchases = deps.buildAIPurchases ?? buildAIFleetPurchases;
  const aiPurchases = buildAIPurchases(
    playerResult.state.players[1 - playerId].credits ?? 0,
    scenario.availableShipTypes,
    difficulty,
  );
  const aiResult = processReady(playerResult.state, 1 - playerId, aiPurchases, map, scenario.availableShipTypes);
  if ('error' in aiResult) {
    return {
      kind: 'success',
      state: playerResult.state,
      aiError: aiResult.error,
    };
  }

  return { kind: 'success', state: aiResult.state };
};
