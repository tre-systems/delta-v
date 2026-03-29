import type { GameState, PlayerId } from '../../shared/types/domain';
import type { C2S, S2C } from '../../shared/types/protocol';
import type { GameStateActionMessage } from './actions';
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
    msg: C2S,
  ) => Promise<void>;
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
    deps.send(ws, {
      type: 'error',
      message: parsed.error,
    });
    return;
  }
  const msg: C2S = parsed.value;
  const playerId = deps.getPlayerId(ws);

  if (playerId === null) {
    if (deps.isSpectatorSocket(ws) && msg.type === 'ping') {
      await deps.touchInactivity();
      deps.send(ws, { type: 'pong', t: msg.t });
    }
    return;
  }
  await deps.touchInactivity();
  try {
    if (deps.isGameStateActionMessage(msg)) {
      await deps.dispatchGameStateAction(playerId, ws, msg);
      return;
    }
    await deps.dispatchAuxMessage(ws, playerId, msg);
  } catch (error) {
    console.error('Unhandled websocket message error', error);
    deps.send(ws, {
      type: 'error',
      message: 'Internal server error',
    });
  }
};

export type GameDoWebSocketCloseDeps = {
  consumeReplacedSocket: (ws: WebSocket) => boolean;
  getPlayerId: (ws: WebSocket) => PlayerId | null;
  getCurrentGameState: () => Promise<GameState | null>;
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
    await deps.setDisconnectMarker(playerId);
    deps.broadcast({
      type: 'opponentStatus',
      status: 'disconnected',
      graceDeadlineMs: Date.now() + DISCONNECT_GRACE_MS,
    });
  }
};
