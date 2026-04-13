import { describe, expect, it, vi } from 'vitest';

import type { GameState } from '../../shared/types/domain';
import type { C2S } from '../../shared/types/protocol';
import type { GameStateActionMessage } from './actions';
import { handleGameDoWebSocketClose, handleGameDoWebSocketMessage } from './ws';

const neverGameStateAction = (_msg: C2S): _msg is GameStateActionMessage =>
  false;

describe('handleGameDoWebSocketClose', () => {
  it('does not set disconnect marker when socket was replaced', async () => {
    const setDisconnectMarker = vi.fn().mockResolvedValue(undefined);

    await handleGameDoWebSocketClose(
      {
        consumeReplacedSocket: () => true,
        getPlayerId: () => 0,
        getCurrentGameState: async () =>
          ({ phase: 'astrogation' }) as GameState,
        shouldTrackDisconnectForPlayer: async () => true,
        setDisconnectMarker,
        broadcast: vi.fn(),
      },
      {} as WebSocket,
    );

    expect(setDisconnectMarker).not.toHaveBeenCalled();
  });

  it('does not set disconnect marker when the socket has no player seat', async () => {
    const setDisconnectMarker = vi.fn().mockResolvedValue(undefined);

    await handleGameDoWebSocketClose(
      {
        consumeReplacedSocket: () => false,
        getPlayerId: () => null,
        getCurrentGameState: async () =>
          ({ phase: 'astrogation' }) as GameState,
        shouldTrackDisconnectForPlayer: async () => true,
        setDisconnectMarker,
        broadcast: vi.fn(),
      },
      {} as WebSocket,
    );

    expect(setDisconnectMarker).not.toHaveBeenCalled();
  });
});

describe('handleGameDoWebSocketMessage', () => {
  it('dispatches game-state actions for seated players', async () => {
    const dispatchGameStateAction = vi.fn().mockResolvedValue(undefined);
    const dispatchAuxMessage = vi.fn();
    const touchInactivity = vi.fn().mockResolvedValue(undefined);
    const ws = {} as WebSocket;

    await handleGameDoWebSocketMessage(
      {
        msgRates: new WeakMap(),
        getPlayerId: () => 0,
        isSpectatorSocket: () => false,
        touchInactivity,
        send: vi.fn(),
        isGameStateActionMessage: (msg): msg is GameStateActionMessage =>
          msg.type === 'skipCombat',
        dispatchGameStateAction,
        dispatchAuxMessage,
      },
      ws,
      JSON.stringify({ type: 'skipCombat' }),
    );

    expect(touchInactivity).toHaveBeenCalledTimes(1);
    expect(dispatchGameStateAction).toHaveBeenCalledWith(0, ws, {
      type: 'skipCombat',
    });
    expect(dispatchAuxMessage).not.toHaveBeenCalled();
  });

  it('sends invalid-input errors for malformed messages', async () => {
    const send = vi.fn();

    await handleGameDoWebSocketMessage(
      {
        msgRates: new WeakMap(),
        getPlayerId: () => 0,
        isSpectatorSocket: () => false,
        touchInactivity: vi.fn(),
        send,
        isGameStateActionMessage: neverGameStateAction,
        dispatchGameStateAction: vi.fn(),
        dispatchAuxMessage: vi.fn(),
      },
      {} as WebSocket,
      '{bad json',
    );

    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'error',
        code: 'INVALID_INPUT',
      }),
    );
  });

  it('replies to ping for spectator-tagged sockets', async () => {
    const send = vi.fn();
    const touchInactivity = vi.fn().mockResolvedValue(undefined);
    const msgRates = new WeakMap();

    await handleGameDoWebSocketMessage(
      {
        msgRates,
        getPlayerId: () => null,
        isSpectatorSocket: () => true,
        touchInactivity,
        send,
        isGameStateActionMessage: neverGameStateAction,
        dispatchGameStateAction: vi.fn(),
        dispatchAuxMessage: vi.fn(),
      },
      {} as WebSocket,
      JSON.stringify({ type: 'ping', t: 42 }),
    );

    expect(touchInactivity).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'pong', t: 42 }),
    );
  });

  it('ignores non-ping messages on spectator sockets', async () => {
    const send = vi.fn();
    const dispatchAuxMessage = vi.fn();

    await handleGameDoWebSocketMessage(
      {
        msgRates: new WeakMap(),
        getPlayerId: () => null,
        isSpectatorSocket: () => true,
        touchInactivity: vi.fn(),
        send,
        isGameStateActionMessage: neverGameStateAction,
        dispatchGameStateAction: vi.fn(),
        dispatchAuxMessage,
      },
      {} as WebSocket,
      JSON.stringify({ type: 'chat', text: 'hi' }),
    );

    expect(send).not.toHaveBeenCalled();
    expect(dispatchAuxMessage).not.toHaveBeenCalled();
  });
});
