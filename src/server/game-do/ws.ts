/**
 * Durable Object WebSocket lifecycle entrypoints.
 * Keep the hibernation callbacks here; parsed per-message helpers live in
 * `socket.ts`, and engine/socket side effects are injected from `game-do.ts`.
 */

import {
  ErrorCode,
  type GameState,
  type PlayerId,
} from '../../shared/types/domain';
import type { C2S, S2C } from '../../shared/types/protocol';
import type { AuxMessage, GameStateActionMessage } from './actions';
import { isDurableObjectCodeUpdateError } from './code-update';
import { DISCONNECT_GRACE_MS } from './session';
import { applySocketRateLimit, parseClientSocketMessage } from './socket';

export type GameDoWebSocketMessageDeps = {
  msgRates: WeakMap<WebSocket, { count: number; windowStart: number }>;
  getPlayerId: (ws: WebSocket) => PlayerId | null;
  isSpectatorSocket: (ws: WebSocket) => boolean;
  touchInactivity: () => Promise<void>;
  send: (ws: WebSocket, msg: S2C) => void;
  isGameStateActionMessage: (message: C2S) => message is GameStateActionMessage;
  dispatchGameStateAction: (
    playerId: PlayerId,
    ws: WebSocket,
    msg: GameStateActionMessage,
  ) => Promise<void>;
  dispatchAuxMessage: (
    ws: WebSocket,
    playerId: PlayerId,
    msg: AuxMessage,
  ) => Promise<void>;
};

const sendInvalidSocketMessageError = (
  deps: Pick<GameDoWebSocketMessageDeps, 'send'>,
  ws: WebSocket,
  message: string,
): void => {
  deps.send(ws, {
    type: 'error',
    message,
    code: ErrorCode.INVALID_INPUT,
  });
};

const handleSpectatorSocketMessage = async (
  deps: Pick<
    GameDoWebSocketMessageDeps,
    'isSpectatorSocket' | 'touchInactivity' | 'send'
  >,
  ws: WebSocket,
  msg: C2S,
): Promise<void> => {
  if (!deps.isSpectatorSocket(ws) || msg.type !== 'ping') {
    return;
  }

  await deps.touchInactivity();
  deps.send(ws, { type: 'pong', t: msg.t });
};

const dispatchPlayerSocketMessage = async (
  deps: Pick<
    GameDoWebSocketMessageDeps,
    | 'touchInactivity'
    | 'isGameStateActionMessage'
    | 'dispatchGameStateAction'
    | 'dispatchAuxMessage'
  >,
  ws: WebSocket,
  playerId: PlayerId,
  msg: C2S,
): Promise<void> => {
  await deps.touchInactivity();

  if (deps.isGameStateActionMessage(msg)) {
    await deps.dispatchGameStateAction(playerId, ws, msg);
    return;
  }

  await deps.dispatchAuxMessage(ws, playerId, msg);
};

export const handleGameDoWebSocketMessage = async (
  deps: GameDoWebSocketMessageDeps,
  ws: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> => {
  if (typeof message !== 'string') return;

  if (!applySocketRateLimit(ws, Date.now(), deps.msgRates)) {
    return;
  }

  const parsed = parseClientSocketMessage(message);

  if (!parsed.ok) {
    sendInvalidSocketMessageError(deps, ws, parsed.error);
    return;
  }

  const msg: C2S = parsed.value;
  const playerId = deps.getPlayerId(ws);

  if (playerId === null) {
    await handleSpectatorSocketMessage(deps, ws, msg);
    return;
  }

  try {
    await dispatchPlayerSocketMessage(deps, ws, playerId, msg);
  } catch (error) {
    if (isDurableObjectCodeUpdateError(error)) {
      throw error;
    }
    console.error('Unhandled websocket message error', error);
    // Preserve known error codes (auth, rate-limit, invalid input) when a
    // dispatcher threw a tagged error. Collapsing everything to
    // STATE_CONFLICT makes "someone else acted" toasts fire on totally
    // unrelated failures; the client can't offer good guidance without
    // seeing the real code.
    const code = extractErrorCode(error) ?? ErrorCode.STATE_CONFLICT;
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Internal server error';
    deps.send(ws, {
      type: 'error',
      message,
      code,
    });
  }
};

// Minimal helper: if a handler deeper in the stack throws an Error enriched
// with a `code` that matches one of the protocol ErrorCode values, surface
// it. Anything else falls back to the caller's default.
const extractErrorCode = (error: unknown): ErrorCode | null => {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  const values = Object.values(ErrorCode) as string[];
  return values.includes(code) ? (code as ErrorCode) : null;
};

export type GameDoWebSocketCloseDeps = {
  consumeReplacedSocket: (ws: WebSocket) => boolean;
  getPlayerId: (ws: WebSocket) => PlayerId | null;
  getCurrentGameState: () => Promise<GameState | null>;
  shouldTrackDisconnectForPlayer: (playerId: PlayerId) => Promise<boolean>;
  setDisconnectMarker: (playerId: PlayerId) => Promise<void>;
  broadcast: (msg: S2C) => void;
};

export const handleGameDoWebSocketClose = async (
  deps: GameDoWebSocketCloseDeps,
  ws: WebSocket,
): Promise<void> => {
  if (deps.consumeReplacedSocket(ws)) {
    return;
  }
  const playerId = deps.getPlayerId(ws);
  const gameState = await deps.getCurrentGameState();
  if (!gameState || gameState.phase === 'gameOver') {
    return;
  }
  if (playerId !== null) {
    if (!(await deps.shouldTrackDisconnectForPlayer(playerId))) {
      return;
    }
    await deps.setDisconnectMarker(playerId);
    deps.broadcast({
      type: 'opponentStatus',
      status: 'disconnected',
      graceDeadlineMs: Date.now() + DISCONNECT_GRACE_MS,
    });
  }
};
