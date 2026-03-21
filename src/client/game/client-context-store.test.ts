import { describe, expect, it } from 'vitest';
import {
  applyWelcomeSession,
  resetReconnectAttempts,
  setAIDifficulty,
  setGameCode,
  setIsLocalGame,
  setLatencyMs,
  setPlayerId,
  setReconnectAttempts,
  setScenario,
  setTransport,
} from './client-context-store';
import type { GameTransport } from './transport';

describe('client-context-store', () => {
  it('applies welcome-session identity and clears reconnect attempts', () => {
    const ctx = {
      playerId: -1,
      gameCode: null as string | null,
      reconnectAttempts: 3,
    };

    applyWelcomeSession(ctx, 1, 'ABCDE');

    expect(ctx).toEqual({
      playerId: 1,
      gameCode: 'ABCDE',
      reconnectAttempts: 0,
    });
  });

  it('updates reconnect, transport, and latency runtime fields', () => {
    const transport = { kind: 'local' } as unknown as GameTransport;
    const ctx = {
      reconnectAttempts: 0,
      transport: null as GameTransport | null,
      latencyMs: -1,
    };

    setReconnectAttempts(ctx, 2);
    expect(ctx.reconnectAttempts).toBe(2);

    resetReconnectAttempts(ctx);
    expect(ctx.reconnectAttempts).toBe(0);

    setTransport(ctx, transport);
    expect(ctx.transport).toBe(transport);

    setLatencyMs(ctx, 123);
    expect(ctx.latencyMs).toBe(123);
  });

  it('updates scenario, local mode, difficulty, player, and room code', () => {
    const ctx = {
      scenario: 'biplanetary',
      isLocalGame: false,
      aiDifficulty: 'normal' as const,
      playerId: -1,
      gameCode: null as string | null,
    };

    setScenario(ctx, 'escape');
    setIsLocalGame(ctx, true);
    setAIDifficulty(ctx, 'hard');
    setPlayerId(ctx, 0);
    setGameCode(ctx, 'LOCAL');

    expect(ctx).toEqual({
      scenario: 'escape',
      isLocalGame: true,
      aiDifficulty: 'hard',
      playerId: 0,
      gameCode: 'LOCAL',
    });
  });
});
