/**
 * Parsed WebSocket message helpers used after the DO lifecycle entrypoints.
 * `ws.ts` owns the hibernation callbacks; this module owns validation,
 * per-socket throttling, and the aux-message dispatch table.
 */

import { validateClientMessage } from '../../shared/protocol';
import type { PlayerId, Result } from '../../shared/types/domain';
import type { C2S, S2C } from '../../shared/types/protocol';
import type { AuxMessage } from './actions';

export const WS_MSG_RATE_LIMIT = 10;
export const WS_MSG_RATE_WINDOW_MS = 1_000;
export const CHAT_RATE_LIMIT_MS = 500;

interface RateWindow {
  count: number;
  windowStart: number;
}

export const applySocketRateLimit = (
  ws: WebSocket,
  now: number,
  msgRates: WeakMap<WebSocket, RateWindow>,
): boolean => {
  const rate = msgRates.get(ws);

  if (rate && now - rate.windowStart < WS_MSG_RATE_WINDOW_MS) {
    rate.count++;

    if (rate.count > WS_MSG_RATE_LIMIT) {
      try {
        ws.close(1008, 'Rate limit exceeded');
      } catch {}
      return false;
    }
    return true;
  }

  msgRates.set(ws, {
    count: 1,
    windowStart: now,
  });
  return true;
};

export const parseClientSocketMessage = (message: string): Result<C2S> => {
  let raw: unknown;
  try {
    raw = JSON.parse(message);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }

  const parsed = validateClientMessage(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, value: parsed.value };
};

export interface AuxMessageDeps {
  ws: WebSocket;
  playerId: PlayerId;
  msg: AuxMessage;
  lastChatAt: Map<number, number>;
  send: (ws: WebSocket, msg: S2C) => void;
  broadcast: (msg: S2C) => void;
  handleRematch: (playerId: PlayerId, ws: WebSocket) => Promise<void>;
}

const AUX_MESSAGE_HANDLERS = {
  rematch: async (
    deps: AuxMessageDeps & { msg: Extract<AuxMessage, { type: 'rematch' }> },
  ) => {
    await deps.handleRematch(deps.playerId, deps.ws);
  },
  chat: (
    deps: AuxMessageDeps & { msg: Extract<AuxMessage, { type: 'chat' }> },
  ) => {
    const chatTime = Date.now();
    const last = deps.lastChatAt.get(deps.playerId) ?? 0;

    if (chatTime - last < CHAT_RATE_LIMIT_MS) {
      return;
    }

    deps.lastChatAt.set(deps.playerId, chatTime);
    deps.broadcast({
      type: 'chat',
      playerId: deps.playerId,
      text: deps.msg.text,
    });
  },
  ping: (
    deps: AuxMessageDeps & { msg: Extract<AuxMessage, { type: 'ping' }> },
  ) => {
    deps.send(deps.ws, { type: 'pong', t: deps.msg.t });
  },
} satisfies {
  [T in AuxMessage['type']]: (
    deps: AuxMessageDeps & { msg: Extract<AuxMessage, { type: T }> },
  ) => Promise<void> | void;
};

export const dispatchAuxMessage = async (
  deps: AuxMessageDeps,
): Promise<void> => {
  const handler = AUX_MESSAGE_HANDLERS[deps.msg.type] as (
    deps: AuxMessageDeps,
  ) => Promise<void> | void;

  await handler(deps);
};
