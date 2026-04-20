import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applySocketRateLimit,
  CHAT_RATE_LIMIT_MS,
  dispatchAuxMessage,
  parseClientSocketMessage,
  WS_MAX_MESSAGE_BYTES,
  WS_MSG_RATE_LIMIT,
} from './socket';

const createSocketStub = () =>
  ({
    close: vi.fn(),
  }) as unknown as WebSocket;

describe('socket helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses validated client messages and rejects invalid JSON', () => {
    expect(
      parseClientSocketMessage(JSON.stringify({ type: 'ping', t: 42 })),
    ).toEqual({
      ok: true,
      value: { type: 'ping', t: 42 },
    });

    expect(parseClientSocketMessage('{bad json')).toEqual({
      ok: false,
      error: 'Invalid JSON',
    });
  });

  it('rejects oversized websocket frames before JSON parsing', () => {
    const oversized = 'x'.repeat(WS_MAX_MESSAGE_BYTES + 1);
    expect(parseClientSocketMessage(oversized)).toEqual({
      ok: false,
      error: `Message exceeds the ${WS_MAX_MESSAGE_BYTES}-byte limit`,
    });
  });

  it('closes sockets that exceed the per-window message rate limit', () => {
    const ws = createSocketStub();
    const msgRates = new WeakMap<
      WebSocket,
      { count: number; windowStart: number }
    >();

    for (let attempt = 0; attempt < WS_MSG_RATE_LIMIT; attempt++) {
      expect(applySocketRateLimit(ws, 1_000, msgRates)).toBe(true);
    }

    expect(applySocketRateLimit(ws, 1_000, msgRates)).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
  });

  it('dispatches rematch and ping aux messages directly', async () => {
    const ws = createSocketStub();
    const handleRematch = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();

    await dispatchAuxMessage({
      ws,
      playerId: 1,
      msg: { type: 'rematch' },
      lastChatAt: new Map(),
      send,
      broadcast: vi.fn(),
      handleRematch,
    });

    expect(handleRematch).toHaveBeenCalledWith(1, ws);

    await dispatchAuxMessage({
      ws,
      playerId: 1,
      msg: { type: 'ping', t: 99 },
      lastChatAt: new Map(),
      send,
      broadcast: vi.fn(),
      handleRematch,
    });

    expect(send).toHaveBeenCalledWith(ws, { type: 'pong', t: 99 });
  });

  it('throttles repeated chat messages per player', async () => {
    const ws = createSocketStub();
    const broadcast = vi.fn();
    const lastChatAt = new Map<number, number>();

    vi.setSystemTime(1_000);
    await dispatchAuxMessage({
      ws,
      playerId: 0,
      msg: { type: 'chat', text: 'first' },
      lastChatAt,
      send: vi.fn(),
      broadcast,
      handleRematch: vi.fn(),
    });

    vi.setSystemTime(1_000 + CHAT_RATE_LIMIT_MS - 1);
    await dispatchAuxMessage({
      ws,
      playerId: 0,
      msg: { type: 'chat', text: 'blocked' },
      lastChatAt,
      send: vi.fn(),
      broadcast,
      handleRematch: vi.fn(),
    });

    vi.setSystemTime(1_000 + CHAT_RATE_LIMIT_MS);
    await dispatchAuxMessage({
      ws,
      playerId: 0,
      msg: { type: 'chat', text: 'allowed' },
      lastChatAt,
      send: vi.fn(),
      broadcast,
      handleRematch: vi.fn(),
    });

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenNthCalledWith(1, {
      type: 'chat',
      playerId: 0,
      text: 'first',
    });
    expect(broadcast).toHaveBeenNthCalledWith(2, {
      type: 'chat',
      playerId: 0,
      text: 'allowed',
    });
  });

  it('intercepts /coach chats via handleCoach and skips broadcast', async () => {
    const ws = createSocketStub();
    const broadcast = vi.fn();
    const handleCoach = vi.fn().mockResolvedValue(true);

    await dispatchAuxMessage({
      ws,
      playerId: 0,
      msg: { type: 'chat', text: '/coach press the attack' },
      lastChatAt: new Map(),
      send: vi.fn(),
      broadcast,
      handleRematch: vi.fn(),
      handleCoach,
    });

    expect(handleCoach).toHaveBeenCalledWith(0, '/coach press the attack');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('falls through to broadcast when handleCoach says it did not handle', async () => {
    const ws = createSocketStub();
    const broadcast = vi.fn();
    const handleCoach = vi.fn().mockResolvedValue(false);

    await dispatchAuxMessage({
      ws,
      playerId: 0,
      msg: { type: 'chat', text: 'normal chat' },
      lastChatAt: new Map(),
      send: vi.fn(),
      broadcast,
      handleRematch: vi.fn(),
      handleCoach,
    });

    expect(handleCoach).toHaveBeenCalledWith(0, 'normal chat');
    expect(broadcast).toHaveBeenCalledWith({
      type: 'chat',
      playerId: 0,
      text: 'normal chat',
    });
  });
});
