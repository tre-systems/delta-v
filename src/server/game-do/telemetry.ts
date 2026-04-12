import type { GameId } from '../../shared/ids';
import type { GameState } from '../../shared/types/domain';
import { getProjectedCurrentStateRaw, hasProjectionParity } from './archive';

export const reportGameDoEngineError = (
  deps: {
    db: D1Database | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
  },
  code: string,
  phase: string,
  turn: number,
  err: unknown,
): void => {
  const { db, waitUntil } = deps;
  if (!db) return;
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  waitUntil(
    db
      .prepare(
        'INSERT INTO events ' +
          '(ts, anon_id, event, props, ip_hash, ua) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        Date.now(),
        null,
        'engine_error',
        JSON.stringify({
          code,
          phase,
          turn,
          message: msg,
          stack,
        }),
        'server',
        null,
      )
      .run()
      .catch((e: unknown) =>
        console.error('[D1 engine error insert failed]', e),
      ),
  );
};

export const reportGameAbandoned = (
  deps: {
    db: D1Database | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
  },
  props: {
    gameId: string;
    turn: number;
    phase: string;
    reason: string;
    scenario: string;
  },
): void => {
  const { db, waitUntil } = deps;
  if (!db) return;
  waitUntil(
    db
      .prepare(
        'INSERT INTO events ' +
          '(ts, anon_id, event, props, ip_hash, ua) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        Date.now(),
        null,
        'game_abandoned',
        JSON.stringify(props),
        'server',
        null,
      )
      .run()
      .catch((e: unknown) =>
        console.error('[D1 game abandoned insert failed]', e),
      ),
  );
};

export const reportGameDoProjectionParityMismatch = async (deps: {
  storage: DurableObjectStorage;
  db: D1Database | undefined;
  waitUntil: (promise: Promise<unknown>) => void;
  gameId: GameId;
  liveState: GameState;
}): Promise<void> => {
  const projectedState = await getProjectedCurrentStateRaw(
    deps.storage,
    deps.gameId,
  );
  console.error('[projection parity mismatch]', {
    gameId: deps.gameId,
    liveTurn: deps.liveState.turnNumber,
    livePhase: deps.liveState.phase,
    projectedTurn: projectedState?.turnNumber ?? null,
    projectedPhase: projectedState?.phase ?? null,
  });

  const { db, waitUntil } = deps;
  if (!db) {
    return;
  }

  waitUntil(
    db
      .prepare(
        'INSERT INTO events ' +
          '(ts, anon_id, event, props, ip_hash, ua) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        Date.now(),
        null,
        'projection_parity_mismatch',
        JSON.stringify({
          gameId: deps.gameId,
          liveTurn: deps.liveState.turnNumber,
          livePhase: deps.liveState.phase,
          projectedTurn: projectedState?.turnNumber ?? null,
          projectedPhase: projectedState?.phase ?? null,
        }),
        'server',
        null,
      )
      .run()
      .catch((e: unknown) =>
        console.error('[D1 projection parity insert failed]', e),
      ),
  );
};

export const verifyGameDoProjectionParity = async (
  storage: DurableObjectStorage,
  state: GameState,
  onMismatch: (gameId: GameId, liveState: GameState) => Promise<void>,
): Promise<void> => {
  const hasParity = await hasProjectionParity(storage, state.gameId, state);
  if (!hasParity) {
    await onMismatch(state.gameId, state);
  }
};
