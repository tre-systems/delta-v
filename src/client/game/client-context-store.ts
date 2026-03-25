import type { AIDifficulty } from '../../shared/ai';
import type { ClientSession } from './session-model';
import type { GameTransport } from './transport';

type PlayerIdentityState = Pick<
  ClientSession,
  'playerId' | 'gameCode' | 'reconnectAttempts'
>;

type ReconnectState = Pick<ClientSession, 'reconnectAttempts'>;

type TransportState = Pick<ClientSession, 'transport'>;

type LatencyState = Pick<ClientSession, 'latencyMs'>;

type ScenarioState = Pick<ClientSession, 'scenario'>;

type LocalGameState = Pick<ClientSession, 'isLocalGame'>;

type DifficultyState = Pick<ClientSession, 'aiDifficulty'>;

type PlayerState = Pick<ClientSession, 'playerId'>;

type GameCodeState = Pick<ClientSession, 'gameCode'>;

type SpectatorModeState = Pick<ClientSession, 'spectatorMode'>;

export const setSpectatorMode = (
  ctx: SpectatorModeState,
  spectator: boolean,
): void => {
  ctx.spectatorMode = spectator;
};

export const applyWelcomeSession = (
  ctx: PlayerIdentityState,
  playerId: number,
  gameCode: string,
): void => {
  ctx.playerId = playerId;
  ctx.gameCode = gameCode;
  ctx.reconnectAttempts = 0;
};

export const setReconnectAttempts = (
  ctx: ReconnectState,
  reconnectAttempts: number,
): void => {
  ctx.reconnectAttempts = reconnectAttempts;
};

export const resetReconnectAttempts = (ctx: ReconnectState): void => {
  ctx.reconnectAttempts = 0;
};

export const setTransport = (
  ctx: TransportState,
  transport: GameTransport | null,
): void => {
  ctx.transport = transport;
};

export const setLatencyMs = (ctx: LatencyState, latencyMs: number): void => {
  ctx.latencyMs = latencyMs;
};

export const setScenario = (ctx: ScenarioState, scenario: string): void => {
  ctx.scenario = scenario;
};

export const setIsLocalGame = (
  ctx: LocalGameState,
  isLocalGame: boolean,
): void => {
  ctx.isLocalGame = isLocalGame;
};

export const setAIDifficulty = (
  ctx: DifficultyState,
  aiDifficulty: AIDifficulty,
): void => {
  ctx.aiDifficulty = aiDifficulty;
};

export const setPlayerId = (ctx: PlayerState, playerId: number): void => {
  ctx.playerId = playerId;
};

export const setGameCode = (
  ctx: GameCodeState,
  gameCode: string | null,
): void => {
  ctx.gameCode = gameCode;
};
