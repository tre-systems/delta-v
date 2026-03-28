import { must } from '../../shared/assert';
import type { EngineEvent } from '../../shared/engine/engine-events';
import {
  beginCombatPhase,
  processAstrogation,
  processCombat,
  processEmplacement,
  processFleetReady,
  processLogistics,
  processOrdnance,
  processSurrender,
  skipCombat,
  skipLogistics,
  skipOrdnance,
} from '../../shared/engine/game-engine';
import type {
  EngineError,
  GameState,
  PlayerId,
} from '../../shared/types/domain';
import type { C2S } from '../../shared/types/protocol';
import type { ScenarioDefinition } from '../../shared/types/scenario';
import {
  resolveCombatBroadcast,
  resolveMovementBroadcast,
  toMovementResultMessage,
  toStateUpdateMessage,
} from './messages';

export type EngineFailure = { error: EngineError };
export type StatefulActionSuccess = {
  state: GameState;
  engineEvents: EngineEvent[];
};
export type GameStateActionMessage = Exclude<
  C2S,
  { type: 'chat' } | { type: 'ping' } | { type: 'rematch' }
>;
export type GameStateActionType = GameStateActionMessage['type'];
export type GameStateActionMessageOf<
  T extends GameStateActionType = GameStateActionType,
> = Extract<GameStateActionMessage, { type: T }>;
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
    primaryMessage?: import('./messages').StatefulServerMessage,
    options?: {
      actor?: PlayerId | null;
      restartTurnTimer?: boolean;
      events?: EngineEvent[];
    },
  ) => Promise<void>;
}

export const defineGameStateActionHandler = <
  T extends GameStateActionType,
  Success extends StatefulActionSuccess = StatefulActionSuccess,
>(
  handler: GameStateActionHandler<T, Success>,
): GameStateActionHandler<T, Success> => handler;

export const createGameStateActionHandlers = (deps: ActionDeps) => {
  const publishForActor = async (
    playerId: PlayerId,
    result: StatefulActionSuccess,
    primaryMessage?: import('./messages').StatefulServerMessage,
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
      ) => processSurrender(gameState, playerId, message.shipIds),
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

interface RunActionDeps {
  getCurrentGameState: () => Promise<GameState | null>;
  getGameCode: () => Promise<string>;
  reportEngineError: (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ) => void;
  sendError: (
    ws: WebSocket,
    message: string,
    code?: EngineError['code'],
  ) => void;
}

export const runGameStateAction = async <
  Success extends {
    state: GameState;
  },
>(
  deps: RunActionDeps,
  ws: WebSocket,
  action: (
    gameState: GameState,
  ) => Success | EngineFailure | Promise<Success | EngineFailure>,
  onSuccess: (result: Success) => Promise<void> | void,
): Promise<void> => {
  const gameState = await deps.getCurrentGameState();

  if (!gameState) {
    return;
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
    deps.sendError(ws, 'Engine error — action rejected, game state preserved');
    return;
  }

  if ('error' in result) {
    deps.sendError(ws, result.error.message, result.error.code);
    return;
  }
  await onSuccess(result);
};

export const dispatchGameStateAction = async (
  playerId: PlayerId,
  ws: WebSocket,
  message: GameStateActionMessage,
  handlers: ReturnType<typeof createGameStateActionHandlers>,
  runner: <
    Success extends {
      state: GameState;
    },
  >(
    ws: WebSocket,
    action: (
      gameState: GameState,
    ) => Success | EngineFailure | Promise<Success | EngineFailure>,
    onSuccess: (result: Success) => Promise<void> | void,
  ) => Promise<void>,
): Promise<void> => {
  const dispatchByType = {
    fleetReady: (typedMessage: GameStateActionMessageOf<'fleetReady'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.fleetReady,
        runner,
      ),
    astrogation: (typedMessage: GameStateActionMessageOf<'astrogation'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.astrogation,
        runner,
      ),
    surrender: (typedMessage: GameStateActionMessageOf<'surrender'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.surrender,
        runner,
      ),
    ordnance: (typedMessage: GameStateActionMessageOf<'ordnance'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.ordnance,
        runner,
      ),
    emplaceBase: (typedMessage: GameStateActionMessageOf<'emplaceBase'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.emplaceBase,
        runner,
      ),
    skipOrdnance: (typedMessage: GameStateActionMessageOf<'skipOrdnance'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.skipOrdnance,
        runner,
      ),
    beginCombat: (typedMessage: GameStateActionMessageOf<'beginCombat'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.beginCombat,
        runner,
      ),
    combat: (typedMessage: GameStateActionMessageOf<'combat'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.combat,
        runner,
      ),
    skipCombat: (typedMessage: GameStateActionMessageOf<'skipCombat'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.skipCombat,
        runner,
      ),
    logistics: (typedMessage: GameStateActionMessageOf<'logistics'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.logistics,
        runner,
      ),
    skipLogistics: (typedMessage: GameStateActionMessageOf<'skipLogistics'>) =>
      dispatchGameStateActionOfType(
        playerId,
        ws,
        typedMessage,
        handlers.skipLogistics,
        runner,
      ),
  } satisfies {
    [T in GameStateActionType]: (
      typedMessage: GameStateActionMessageOf<T>,
    ) => Promise<void>;
  };

  await (
    dispatchByType as Record<
      GameStateActionType,
      (typedMessage: GameStateActionMessage) => Promise<void>
    >
  )[message.type](message);
};

const dispatchGameStateActionOfType = async <
  T extends GameStateActionType,
  Success extends StatefulActionSuccess,
>(
  playerId: PlayerId,
  ws: WebSocket,
  message: GameStateActionMessageOf<T>,
  handler: GameStateActionHandler<T, Success>,
  runner: <
    Result extends {
      state: GameState;
    },
  >(
    ws: WebSocket,
    action: (
      gameState: GameState,
    ) => Result | EngineFailure | Promise<Result | EngineFailure>,
    onSuccess: (result: Result) => Promise<void> | void,
  ) => Promise<void>,
): Promise<void> =>
  runner(
    ws,
    (gameState) => handler.run(gameState, playerId, message),
    (result) => handler.publish(playerId, result),
  );
