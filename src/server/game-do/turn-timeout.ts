import { TURN_TIMEOUT_MS } from '../../shared/constants';
import type { GameState, SolarSystemMap } from '../../shared/types/domain';
import type {
  PublishStateChangeOptions,
  StatefulServerMessage,
} from './message-builders';
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
    options?: PublishStateChangeOptions,
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
  // Re-arm the turn timer for another full window when the timeout couldn't
  // resolve an outcome. The deadline was deleted above, so without this a
  // failed resolution would silently kill turn timeouts for the rest of the
  // match and leave a stalled game to the inactivity reaper.
  const rearmTurnTimer = async (): Promise<void> => {
    await deps.storage.put(
      GAME_DO_STORAGE_KEYS.turnTimeoutAt,
      Date.now() + TURN_TIMEOUT_MS,
    );
    await deps.rescheduleAlarm();
  };
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
    await rearmTurnTimer();
    return;
  }

  if (!outcome) {
    // A live phase with no resolvable outcome keeps a ticking timer; the
    // pre-game waiting room is not turn-timed, so only reschedule there.
    if (gameState.phase === 'waiting') {
      await deps.rescheduleAlarm();
    } else {
      await rearmTurnTimer();
    }
    return;
  }
  await deps.publishStateChange(outcome.state, outcome.primaryMessage, {
    actor: null,
    events: outcome.events,
    lastTurnAutoPlayed: outcome.lastTurnAutoPlayed,
  });
};
