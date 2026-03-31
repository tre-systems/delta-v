import type { EngineEvent } from '../../shared/engine/engine-events';
import type {
  GameState,
  PlayerId,
  SolarSystemMap,
} from '../../shared/types/domain';
import type { StatefulServerMessage } from './message-builders';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';
import { resolveTurnTimeoutOutcome } from './turns';

export type GameDoTurnTimeoutDeps = {
  storage: DurableObjectStorage;
  map: SolarSystemMap;
  getCurrentGameState: () => Promise<GameState | null>;
  getActionRng: () => Promise<() => number>;
  getGameCode: () => Promise<string>;
  reportEngineError: (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ) => void;
  publishStateChange: (
    state: GameState,
    primaryMessage?: StatefulServerMessage,
    options?: {
      actor?: PlayerId | null;
      restartTurnTimer?: boolean;
      events?: EngineEvent[];
    },
  ) => Promise<void>;
  rescheduleAlarm: () => Promise<void>;
};

export const runGameDoTurnTimeout = async (
  deps: GameDoTurnTimeoutDeps,
): Promise<void> => {
  await deps.storage.delete(GAME_DO_STORAGE_KEYS.turnTimeoutAt);
  const gameState = await deps.getCurrentGameState();

  if (!gameState || gameState.phase === 'gameOver') {
    await deps.rescheduleAlarm();
    return;
  }
  let outcome: ReturnType<typeof resolveTurnTimeoutOutcome>;
  try {
    const rng = await deps.getActionRng();
    outcome = resolveTurnTimeoutOutcome(gameState, deps.map, rng);
  } catch (err) {
    const code = await deps.getGameCode();
    console.error(
      `Engine error during turn timeout in game ${code}`,
      `(phase=${gameState.phase},` + ` turn=${gameState.turnNumber}):`,
      err,
    );
    deps.reportEngineError(code, gameState.phase, gameState.turnNumber, err);
    await deps.rescheduleAlarm();
    return;
  }

  if (!outcome) {
    await deps.rescheduleAlarm();
    return;
  }
  await deps.publishStateChange(outcome.state, outcome.primaryMessage, {
    actor: null,
    events: outcome.events,
  });
};
