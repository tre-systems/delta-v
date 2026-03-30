import type { AIDifficulty } from '../../shared/ai';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { ReadonlySignal } from '../reactive';
import { signal } from '../reactive';
import type { LogisticsStore } from './logistics-ui';
import type { ClientState } from './phase';
import { createPlanningStore, type PlanningStore } from './planning';
import type { GameTransport } from './transport';

const defineReactiveSessionProperty = <T>(
  session: object,
  key: string,
  initial: T,
): ReadonlySignal<T> => {
  const backingSignal = signal(initial);

  Object.defineProperty(session, key, {
    enumerable: true,
    configurable: false,
    get: () => backingSignal.value,
    set: (next: T) => {
      backingSignal.value = next;
    },
  });

  return backingSignal;
};

/** Single client-side session shape: connection, lobby, and in-match fields live here. */
export interface ClientSession {
  state: ClientState;
  readonly stateSignal: ReadonlySignal<ClientState>;
  playerId: PlayerId | -1;
  /** True while connected as a live spectator (`?viewer=spectator`). */
  spectatorMode: boolean;
  gameCode: string | null;
  scenario: string;
  gameState: GameState | null;
  readonly gameStateSignal: ReadonlySignal<GameState | null>;
  logisticsState: LogisticsStore | null;
  readonly logisticsStateSignal: ReadonlySignal<LogisticsStore | null>;
  isLocalGame: boolean;
  readonly isLocalGameSignal: ReadonlySignal<boolean>;
  aiDifficulty: AIDifficulty;
  transport: GameTransport | null;
  planningState: PlanningStore;
  latencyMs: number;
  readonly latencyMsSignal: ReadonlySignal<number>;
  reconnectAttempts: number;
}

export const createInitialClientSession = (): ClientSession => {
  type ClientSessionDraft = Omit<
    ClientSession,
    | 'state'
    | 'stateSignal'
    | 'gameState'
    | 'gameStateSignal'
    | 'logisticsState'
    | 'logisticsStateSignal'
    | 'isLocalGame'
    | 'isLocalGameSignal'
    | 'latencyMs'
    | 'latencyMsSignal'
  > & {
    state: ClientState;
    stateSignal: ReadonlySignal<ClientState>;
    gameState: GameState | null;
    gameStateSignal: ReadonlySignal<GameState | null>;
    logisticsState: LogisticsStore | null;
    logisticsStateSignal: ReadonlySignal<LogisticsStore | null>;
    isLocalGame: boolean;
    isLocalGameSignal: ReadonlySignal<boolean>;
    latencyMs: number;
    latencyMsSignal: ReadonlySignal<number>;
  };

  const session = {
    playerId: -1,
    spectatorMode: false,
    gameCode: null,
    scenario: 'biplanetary',
    isLocalGame: false,
    aiDifficulty: 'normal',
    transport: null,
    planningState: createPlanningStore(),
    latencyMs: -1,
    reconnectAttempts: 0,
  } as ClientSessionDraft;

  session.stateSignal = defineReactiveSessionProperty(session, 'state', 'menu');
  session.gameStateSignal = defineReactiveSessionProperty(
    session,
    'gameState',
    null,
  );
  session.logisticsStateSignal = defineReactiveSessionProperty(
    session,
    'logisticsState',
    null,
  );
  session.isLocalGameSignal = defineReactiveSessionProperty(
    session,
    'isLocalGame',
    false,
  );
  session.latencyMsSignal = defineReactiveSessionProperty(
    session,
    'latencyMs',
    -1,
  );

  return session;
};

/** Subset read by WebSocket message handling (full `ClientSession` is assignable). */
export type ClientSessionMessageContext = Pick<
  ClientSession,
  | 'state'
  | 'playerId'
  | 'gameCode'
  | 'reconnectAttempts'
  | 'latencyMs'
  | 'gameState'
>;

/** Subset used by `applyClientStateTransition` (full `ClientSession` is assignable). */
export type ClientSessionStateTransitionContext = Pick<
  ClientSession,
  | 'state'
  | 'playerId'
  | 'gameCode'
  | 'gameState'
  | 'logisticsState'
  | 'planningState'
  | 'isLocalGame'
>;

/** Merge defaults for tests and focused fakes. */
export const stubClientSession = (
  overrides: Partial<
    Omit<ClientSession, 'stateSignal' | 'gameStateSignal'>
  > = {},
): ClientSession => Object.assign(createInitialClientSession(), overrides);
