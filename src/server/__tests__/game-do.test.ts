import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: any;
    env: any;

    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { GameDO } from '../game-do';

class MockStorage {
  private data = new Map<string, unknown>();
  alarmAt: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async deleteAll(): Promise<void> {
    this.data.clear();
  }

  async setAlarm(value: number): Promise<void> {
    this.alarmAt = value;
  }
}

function createCtx() {
  const storage = new MockStorage();
  const sockets: any[] = [];
  const tags = new WeakMap<object, string[]>();

  return {
    storage,
    acceptWebSocket(ws: object, wsTags: string[]) {
      sockets.push(ws);
      tags.set(ws, wsTags);
    },
    getTags(ws: object) {
      return tags.get(ws) ?? [];
    },
    getWebSockets(tag?: string) {
      if (!tag) return sockets;
      return sockets.filter(ws => (tags.get(ws) ?? []).includes(tag));
    },
  };
}

describe('GameDO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes a room and schedules inactivity cleanup immediately', async () => {
    const ctx = createCtx();
    const game = new GameDO(ctx as any, {} as any);

    const response = await game.fetch(new Request('https://room.internal/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'ABCDE',
        scenario: 'escape',
        playerToken: 'A'.repeat(32),
        inviteToken: 'B'.repeat(32),
      }),
    }));

    expect(response.status).toBe(201);
    expect(await ctx.storage.get('gameCode')).toBe('ABCDE');
    expect(await ctx.storage.get('roomConfig')).toEqual({
      code: 'ABCDE',
      scenario: 'escape',
      playerTokens: ['A'.repeat(32), null],
      inviteTokens: [null, 'B'.repeat(32)],
    });

    const inactivityAt = await ctx.storage.get<number>('inactivityAt');
    expect(typeof inactivityAt).toBe('number');
    expect(inactivityAt!).toBeGreaterThan(Date.now());
    expect(ctx.storage.alarmAt).toBe(inactivityAt);
  });

  it('rejects websocket fetches for uninitialized rooms', async () => {
    const ctx = createCtx();
    const game = new GameDO(ctx as any, {} as any);

    const response = await game.fetch(new Request('https://room.internal/ws/ABCDE', {
      headers: { Upgrade: 'websocket' },
    }));

    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Game not found');
  });

  it('rejects malformed player tokens before websocket upgrade', async () => {
    const ctx = createCtx();
    await ctx.storage.put('roomConfig', {
      code: 'ABCDE',
      scenario: 'biplanetary',
      playerTokens: ['A'.repeat(32), null],
      inviteTokens: [null, 'B'.repeat(32)],
    });

    const game = new GameDO(ctx as any, {} as any);
    const response = await game.fetch(new Request('https://room.internal/ws/ABCDE?playerToken=bad-token', {
      headers: { Upgrade: 'websocket' },
    }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Invalid player token');
  });

  it('rejects malformed client payloads before dispatching handlers', async () => {
    const ctx = createCtx();
    const game = new GameDO(ctx as any, {} as any);
    const ws = {
      sent: [] as string[],
      send(payload: string) {
        this.sent.push(payload);
      },
    };

    await game.webSocketMessage(ws as any, JSON.stringify({ type: 'combat', attacks: null }));

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: 'error',
      message: 'Invalid combat payload',
    });
  });
});
