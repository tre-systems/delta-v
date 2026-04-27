import { must } from '../../shared/assert';
import type { MovementResult } from '../../shared/engine/game-engine';
import { filterLogisticsTransferLogEvents } from '../../shared/engine/transfer-log-events';
import type {
  CombatResult,
  GameState,
  PlayerId,
} from '../../shared/types/domain';
import type { LogisticsTransferLogEvent } from '../../shared/types/protocol';
import { formatLogisticsTransferLogLines } from '../ui/formatters';
import type { LocalResolution } from './local';

type ImmediateGameOver = {
  won: boolean;
  reason: string;
  ratingDelta?: number;
};

export type AuthoritativeUpdate =
  | {
      kind: 'movementResult';
      state: GameState;
      movements: MovementResult['movements'];
      ordnanceMovements: MovementResult['ordnanceMovements'];
      events: MovementResult['events'];
      gameOver?: ImmediateGameOver;
    }
  | {
      kind: 'combatResult';
      state: GameState;
      results: CombatResult[];
      previousState?: GameState;
      resetCombat?: boolean;
      shouldContinue?: boolean;
      gameOver?: ImmediateGameOver;
    }
  | {
      kind: 'combatSingleResult';
      state: GameState;
      result: CombatResult;
      previousState?: GameState;
      gameOver?: ImmediateGameOver;
    }
  | {
      kind: 'stateUpdate';
      state: GameState;
      shouldContinue?: boolean;
      transferEvents?: LogisticsTransferLogEvent[];
      gameOver?: ImmediateGameOver;
    }
  | {
      kind: 'gameOver';
      won: boolean;
      reason: string;
      ratingDelta?: number;
    };

export interface AuthoritativeUpdateDeps {
  getCurrentGameState: () => GameState | null;
  applyGameState: (state: GameState) => void;
  presentMovementResult: (
    state: GameState,
    movements: MovementResult['movements'],
    ordnanceMovements: MovementResult['ordnanceMovements'],
    events: MovementResult['events'],
    onComplete: () => void,
  ) => void;
  presentCombatResults: (
    previousState: GameState,
    state: GameState,
    results: CombatResult[],
    resetCombat?: boolean,
  ) => void;
  showGameOverOutcome: (
    won: boolean,
    reason: string,
    ratingDelta?: number,
  ) => void;
  onMovementResultComplete: () => void;
  onCombatResultComplete: () => void;
  onCombatSingleResultComplete: () => void;
  onStateUpdateComplete: () => void;
  logText: (text: string) => void;
  deserializeState: (raw: GameState) => GameState;
}

const deriveImmediateGameOver = (
  state: GameState,
  playerId: PlayerId,
): ImmediateGameOver | undefined => {
  if (state.phase !== 'gameOver' || !state.outcome) {
    return undefined;
  }

  return {
    won: state.outcome.winner === playerId,
    reason: state.outcome.reason,
  };
};

const showGameOver = (
  deps: Pick<AuthoritativeUpdateDeps, 'showGameOverOutcome'>,
  gameOver: ImmediateGameOver,
): void => {
  if (gameOver.ratingDelta === undefined) {
    deps.showGameOverOutcome(gameOver.won, gameOver.reason);
    return;
  }

  deps.showGameOverOutcome(gameOver.won, gameOver.reason, gameOver.ratingDelta);
};

const showImmediateGameOverOrContinue = (
  deps: Pick<
    AuthoritativeUpdateDeps,
    | 'showGameOverOutcome'
    | 'onMovementResultComplete'
    | 'onCombatResultComplete'
    | 'onCombatSingleResultComplete'
    | 'onStateUpdateComplete'
  >,
  kind: AuthoritativeUpdate['kind'],
  gameOver: ImmediateGameOver | undefined,
): void => {
  if (gameOver) {
    showGameOver(deps, gameOver);
    return;
  }

  switch (kind) {
    case 'movementResult':
      deps.onMovementResultComplete();
      return;
    case 'combatResult':
      deps.onCombatResultComplete();
      return;
    case 'combatSingleResult':
      deps.onCombatSingleResultComplete();
      return;
    case 'stateUpdate':
      deps.onStateUpdateComplete();
      return;
    case 'gameOver':
      return;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return;
    }
  }
};

