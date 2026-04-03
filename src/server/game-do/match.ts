import type { EngineEvent } from '../../shared/engine/engine-events';
import { createGame } from '../../shared/engine/game-engine';
import type { ScenarioKey } from '../../shared/map-data';
import { findBaseHex } from '../../shared/map-data';
import { mulberry32 } from '../../shared/prng';
import type { ScenarioDefinition, SolarSystemMap } from '../../shared/types';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { RoomConfig } from '../protocol';
import { allocateMatchIdentity, saveMatchCreatedAt } from './archive';
import type { StatefulServerMessage } from './message-builders';
import { toGameStartMessage } from './message-builders';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';

type InitGameDeps = {
  storage: DurableObjectStorage;
  map: SolarSystemMap;
  getRoomConfig: () => Promise<RoomConfig | null>;
  getScenario: () => Promise<{ def: ScenarioDefinition; key: ScenarioKey }>;
  getGameCode: () => Promise<string>;
  clearRoomArchivedFlag: () => Promise<void>;
  publishStateChange: (
    state: GameState,
    primaryMessage: StatefulServerMessage,
    options: { events: EngineEvent[] },
  ) => Promise<void>;
};

const buildInitEvents = (
  gameState: GameState,
  matchSeed: number,
): EngineEvent[] => {
  const initEvents: EngineEvent[] = [
    {
      type: 'gameCreated',
      scenario: gameState.scenario,
      turn: gameState.turnNumber,
      phase: gameState.phase,
      matchSeed,
    },
  ];

  for (const ship of gameState.ships) {
    if (ship.identity?.hasFugitives) {
      initEvents.push({
        type: 'fugitiveDesignated',
        shipId: ship.id,
        playerId: ship.owner,
      });
    }
  }

  return initEvents;
};

export const initGameSession = async (deps: InitGameDeps): Promise<void> => {
  const [roomConfig, scenarioInfo] = await Promise.all([
    deps.getRoomConfig(),
    deps.getScenario(),
  ]);
  const code = roomConfig?.code ?? (await deps.getGameCode());
  const { gameId, matchSeed } = await allocateMatchIdentity(deps.storage, code);
  const createResult = createGame(
    scenarioInfo.def,
    deps.map,
    gameId,
    findBaseHex,
    mulberry32(matchSeed),
    scenarioInfo.key,
  );

  if (!createResult.ok) {
    throw new Error(createResult.error.message);
  }

  const gameState = createResult.value;
  const gameStartMessage = toGameStartMessage(gameState);

  await deps.clearRoomArchivedFlag();
  await saveMatchCreatedAt(deps.storage, gameId, Date.now());
  await deps.publishStateChange(gameState, gameStartMessage, {
    events: buildInitEvents(gameState, matchSeed),
  });
};

type HandleRematchDeps = {
  storage: DurableObjectStorage;
  initGame: () => Promise<void>;
  broadcast: (msg: { type: 'rematchPending' }) => void;
};

export const handleRematchRequest = async (
  deps: HandleRematchDeps,
  playerId: PlayerId,
): Promise<void> => {
  const requests =
    (await deps.storage.get<number[]>(GAME_DO_STORAGE_KEYS.rematchRequests)) ??
    [];

  if (!requests.includes(playerId)) {
    requests.push(playerId);
  }

  if (requests.length >= 2) {
    await deps.storage.delete(GAME_DO_STORAGE_KEYS.rematchRequests);
    await deps.initGame();
    return;
  }

  await deps.storage.put(GAME_DO_STORAGE_KEYS.rematchRequests, requests);
  deps.broadcast({ type: 'rematchPending' });
};
