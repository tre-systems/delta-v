import { must } from '../../shared/assert';
import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  beginCombatPhase,
  endCombat,
  processAstrogation,
  processCombat,
  processEmplacement,
  processFleetReady,
  processLogistics,
  processOrdnance,
  processSingleCombat,
  processSurrender,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../../shared/engine/game-engine';
import type { ShipId } from '../../shared/ids';
import {
  type EngineError,
  ErrorCode,
  type GameState,
  type PlayerId,
} from '../../shared/types/domain';
import type { C2S } from '../../shared/types/protocol';
import type { ScenarioDefinition } from '../../shared/types/scenario';
import {
  type ActionAcceptedMessage,
  type ActionRejectedMessage,
  buildActionAccepted,
  buildActionRejected,
  checkActionGuards,
  type IdempotencyKeyCache,
} from './action-guards';
import {
  type PublishStateChangeOptions,
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  type StatefulServerMessage,
  toCombatSingleResultMessage,
  toMovementResultMessage,
  toStateUpdateMessage,
} from './message-builders';

export type EngineFailure = { error: EngineError };
export type StatefulActionSuccess = {
  state: GameState;
  engineEvents: EngineEvent[];
};

// Single source of truth for which C2S message types are game-state actions.
// Aux messages (chat, ping, rematch) are everything else.
export const GAME_STATE_ACTION_TYPES = new Set([
  'fleetReady',
  'astrogation',
  'surrender',
  'ordnance',
  'emplaceBase',
  'skipOrdnance',
  'beginCombat',
  'combat',
  'combatSingle',
  'endCombat',
  'skipCombat',
  'logistics',
  'skipLogistics',
] as const satisfies readonly C2S['type'][]);

export type GameStateActionType =
  typeof GAME_STATE_ACTION_TYPES extends Set<infer T> ? T : never;
export type GameStateActionMessage = Extract<
  C2S,
  { type: GameStateActionType }
>;
export type AuxMessage = Exclude<C2S, { type: GameStateActionType }>;
export type GameStateActionMessageOf<
  T extends GameStateActionType = GameStateActionType,
> = Extract<GameStateActionMessage, { type: T }>;

export const isGameStateActionMessage = (
  msg: C2S,
): msg is GameStateActionMessage =>
  GAME_STATE_ACTION_TYPES.has(msg.type as GameStateActionType);
export type GameStateActionHandler<
  T extends GameStateActionType,
  Success extends StatefulActionSuccess = StatefulActionSuccess,
> = {
  run: (
    gameState: GameState,
    playerId: PlayerId,
    message: GameStateActionMessageOf<T>,
  ) => Success | EngineFailure | Promise<Success | EngineFailure>;
  publish: (playerId: PlayerId, result: Success) => Promise<void>;
};

interface ActionDeps {
  map: ReturnType<typeof import('../../shared/map-data').buildSolarSystemMap>;
  getScenario: () => Promise<ScenarioDefinition>;
  getActionRng: () => Promise<() => number>;
  publishStateChange: (
    state: GameState,
    primaryMessage?: StatefulServerMessage,
    options?: PublishStateChangeOptions,
  ) => Promise<void>;
}

export const defineGameStateActionHandler = <
  T extends GameStateActionType,
  Success extends StatefulActionSuccess = StatefulActionSuccess,
>(
  handler: GameStateActionHandler<T, Success>,
): GameStateActionHandler<T, Success> => handler;

const inferSurrenderShipIds = (
  gameState: GameState,
  playerId: PlayerId,
): { shipIds: ShipId[] } | { error: EngineError } => {
  const shipIds = gameState.ships
    .filter(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        ship.control !== 'captured' &&
        ship.control !== 'surrendered',
    )
    .map((ship) => ship.id);
  if (shipIds.length === 0) {
    return {
      error: {
        code: ErrorCode.NOT_ALLOWED,
        message: 'No eligible ships available to surrender',
      },
    };
  }
  return { shipIds };
};

