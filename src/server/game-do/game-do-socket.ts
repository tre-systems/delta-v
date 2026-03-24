import { validateClientMessage } from '../../shared/protocol';
import type { C2S, S2C } from '../../shared/types/protocol';

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

export const parseClientSocketMessage = (
  message: string,
): { ok: true; value: C2S } | { ok: false; error: string } => {
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

interface AuxMessageDeps {
  ws: WebSocket;
  playerId: number;
  msg: Exclude<
    C2S,
    {
      type:
        | 'fleetReady'
        | 'astrogation'
        | 'surrender'
        | 'ordnance'
        | 'emplaceBase'
        | 'skipOrdnance'
        | 'beginCombat'
        | 'combat'
        | 'skipCombat'
        | 'logistics'
        | 'skipLogistics';
    }
  >;
  lastChatAt: Map<number, number>;
  send: (ws: WebSocket, msg: S2C) => void;
  broadcast: (msg: S2C) => void;
  handleRematch: (playerId: number, ws: WebSocket) => Promise<void>;
}

export const handleAuxMessage = async (deps: AuxMessageDeps): Promise<void> => {
  const { msg, playerId, ws } = deps;

  switch (msg.type) {
    case 'rematch':
      await deps.handleRematch(playerId, ws);
      return;
    case 'chat': {
      const chatTime = Date.now();
      const last = deps.lastChatAt.get(playerId) ?? 0;

      if (chatTime - last < CHAT_RATE_LIMIT_MS) {
        return;
      }
      deps.lastChatAt.set(playerId, chatTime);
      deps.broadcast({
        type: 'chat',
        playerId,
        text: msg.text,
      });
      return;
    }
    case 'ping':
      deps.send(ws, { type: 'pong', t: msg.t });
      return;
  }
};
