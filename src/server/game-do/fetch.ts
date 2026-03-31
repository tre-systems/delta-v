import type { GameState, Result } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { generatePlayerToken, type RoomConfig } from '../protocol';
import { getProjectedCurrentState } from './archive';
import type { JoinAttemptSuccess } from './http-handlers';
import { shouldClearDisconnectMarker } from './session';

export type GameDoFetchDeps = {
  handleInit: (request: Request) => Promise<Response>;
  handleJoinCheck: (request: Request) => Promise<Response>;
  handleReplayRequest: (request: Request) => Promise<Response>;
  resolveJoinAttempt: (
    presentedTokenRaw: string | null,
  ) => Promise<Result<JoinAttemptSuccess, Response>>;
  getConnectedSeatCountAfterJoin: (
    seatOpen: [boolean, boolean],
    playerId: 0 | 1,
  ) => number;
  saveRoomConfig: (roomConfig: RoomConfig) => Promise<void>;
  clearDisconnectMarker: () => Promise<void>;
  replacePlayerSockets: (playerId: 0 | 1) => void;
  send: (ws: WebSocket, msg: S2C) => void;
  broadcast: (msg: S2C) => void;
  getLatestGameId: () => Promise<string | null>;
  storage: DurableObjectStorage;
  initGame: () => Promise<void>;
  touchInactivity: () => Promise<void>;
  acceptWebSocket: (server: WebSocket, tags: string[]) => void;
  getRoomConfig: () => Promise<RoomConfig | null>;
};

export const handleGameDoFetch = async (
  deps: GameDoFetchDeps,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === '/init' && request.method === 'POST') {
    return deps.handleInit(request);
  }

  if (url.pathname === '/join' && request.method === 'GET') {
    return deps.handleJoinCheck(request);
  }

  if (url.pathname === '/replay' && request.method === 'GET') {
    return deps.handleReplayRequest(request);
  }
  const upgradeHeader = request.headers.get('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket', {
      status: 426,
    });
  }
  if (url.searchParams.get('viewer') === 'spectator') {
    const roomConfig = await deps.getRoomConfig();

    if (!roomConfig) {
      return new Response('Game not found', {
        status: 404,
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    deps.acceptWebSocket(server, ['spectator']);
    deps.send(server, {
      type: 'spectatorWelcome',
      code: roomConfig.code,
    });
    const latestGameId = await deps.getLatestGameId();
    const spectatorState: GameState | null = latestGameId
      ? await getProjectedCurrentState(deps.storage, latestGameId, 'spectator')
      : null;

    if (spectatorState) {
      deps.send(server, {
        type: 'gameStart',
        state: spectatorState,
      });
    }
    await deps.touchInactivity();
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  const presentedTokenRaw = url.searchParams.get('playerToken');
  const joinAttempt = await deps.resolveJoinAttempt(presentedTokenRaw);

  if (!joinAttempt.ok) {
    return joinAttempt.error;
  }
  const { roomConfig, playerId, issueNewToken, disconnectedPlayer, seatOpen } =
    joinAttempt.value;
  const connectedSeatCountAfterJoin = deps.getConnectedSeatCountAfterJoin(
    seatOpen,
    playerId,
  );

  if (issueNewToken) {
    roomConfig.playerTokens[playerId] = generatePlayerToken();
    await deps.saveRoomConfig(roomConfig);
  }
  const playerToken = roomConfig.playerTokens[playerId];

  if (!playerToken) {
    return new Response('Player token unavailable', {
      status: 500,
    });
  }

  if (shouldClearDisconnectMarker(disconnectedPlayer, playerId)) {
    await deps.clearDisconnectMarker();
    deps.broadcast({ type: 'opponentStatus', status: 'reconnected' });
  }
  deps.replacePlayerSockets(playerId);
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  deps.acceptWebSocket(server, [`player:${playerId}`]);
  deps.send(server, {
    type: 'welcome',
    playerId,
    code: roomConfig.code,
    playerToken,
  });
  const latestGameId = await deps.getLatestGameId();
  const reconnectState: GameState | null = latestGameId
    ? await getProjectedCurrentState(deps.storage, latestGameId, playerId)
    : null;

  if (reconnectState) {
    deps.send(server, {
      type: 'gameStart',
      state: reconnectState,
    });
  }
  if (!reconnectState && connectedSeatCountAfterJoin >= 2) {
    deps.broadcast({ type: 'matchFound' });
    await deps.initGame();
  }
  await deps.touchInactivity();
  return new Response(null, {
    status: 101,
    webSocket: client,
  });
};