export const createGameStateActionHandlers = (deps: ActionDeps) => {
  const publishForActor = async (
    playerId: PlayerId,
    result: StatefulActionSuccess,
    primaryMessage?: StatefulServerMessage,
    options?: {
      restartTurnTimer?: boolean;
    },
  ) =>
    deps.publishStateChange(result.state, primaryMessage, {
      actor: playerId,
      restartTurnTimer: options?.restartTurnTimer,
      events: result.engineEvents,
    });

  return {
    fleetReady: defineGameStateActionHandler({
      run: async (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'fleetReady'>,
      ) => processFleetReady(gameState, playerId, message.purchases, deps.map),
      publish: async (playerId, result) => {
        await publishForActor(playerId, result, undefined, {
          restartTurnTimer: result.state.phase === 'astrogation',
        });
      },
    }),
    astrogation: defineGameStateActionHandler({
      run: async (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'astrogation'>,
      ) =>
        processAstrogation(
          gameState,
          playerId,
          message.orders,
          deps.map,
          await deps.getActionRng(),
        ),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          resolveMovementBroadcast(result),
        );
      },
    }),
    surrender: defineGameStateActionHandler({
      run: (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'surrender'>,
      ) => {
        if (message.shipIds.length > 0) {
          return processSurrender(gameState, playerId, message.shipIds);
        }
        const inferred = inferSurrenderShipIds(gameState, playerId);
        if ('error' in inferred) {
          return inferred;
        }
        return processSurrender(gameState, playerId, inferred.shipIds);
      },
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          toStateUpdateMessage(result.state),
          {
            restartTurnTimer: false,
          },
        );
      },
    }),
    ordnance: defineGameStateActionHandler({
      run: async (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'ordnance'>,
      ) =>
        processOrdnance(
          gameState,
          playerId,
          message.launches,
          deps.map,
          await deps.getActionRng(),
        ),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          toMovementResultMessage(result),
        );
      },
    }),
    emplaceBase: defineGameStateActionHandler({
      run: (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'emplaceBase'>,
      ) =>
        processEmplacement(gameState, playerId, message.emplacements, deps.map),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          toStateUpdateMessage(result.state),
          {
            restartTurnTimer: false,
          },
        );
      },
    }),
    skipOrdnance: defineGameStateActionHandler({
      run: async (gameState, playerId) =>
        skipOrdnance(gameState, playerId, deps.map, await deps.getActionRng()),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          resolveMovementBroadcast(result, 'stateUpdate'),
        );
      },
    }),
    beginCombat: defineGameStateActionHandler({
      run: async (gameState, playerId) =>
        beginCombatPhase(
          gameState,
          playerId,
          deps.map,
          await deps.getActionRng(),
        ),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          resolveCombatBroadcast(result, 'stateUpdate'),
        );
      },
    }),
    combat: defineGameStateActionHandler({
      run: async (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'combat'>,
      ) =>
        processCombat(
          gameState,
          playerId,
          message.attacks,
          deps.map,
          await deps.getActionRng(),
        ),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          must(resolveCombatBroadcast(result)),
        );
      },
    }),
    combatSingle: defineGameStateActionHandler({
      run: async (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'combatSingle'>,
      ) =>
        processSingleCombat(
          gameState,
          playerId,
          message.attack,
          deps.map,
          await deps.getActionRng(),
        ),
      publish: async (playerId, result) => {
        const r = must(result.results?.[0]);
        await publishForActor(
          playerId,
          result,
          toCombatSingleResultMessage(result.state, r),
          { restartTurnTimer: false },
        );
      },
    }),
    endCombat: defineGameStateActionHandler({
      run: async (gameState, playerId) =>
        endCombat(gameState, playerId, deps.map, await deps.getActionRng()),
      publish: async (playerId, result) => {
        await publishForActor(playerId, result, resolveCombatBroadcast(result));
      },
    }),
    skipCombat: defineGameStateActionHandler({
      run: async (gameState, playerId) =>
        skipCombat(gameState, playerId, deps.map, await deps.getActionRng()),
      publish: async (playerId, result) => {
        await publishForActor(playerId, result, resolveCombatBroadcast(result));
      },
    }),
    logistics: defineGameStateActionHandler({
      run: (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'logistics'>,
      ) => processLogistics(gameState, playerId, message.transfers, deps.map),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          toStateUpdateMessage(result.state, result.engineEvents),
        );
      },
    }),
    skipLogistics: defineGameStateActionHandler({
      run: (gameState, playerId) =>
        skipLogistics(gameState, playerId, deps.map),
      publish: async (playerId, result) => {
        await publishForActor(
          playerId,
          result,
          toStateUpdateMessage(result.state, result.engineEvents),
        );
      },
    }),
  } satisfies Record<GameStateActionType, unknown>;
};

