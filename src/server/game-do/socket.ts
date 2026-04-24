/**
 * Parsed WebSocket message helpers used after the DO lifecycle entrypoints.
 * `ws.ts` owns the hibernation callbacks; this module owns validation,
 * per-socket throttling, and the aux-message dispatch table.
 */

import { validateClientMessage } from '../../shared/protocol';
import {
  ErrorCode,
  type PlayerId,
  type Result,
} from '../../shared/types/domain';
import type { C2S, S2C } from '../../shared/types/protocol';
import { isObject } from '../../shared/util';
import type { AuxMessage } from './actions';

export const WS_MSG_RATE_LIMIT = 10;
export const WS_MSG_RATE_WINDOW_MS = 1_000;
export const CHAT_RATE_LIMIT_MS = 500;
export const WS_MAX_MESSAGE_BYTES = 8 * 1024;

type SocketParseError = {
  message: string;
  code: ErrorCode;
};

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

const isUnknownMessageTypeError = (error: string): boolean =>
  error.startsWith('Unknown message type:');

const classifyValidatedClientMessageError = (
  raw: unknown,
  error: string,
): SocketParseError => {
  if (
    isObject(raw) &&
    raw.type === 'chat' &&
    typeof raw.text === 'string' &&
    raw.text.trim().length > 200
  ) {
    return {
      message: 'Chat message exceeds the 200-character limit',
      code: ErrorCode.CHAT_TOO_LONG,
    };
  }

  if (isUnknownMessageTypeError(error)) {
    return {
      message: error,
      code: ErrorCode.UNKNOWN_ACTION_TYPE,
    };
  }

  return {
    message: error,
    code: ErrorCode.INVALID_INPUT,
  };
};

export const parseClientSocketMessage = (
  message: string,
): Result<C2S, SocketParseError> => {
  if (message.length > WS_MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      error: {
        message: `Message exceeds the ${WS_MAX_MESSAGE_BYTES}-byte limit`,
        code: ErrorCode.INVALID_INPUT,
      },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(message);
  } catch {
    return {
      ok: false,
      error: {
        message: 'Invalid JSON',
        code: ErrorCode.MALFORMED_JSON,
      },
    };
  }

  const parsed = validateClientMessage(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      error: classifyValidatedClientMessageError(raw, parsed.error),
    };
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
  // Optional /coach interceptor: when the chat starts with "/coach ",
  // this fires instead of broadcasting. Returns true when handled (caller
  // must skip the normal broadcast). Optional so socket-only tests can
  // omit it.
  handleCoach?: (senderId: PlayerId, rawText: string) => Promise<boolean>;
}

const AUX_MESSAGE_HANDLERS = {
  rematch: async (
    deps: AuxMessageDeps & { msg: Extract<AuxMessage, { type: 'rematch' }> },
  ) => {
    await deps.handleRematch(deps.playerId, deps.ws);
  },
  chat: async (
    deps: AuxMessageDeps & { msg: Extract<AuxMessage, { type: 'chat' }> },
  ) => {
    const chatTime = Date.now();
    const last = deps.lastChatAt.get(deps.playerId) ?? 0;

    if (chatTime - last < CHAT_RATE_LIMIT_MS) {
      return;
    }

    deps.lastChatAt.set(deps.playerId, chatTime);

    // /coach <text> whispers: the directive is stored for the opposite
    // seat and NOT broadcast as normal chat. See src/server/game-do/coach.ts
    // for the rationale (preserves whisper semantics in agent-vs-agent
    // coached matches).
    if (deps.handleCoach) {
      const handled = await deps.handleCoach(deps.playerId, deps.msg.text);
      if (handled) return;
    }

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
