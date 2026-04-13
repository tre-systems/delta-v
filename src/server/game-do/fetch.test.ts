import { describe, expect, it, vi } from 'vitest';

import type { GameDoFetchDeps } from './fetch';
import { handleGameDoFetch } from './fetch';

const baseUrl = 'https://do.test';

const makeDeps = (
  overrides: Partial<GameDoFetchDeps> = {},
): GameDoFetchDeps => ({
  handleInit: vi
    .fn()
    .mockResolvedValue(new Response('init-body', { status: 200 })),
  handleJoinCheck: vi
    .fn()
    .mockResolvedValue(new Response('join-body', { status: 200 })),
  handleReplayRequest: vi
    .fn()
    .mockResolvedValue(new Response('replay-body', { status: 200 })),
  resolveJoinAttempt: vi.fn().mockResolvedValue({
    ok: false,
    response: new Response('fail', { status: 400 }),
  }),
  getConnectedSeatCountAfterJoin: vi.fn(),
  isAgentSeat: vi.fn().mockResolvedValue(false),
  saveRoomConfig: vi.fn(),
  clearDisconnectMarker: vi.fn(),
  replacePlayerSockets: vi.fn(),
  send: vi.fn(),
  broadcast: vi.fn(),
  getLatestGameId: vi.fn(),
  storage: {} as DurableObjectStorage,
  initGame: vi.fn(),
  touchInactivity: vi.fn(),
  acceptWebSocket: vi.fn(),
  getRoomConfig: vi.fn().mockResolvedValue(null),
  ...overrides,
});

describe('handleGameDoFetch', () => {
  it('delegates POST /init to handleInit', async () => {
    const deps = makeDeps();
    const req = new Request(`${baseUrl}/init`, { method: 'POST' });
    const res = await handleGameDoFetch(deps, req);
    expect(deps.handleInit).toHaveBeenCalledWith(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('init-body');
    expect(deps.handleJoinCheck).not.toHaveBeenCalled();
  });

  it('delegates GET /join to handleJoinCheck', async () => {
    const deps = makeDeps();
    const req = new Request(`${baseUrl}/join`, { method: 'GET' });
    const res = await handleGameDoFetch(deps, req);
    expect(deps.handleJoinCheck).toHaveBeenCalledWith(req);
    expect(await res.text()).toBe('join-body');
  });

  it('delegates GET /replay to handleReplayRequest', async () => {
    const deps = makeDeps();
    const req = new Request(`${baseUrl}/replay`, { method: 'GET' });
    const res = await handleGameDoFetch(deps, req);
    expect(deps.handleReplayRequest).toHaveBeenCalledWith(req);
    expect(await res.text()).toBe('replay-body');
  });

  it('returns 426 when Upgrade is not websocket', async () => {
    const deps = makeDeps();
    const req = new Request(`${baseUrl}/other`, { method: 'GET' });
    const res = await handleGameDoFetch(deps, req);
    expect(res.status).toBe(426);
    expect(await res.text()).toBe('Expected WebSocket');
    expect(deps.resolveJoinAttempt).not.toHaveBeenCalled();
  });

  it('returns 404 for spectator websocket joins when the room is missing', async () => {
    const deps = makeDeps({
      getRoomConfig: vi.fn().mockResolvedValue(null),
    });
    const req = new Request(`${baseUrl}/ws?viewer=spectator`, {
      headers: { Upgrade: 'websocket' },
    });
    const res = await handleGameDoFetch(deps, req);
    expect(res.status).toBe(404);
    expect(deps.resolveJoinAttempt).not.toHaveBeenCalled();
  });
});