// Reply sink injected by the caller. The WebSocket path closes a real socket
// into both methods; the HTTP /mcp/action path captures the messages and
// returns them in the JSON response. Decoupling the runner from WebSocket
// transport is what lets `dispatchGameStateAction` serve both surfaces.
export interface RunActionDeps {
  getCurrentGameState: () => Promise<GameState | null>;
  getGameCode: () => Promise<string>;
  reportEngineError: (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ) => void;
  sendError: (message: string, code?: EngineError['code']) => void;
  sendActionAccepted: (accepted: ActionAcceptedMessage) => void;
  sendActionRejected: (rejected: ActionRejectedMessage) => void;
}

// Runner passed to dispatchGameStateAction. Optional preCheck runs against the
// fetched state before the action fires so submission guards (expectedTurn,
// expectedPhase, idempotencyKey) can short-circuit with a rich
// actionRejected message instead of a plain `error`.
export type GameStateActionRunner = <Success extends { state: GameState }>(
  action: (
    gameState: GameState,
  ) => Success | EngineFailure | Promise<Success | EngineFailure>,
  onSuccess: (result: Success) => Promise<void> | void,
  preCheck?: (gameState: GameState) => {
    accepted: ActionAcceptedMessage;
    rejected: ActionRejectedMessage | null;
  },
) => Promise<void>;

const mapEngineErrorToActionRejectedReason = (
  code: ErrorCode,
): ActionRejectedMessage['reason'] | null => {
  switch (code) {
    case ErrorCode.INVALID_PHASE:
      return 'invalidPhase';
    case ErrorCode.NOT_YOUR_TURN:
      return 'notYourTurn';
    case ErrorCode.INVALID_PLAYER:
      return 'invalidPlayer';
    case ErrorCode.INVALID_SHIP:
      return 'invalidShip';
    case ErrorCode.INVALID_TARGET:
      return 'invalidTarget';
    case ErrorCode.INVALID_SELECTION:
      return 'invalidSelection';
    case ErrorCode.INVALID_INPUT:
      return 'invalidInput';
    case ErrorCode.NOT_ALLOWED:
      return 'notAllowed';
    case ErrorCode.RESOURCE_LIMIT:
      return 'resourceLimit';
    case ErrorCode.STATE_CONFLICT:
      return 'stateConflict';
    case ErrorCode.ROOM_NOT_FOUND:
    case ErrorCode.ROOM_FULL:
    case ErrorCode.GAME_IN_PROGRESS:
    case ErrorCode.GAME_COMPLETED:
      return null;
  }
};

export const runGameStateAction = async <
  Success extends {
    state: GameState;
  },
>(
  deps: RunActionDeps,
  action: (
    gameState: GameState,
  ) => Success | EngineFailure | Promise<Success | EngineFailure>,
  onSuccess: (result: Success) => Promise<void> | void,
  preCheck?: (gameState: GameState) => {
    accepted: ActionAcceptedMessage;
    rejected: ActionRejectedMessage | null;
  },
): Promise<void> => {
  const gameState = await deps.getCurrentGameState();

  if (!gameState) {
    return;
  }

  let accepted: ActionAcceptedMessage | null = null;
  if (preCheck) {
    const preCheckResult = preCheck(gameState);
    accepted = preCheckResult.accepted;
    const rejected = preCheckResult.rejected;
    if (rejected) {
      deps.sendActionRejected(rejected);
      return;
    }
  }

  let result: Success | EngineFailure;
  try {
    result = await action(gameState);
  } catch (err) {
    const code = await deps.getGameCode();
    console.error(
      `Engine error in game ${code}`,
      `(phase=${gameState.phase},` + ` turn=${gameState.turnNumber}):`,
      err,
    );
    deps.reportEngineError(code, gameState.phase, gameState.turnNumber, err);
    deps.sendError('Engine error — action rejected, game state preserved');
    return;
  }

  if ('error' in result) {
    const rejectionReason = mapEngineErrorToActionRejectedReason(
      result.error.code,
    );
    if (rejectionReason) {
      deps.sendActionRejected(
        buildActionRejected(
          {
            reason: rejectionReason,
            message: result.error.message,
          },
          gameState,
          undefined,
        ),
      );
      return;
    }
    deps.sendError(result.error.message, result.error.code);
    return;
  }
  if (accepted) {
    deps.sendActionAccepted(accepted);
  }
  await onSuccess(result);
};

