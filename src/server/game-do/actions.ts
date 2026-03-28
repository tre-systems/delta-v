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

export const createGameStateActionHandlers = (deps: ActionDeps) =>
  ({
    fleetReady: defineGameStateActionHandler({
      run: async (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'fleetReady'>,
      ) => processFleetReady(gameState, playerId, message.purchases, deps.map),
      publish: async (playerId, result) => {
        await deps.publishStateChange(result.state, undefined, {
          actor: playerId,
          restartTurnTimer: result.state.phase === 'astrogation',
          events: result.engineEvents,
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
        await deps.publishStateChange(
          result.state,
          resolveMovementBroadcast(result),
          { actor: playerId, events: result.engineEvents },
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
        await deps.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state),
          {
            actor: playerId,
            restartTurnTimer: false,
            events: result.engineEvents,
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
        await deps.publishStateChange(
          result.state,
          toMovementResultMessage(result),
          {
            actor: playerId,
            events: result.engineEvents,
          },
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
        await deps.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state),
          {
            actor: playerId,
            restartTurnTimer: false,
            events: result.engineEvents,
          },
        );
      },
    }),
    skipOrdnance: defineGameStateActionHandler({
      run: async (gameState, playerId) =>
        skipOrdnance(gameState, playerId, deps.map, await deps.getActionRng()),
      publish: async (playerId, result) => {
        await deps.publishStateChange(
          result.state,
          resolveMovementBroadcast(result, 'stateUpdate'),
          { actor: playerId, events: result.engineEvents },
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
        await deps.publishStateChange(
          result.state,
          resolveCombatBroadcast(result, 'stateUpdate'),
          { actor: playerId, events: result.engineEvents },
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
        await deps.publishStateChange(
          result.state,
          must(resolveCombatBroadcast(result)),
          {
            actor: playerId,
            events: result.engineEvents,
          },
        );
      },
    }),
    skipCombat: defineGameStateActionHandler({
      run: async (gameState, playerId) =>
        skipCombat(gameState, playerId, deps.map, await deps.getActionRng()),
      publish: async (playerId, result) => {
        await deps.publishStateChange(
          result.state,
          resolveCombatBroadcast(result),
          {
            actor: playerId,
            events: result.engineEvents,
          },
        );
      },
    }),
    logistics: defineGameStateActionHandler({
      run: (
        gameState,
        playerId,
        message: GameStateActionMessageOf<'logistics'>,
      ) => processLogistics(gameState, playerId, message.transfers, deps.map),
      publish: async (playerId, result) => {
        await deps.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state, result.engineEvents),
          {
            actor: playerId,
            events: result.engineEvents,
          },
        );
      },
    }),
    skipLogistics: defineGameStateActionHandler({
      run: (gameState, playerId) =>
        skipLogistics(gameState, playerId, deps.map),
      publish: async (playerId, result) => {
        await deps.publishStateChange(
          result.state,
          toStateUpdateMessage(result.state, result.engineEvents),
          {
            actor: playerId,
            events: result.engineEvents,
          },
        );
      },
    }),
  }) satisfies Record<GameStateActionType, unknown>;

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
  switch (message.type) {
    case 'fleetReady':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.fleetReady,
        runner,
      );
      return;
    case 'astrogation':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.astrogation,
        runner,
      );
      return;
    case 'surrender':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.surrender,
        runner,
      );
      return;
    case 'ordnance':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.ordnance,
        runner,
      );
      return;
    case 'emplaceBase':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.emplaceBase,
        runner,
      );
      return;
    case 'skipOrdnance':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.skipOrdnance,
        runner,
      );
      return;
    case 'beginCombat':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.beginCombat,
        runner,
      );
      return;
    case 'combat':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.combat,
        runner,
      );
      return;
    case 'skipCombat':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.skipCombat,
        runner,
      );
      return;
    case 'logistics':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.logistics,
        runner,
      );
      return;
    case 'skipLogistics':
      await dispatchGameStateActionOfType(
        playerId,
        ws,
        message,
        handlers.skipLogistics,
        runner,
      );
      return;
  }
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
