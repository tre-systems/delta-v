import type { AIDifficulty } from '../../shared/ai';
import type { GameTransport } from './transport';

type PlayerIdentityState = {
  playerId: number;
  gameCode: string | null;
  reconnectAttempts: number;
};

type ReconnectState = {
  reconnectAttempts: number;
};

type TransportState = {
  transport: GameTransport | null;
};

type LatencyState = {
  latencyMs: number;
};

type ScenarioState = {
  scenario: string;
};

type LocalGameState = {
  isLocalGame: boolean;
};

type DifficultyState = {
  aiDifficulty: AIDifficulty;
};

type PlayerState = {
  playerId: number;
};

type GameCodeState = {
  gameCode: string | null;
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