const logTransferEvents = (
  deps: Pick<AuthoritativeUpdateDeps, 'logText'>,
  transferEvents: LogisticsTransferLogEvent[],
  state: GameState,
): void => {
  for (const line of formatLogisticsTransferLogLines(
    transferEvents,
    state.ships,
  )) {
    deps.logText(line);
  }
};

export const applyAuthoritativeUpdate = (
  deps: AuthoritativeUpdateDeps,
  update: AuthoritativeUpdate,
): void => {
  switch (update.kind) {
    case 'movementResult': {
      const state = deps.deserializeState(update.state);
      deps.presentMovementResult(
        state,
        update.movements,
        update.ordnanceMovements,
        update.events,
        () =>
          showImmediateGameOverOrContinue(deps, update.kind, update.gameOver),
      );
      return;
    }
    case 'combatResult': {
      const state = deps.deserializeState(update.state);
      const previousState =
        update.previousState ?? must(deps.getCurrentGameState());

      deps.presentCombatResults(
        previousState,
        state,
        update.results,
        update.resetCombat,
      );

      if (update.gameOver) {
        showGameOver(deps, update.gameOver);
        return;
      }

      if (update.shouldContinue !== false) {
        deps.onCombatResultComplete();
      }
      return;
    }
    case 'combatSingleResult': {
      const state = deps.deserializeState(update.state);
      const previousState =
        update.previousState ?? must(deps.getCurrentGameState());

      deps.presentCombatResults(previousState, state, [update.result], false);
      showImmediateGameOverOrContinue(deps, update.kind, update.gameOver);
      return;
    }
    case 'stateUpdate': {
      const state = deps.deserializeState(update.state);

      if (update.transferEvents?.length) {
        logTransferEvents(deps, update.transferEvents, state);
      }

      deps.applyGameState(state);

      if (update.gameOver) {
        showGameOver(deps, update.gameOver);
        return;
      }

      if (update.shouldContinue !== false) {
        deps.onStateUpdateComplete();
      }
      return;
    }
    case 'gameOver':
      showGameOver(deps, update);
      return;
    default: {
      const _exhaustive: never = update;
      void _exhaustive;
      return;
    }
  }
};

export const toLocalAuthoritativeUpdate = (
  resolution: Exclude<LocalResolution, { kind: 'error' }>,
  playerId: PlayerId,
): AuthoritativeUpdate => {
  switch (resolution.kind) {
    case 'movement':
      return {
        kind: 'movementResult',
        state: resolution.result.state,
        movements: resolution.result.movements,
        ordnanceMovements: resolution.result.ordnanceMovements,
        events: resolution.result.events,
        gameOver: deriveImmediateGameOver(resolution.result.state, playerId),
      };
    case 'combat':
      return {
        kind: 'combatResult',
        previousState: resolution.previousState,
        state: resolution.state,
        results: resolution.results,
        resetCombat: resolution.resetCombat,
        gameOver: deriveImmediateGameOver(resolution.state, playerId),
      };
    case 'combatSingle':
      return {
        kind: 'combatSingleResult',
        previousState: resolution.previousState,
        state: resolution.state,
        result: resolution.result,
        gameOver: deriveImmediateGameOver(resolution.state, playerId),
      };
    case 'logistics':
      return {
        kind: 'stateUpdate',
        state: resolution.state,
        transferEvents: filterLogisticsTransferLogEvents(
          resolution.engineEvents,
        ),
        gameOver: deriveImmediateGameOver(resolution.state, playerId),
      };
    case 'state':
      return {
        kind: 'stateUpdate',
        state: resolution.state,
        gameOver: deriveImmediateGameOver(resolution.state, playerId),
      };
    default: {
      const _exhaustive: never = resolution;
      return _exhaustive;
    }
  }
};
