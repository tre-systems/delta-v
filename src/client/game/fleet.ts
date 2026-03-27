import type { AIDifficulty } from '../../shared/ai';
import { SHIP_STATS } from '../../shared/constants';
import { processFleetReady } from '../../shared/engine/game-engine';
import type {
  FleetPurchase,
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { ScenarioDefinition } from '../../shared/types/scenario';

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
  const available =
    availableShipTypes ??
    Object.keys(SHIP_STATS).filter((shipType) => shipType !== 'orbitalBase');

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
  playerId: PlayerId,
  purchases: FleetPurchase[],
  map: SolarSystemMap,
  scenario: ScenarioDefinition,
  difficulty: AIDifficulty,
  deps: FleetReadyDeps = {},
): LocalFleetReadyResult => {
  const processReady = deps.processReady ?? processFleetReady;

  const playerResult = processReady(
    state,
    playerId,
    purchases,
    map,
    scenario.availableShipTypes,
  );

  if ('error' in playerResult) {
    return { kind: 'error', error: playerResult.error.message };
  }

  const buildAIPurchases = deps.buildAIPurchases ?? buildAIFleetPurchases;

  const aiPlayerId: PlayerId = playerId === 0 ? 1 : 0;
  const aiPurchases = buildAIPurchases(
    playerResult.state.players[aiPlayerId].credits ?? 0,
    scenario.availableShipTypes,
    difficulty,
  );

  const aiResult = processReady(
    playerResult.state,
    aiPlayerId,
    aiPurchases,
    map,
    scenario.availableShipTypes,
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
