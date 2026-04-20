import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameState } from '../../shared/types/domain';
import type { GameDoFetchDeps } from './fetch';
import { handleGameDoFetch } from './fetch';

const archiveMocks = vi.hoisted(() => ({
  getProjectedCurrentState: vi.fn(),
}));

vi.mock('./archive', () => ({
  getProjectedCurrentState: archiveMocks.getProjectedCurrentState,
}));

const baseUrl = 'https://do.test';

const createSocket = () => ({
  sent: [] as string[],
  send(payload: string) {
    this.sent.push(payload);
  },
  close: vi.fn(),
});

const map = buildSolarSystemMap();

const createState = (): GameState =>
  createGameOrThrow(
    SCENARIOS.duel,
    map,
    asGameId('FETCH1'),
    findBaseHex,
    () => 0,
  );

const roomConfig = {
  code: 'ABCDE',
  scenario: 'duel',
  playerTokens: ['A'.repeat(32), 'B'.repeat(32)] as [
    string | null,
    string | null,
  ],
  players: [
    { playerKey: 'seat0', username: 'Player 1', kind: 'human' as const },
    { playerKey: 'agent_bot', username: 'Bot', kind: 'agent' as const },
  ] as const,
};

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
  handleMcpRequest: vi.fn().mockResolvedValue(null),
  resolveJoinAttempt: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      roomConfig: structuredClone(roomConfig),
      playerId: 0 as const,
      issueNewToken: false,
      disconnectedPlayer: null,
      seatOpen: [true, false] as [boolean, boolean],
    },
  }),
  getConnectedSeatCountAfterJoin: vi.fn().mockReturnValue(1),
  isAgentSeat: vi.fn().mockResolvedValue(false),
  saveRoomConfig: vi.fn(),
  clearDisconnectMarker: vi.fn(),
  replacePlayerSockets: vi.fn(),
  send: vi.fn(),
  broadcast: vi.fn(),
  getLatestGameId: vi.fn().mockResolvedValue(null),
  storage: {} as DurableObjectStorage,
  initGame: vi.fn(),
  touchInactivity: vi.fn(),
  acceptWebSocket: vi.fn(),
  getRoomConfig: vi.fn().mockResolvedValue(structuredClone(roomConfig)),
  getSpectatorCount: vi.fn().mockReturnValue(0),
  ...overrides,
});

describe('handleGameDoFetch additional coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    archiveMocks.getProjectedCurrentState.mockReset().mockResolvedValue(null);
    vi.stubGlobal('WebSocketPair', function WebSocketPairStub() {
      const client = createSocket();
      const server = createSocket();
      return { 0: client, 1: server };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the join failure response when seat resolution rejects', async () => {
    const deps = makeDeps({
      resolveJoinAttempt: vi.fn().mockResolvedValue({
        ok: false,
        error: new Response('fail', { status: 409 }),
      }),
    });

    const res = await handleGameDoFetch(
      deps,
      new Request(`${baseUrl}/ws`, {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(res.status).toBe(409);
    expect(await res.text()).toBe('fail');
  });

  it('accepts spectator sockets and sends projected state when available', async () => {
    const state = createState();
    archiveMocks.getProjectedCurrentState.mockResolvedValue(state);
    const deps = makeDeps({
      getLatestGameId: vi.fn().mockResolvedValue(asGameId('FETCH1')),
    });

    await expect(
      handleGameDoFetch(
        deps,
        new Request(`${baseUrl}/ws?viewer=spectator`, {
          headers: { Upgrade: 'websocket' },
        }),
      ),
    ).rejects.toThrow(/status/i);
    expect(deps.acceptWebSocket).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenNthCalledWith(1, expect.anything(), {
      type: 'spectatorWelcome',
      code: 'ABCDE',
    });
    expect(deps.send).toHaveBeenNthCalledWith(2, expect.anything(), {
      type: 'gameStart',
      state,
    });
    expect(deps.touchInactivity).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the resolved player token is unavailable', async () => {
    const deps = makeDeps({
      resolveJoinAttempt: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          roomConfig: {
            ...structuredClone(roomConfig),
            playerTokens: [null, 'B'.repeat(32)],
          },
          playerId: 0 as const,
          issueNewToken: false,
          disconnectedPlayer: null,
          seatOpen: [true, false] as [boolean, boolean],
        },
      }),
    });

    const res = await handleGameDoFetch(
      deps,
      new Request(`${baseUrl}/ws`, {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Player token unavailable');
  });

  it('reissues tokens, clears disconnect markers, and sends reconnect state', async () => {
    const state = createState();
    archiveMocks.getProjectedCurrentState.mockResolvedValue(state);
    const saveRoomConfig = vi.fn();
    const deps = makeDeps({
      saveRoomConfig,
      getLatestGameId: vi.fn().mockResolvedValue(asGameId('FETCH1')),
      resolveJoinAttempt: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          roomConfig: {
            ...structuredClone(roomConfig),
            playerTokens: [null, 'B'.repeat(32)],
          },
          playerId: 0 as const,
          issueNewToken: true,
          disconnectedPlayer: 0,
          seatOpen: [false, false] as [boolean, boolean],
        },
      }),
    });

    await expect(
      handleGameDoFetch(
        deps,
        new Request(`${baseUrl}/ws`, {
          headers: { Upgrade: 'websocket' },
        }),
      ),
    ).rejects.toThrow(/status/i);
    expect(saveRoomConfig).toHaveBeenCalledTimes(1);
    expect(deps.clearDisconnectMarker).toHaveBeenCalledTimes(1);
    expect(deps.broadcast).toHaveBeenCalledWith({
      type: 'opponentStatus',
      status: 'reconnected',
    });
    expect(deps.send).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        type: 'welcome',
        playerId: 0,
        code: 'ABCDE',
        playerToken: expect.any(String),
      }),
    );
    expect(deps.send).toHaveBeenNthCalledWith(2, expect.anything(), {
      type: 'gameStart',
      state,
    });
    expect(deps.initGame).not.toHaveBeenCalled();
  });

  it('starts the match immediately when the opponent seat is an agent', async () => {
    const deps = makeDeps({
      isAgentSeat: vi.fn().mockResolvedValue(true),
      resolveJoinAttempt: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          roomConfig: structuredClone(roomConfig),
          playerId: 0 as const,
          issueNewToken: false,
          disconnectedPlayer: null,
          seatOpen: [true, true] as [boolean, boolean],
        },
      }),
    });

    await expect(
      handleGameDoFetch(
        deps,
        new Request(`${baseUrl}/ws`, {
          headers: { Upgrade: 'websocket' },
        }),
      ),
    ).rejects.toThrow(/status/i);
    expect(deps.broadcast).toHaveBeenCalledWith({ type: 'matchFound' });
    expect(deps.initGame).toHaveBeenCalledTimes(1);
  });
});