export const dispatchGameStateAction = async (
  playerId: PlayerId,
  message: GameStateActionMessage,
  handlers: ReturnType<typeof createGameStateActionHandlers>,
  runner: GameStateActionRunner,
  idempotencyCache?: IdempotencyKeyCache,
): Promise<void> => {
  const handler = handlers[message.type] as GameStateActionHandler<
    typeof message.type,
    StatefulActionSuccess
  >;

  const guards = message.guards;

  const preCheck = (gameState: GameState) => {
    const guardCheck = checkActionGuards(guards, gameState, playerId, message);
    const accepted = buildActionAccepted(
      guardCheck.guardStatus,
      gameState,
      guards,
      playerId,
    );
    if (guardCheck.rejection) {
      return {
        accepted,
        rejected: buildActionRejected(
          guardCheck.rejection,
          gameState,
          guards,
          playerId,
        ),
      };
    }

    const key = guards?.idempotencyKey;
    if (key && idempotencyCache?.has(playerId, key)) {
      return {
        accepted,
        rejected: buildActionRejected(
          {
            reason: 'duplicateIdempotencyKey',
            message: `idempotency key already processed this phase`,
          },
          gameState,
          guards,
          playerId,
        ),
      };
    }
    return {
      accepted,
      rejected: null,
    };
  };

  await runner(
    (gameState) => handler.run(gameState, playerId, message),
    async (result) => {
      // Only remember the key after the engine accepted the action so a
      // transient engine error doesn't poison the ring with a key the agent
      // will legitimately retry.
      const key = guards?.idempotencyKey;
      if (key && idempotencyCache) {
        idempotencyCache.remember(playerId, key);
      }
      await handler.publish(playerId, result);
    },
    preCheck,
  );
};

// Outcome captured by the HTTP /mcp/action path. The WebSocket path doesn't
// need a return value because it pushes errors/rejections into the socket and
// success into broadcastStateChange, but HTTP must surface the verdict in the
// response body.
export type DispatchOutcome =
  | { kind: 'accepted'; accepted: ActionAcceptedMessage | null }
  | { kind: 'rejected'; rejected: ActionRejectedMessage }
  | { kind: 'error'; message: string; code?: EngineError['code'] }
  | { kind: 'noState' };

interface HttpDispatchDeps {
  getCurrentGameState: () => Promise<GameState | null>;
  getGameCode: () => Promise<string>;
  reportEngineError: (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ) => void;
  handlers: ReturnType<typeof createGameStateActionHandlers>;
  idempotencyCache?: IdempotencyKeyCache;
}

// Dispatch a game-state action without a WebSocket and capture the outcome
// for an HTTP response. Reuses dispatchGameStateAction + runGameStateAction
// so engine pipelines (preCheck, idempotency cache, publishStateChange) match
// the WebSocket path exactly.
export const dispatchGameStateActionForHttp = async (
  playerId: PlayerId,
  message: GameStateActionMessage,
  deps: HttpDispatchDeps,
): Promise<DispatchOutcome> => {
  let outcome: DispatchOutcome = { kind: 'accepted', accepted: null };
  let outcomeSet = false;
  const setOutcome = (next: DispatchOutcome): void => {
    if (outcomeSet) return;
    outcome = next;
    outcomeSet = true;
  };

  const runDeps: RunActionDeps = {
    getCurrentGameState: deps.getCurrentGameState,
    getGameCode: deps.getGameCode,
    reportEngineError: deps.reportEngineError,
    sendError: (msg, code) => setOutcome({ kind: 'error', message: msg, code }),
    sendActionAccepted: (accepted) =>
      setOutcome({ kind: 'accepted', accepted }),
    sendActionRejected: (rejected) =>
      setOutcome({ kind: 'rejected', rejected }),
  };

  // Probe state once up front so we can distinguish "no game yet" from
  // "accepted but state didn't change". runGameStateAction silently returns
  // early when state is missing — match that with an explicit kind.
  const stateProbe = await deps.getCurrentGameState();
  if (!stateProbe) return { kind: 'noState' };

  await dispatchGameStateAction(
    playerId,
    message,
    deps.handlers,
    (action, onSuccess, preCheck) =>
      runGameStateAction(runDeps, action, onSuccess, preCheck),
    deps.idempotencyCache,
  );

  return outcome;
};
