import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import process from 'node:process';

import {
  McpServer,
  StdioServerTransport,
  z,
} from '@delta-v/mcp-adapter/runtime';
import WebSocket from 'ws';

import {
  type AgentTurnInput,
  buildLeaderboardAgentsResourceDocument,
  buildObservation,
  computeActionEffects,
  LEADERBOARD_AGENTS_URI,
  type LeaderboardAgentEntry,
  leaderboardAgentsResource,
  listRulesResources,
  normalizeQuickMatchServerUrl,
  pollQuickMatchTicket,
  queueForMatch,
  RULES_RESOURCE_MIME_TYPE,
  readRulesResourceText,
  shapeObservationState,
} from '../src/shared/agent';
import { patchTransportWithSerializedSends } from '../src/shared/mcp-stdio-serialized-send';
import type { GameState } from '../src/shared/types/domain';
import type { C2S, S2C } from '../src/shared/types/protocol';

const DEFAULT_SERVER_URL =
  process.env.SERVER_URL || 'https://delta-v.tre.systems';
const DEFAULT_SCENARIO = 'duel';
const MAX_EVENTS_PER_SESSION = 500;

// Timeout defaults for blocking tool calls. Extracted as constants so they're
// easy to tune and clearly documented rather than buried in handler code.
const WELCOME_TIMEOUT_MS = 10_000; // wait for playerId after WebSocket open
const WAIT_FOR_TURN_DEFAULT_MS = 30_000; // delta_v_wait_for_turn default
const ACTION_RESULT_DEFAULT_MS = 5_000; // delta_v_send_action waitForResult
const PING_INTERVAL_MS = 25_000; // keepalive ping to prevent proxy idle disconnects

type PlayerSeat = 0 | 1;

interface SessionEvent {
  id: number;
  receivedAt: number;
  message: S2C;
}

interface DeltaVSession {
  sessionId: string;
  createdAt: number;
  serverUrl: string;
  scenario: string;
  code: string;
  ticket: string;
  playerToken: string;
  ws: WebSocket;
  playerId: PlayerSeat | null;
  events: SessionEvent[];
  nextEventId: number;
  lastState: GameState | null;
  connectionStatus: 'connecting' | 'open' | 'closed';
  lastDisconnectAt: number | null;
  lastDisconnectReason: string | null;
  // Resolvers waiting for the next state-bearing S2C message.
  // Used by delta_v_wait_for_turn to avoid polling.
  stateWaiters: Array<() => void>;
}

const sessions = new Map<string, DeltaVSession>();

type SessionRefArgs = {
  sessionId?: string;
  matchToken?: string;
};

const asTextContent = (text: string): { type: 'text'; text: string } => ({
  type: 'text',
  text,
});

const MAX_EMBEDDED_JSON_CHARS = 25_000;
const toolOk = <T extends Record<string, unknown>>(
  text: string,
  structuredContent: T,
) => {
  // Cursor's MCP tool UI often shows only `content[0].text` to the LLM, while
  // `structuredContent` can be hidden. Embed a (bounded) JSON copy so agents
  // can still parse the observation/candidate actions.
  let jsonText: string | undefined;
  try {
    jsonText = JSON.stringify(structuredContent);
  } catch {
    // ignore
  }
  const embedded =
    jsonText && jsonText.length <= MAX_EMBEDDED_JSON_CHARS
      ? `${text}\n\nSTRUCTURED_RESULT_JSON:\n${jsonText}`
      : `${text}${
          jsonText
            ? `\n\nSTRUCTURED_RESULT_JSON (not embedded; ${jsonText.length} chars)`
            : ''
        }`;
  return {
    content: [asTextContent(embedded)],
    structuredContent,
  };
};

const shapeObservationForTool = (
  observation: AgentTurnInput,
  compactState: boolean | undefined,
): AgentTurnInput => shapeObservationState(observation, compactState, true);

const buildWsUrl = (
  serverUrl: string,
  code: string,
  playerToken: string,
): string => {
  const httpBase = normalizeQuickMatchServerUrl(serverUrl);
  const wsBase = httpBase.replace(/^http/, 'ws');
  return `${wsBase}/ws/${code}?playerToken=${encodeURIComponent(playerToken)}`;
};

const waitForOpen = async (ws: WebSocket): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      ws.off('open', onOpen);
      ws.off('error', onError);
    };
    ws.on('open', onOpen);
    ws.on('error', onError);
  });

const wakeStateWaiters = (session: DeltaVSession): void => {
  if (session.stateWaiters.length === 0) {
    return;
  }
  const waiters = session.stateWaiters;
  session.stateWaiters = [];
  for (const resolve of waiters) resolve();
};

const pushEvent = (session: DeltaVSession, message: S2C): void => {
  session.events.push({
    id: session.nextEventId,
    receivedAt: Date.now(),
    message,
  });
  session.nextEventId += 1;
  if (session.events.length > MAX_EVENTS_PER_SESSION) {
    session.events.shift();
  }

  let stateChanged = false;
  if (
    message.type === 'gameStart' ||
    message.type === 'movementResult' ||
    message.type === 'combatResult' ||
    message.type === 'combatSingleResult' ||
    message.type === 'stateUpdate' ||
    message.type === 'actionRejected'
  ) {
    session.lastState = message.state;
    stateChanged = true;
  }
  if (message.type === 'welcome') {
    session.playerId = message.playerId;
    stateChanged = true;
  }
  // gameOver does not carry state but is terminal; still wake waiters so
  // callers can exit their wait loop promptly.
  if (message.type === 'gameOver') {
    stateChanged = true;
  }
  // Protocol errors (e.g. INVALID_INPUT for unknown action types) do not
  // carry game state; still wake send_action / wait_for_turn waiters so
  // blocking tool calls resolve immediately.
  if (message.type === 'error') {
    stateChanged = true;
  }

  if (stateChanged) {
    wakeStateWaiters(session);
  }
};

// Returns true when the caller should decide and submit an action now.
//
// Triplanetary uses I-Go-You-Go turns: each player completes all phases
// (astrogation → ordnance → movement → combat → resupply) before the
// other player goes. Only fleetBuilding is truly simultaneous (both
// players submit purchases before the game starts). Astrogation and every
// later phase require state.activePlayer === playerId — same contract as
// `src/server/game-do/mcp-handlers.ts` so `delta_v_wait_for_turn` does not
// unblock with candidates for the wrong seat (NOT_YOUR_TURN on send).
const isActionable = (state: GameState, playerId: PlayerSeat): boolean => {
  switch (state.phase) {
    case 'waiting':
    case 'gameOver':
      return false;
    case 'fleetBuilding':
      return true;
    case 'astrogation':
    case 'ordnance':
    case 'combat':
    case 'logistics':
      return state.activePlayer === playerId;
    default: {
      const _exhaustive: never = state.phase;
      throw new Error(`Unhandled phase: ${_exhaustive}`);
    }
  }
};

// Wait for the next state-bearing S2C message or a timeout.
// Returns true if a state arrived, false on timeout.
const waitForNextState = async (
  session: DeltaVSession,
  timeoutMs: number,
): Promise<boolean> =>
  await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => settle(false), timeoutMs);
    session.stateWaiters.push(() => {
      clearTimeout(timer);
      settle(true);
    });
  });

const attachSessionListeners = (
  session: DeltaVSession,
  ws: WebSocket,
): void => {
  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const parsed = JSON.parse(raw.toString()) as S2C;
      pushEvent(session, parsed);
    } catch {
      // ignore non-JSON payloads
    }
  });

  // Keepalive: send protocol-level pings to prevent proxy/load-balancer
  // idle timeouts from killing the WebSocket (code 1006). The game server
  // responds with pong and resets its own inactivity timer.
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const ping: C2S = { type: 'ping', t: Date.now() };
        ws.send(JSON.stringify(ping));
      } catch {
        // send failure on a dying socket — close handler will clean up
      }
    }
  }, PING_INTERVAL_MS);

  const onClosed = (reason?: string): void => {
    clearInterval(pingInterval);
    // Ignore late close/error callbacks from a socket that has already been
    // replaced by delta_v_reconnect.
    if (session.ws !== ws) {
      return;
    }
    session.connectionStatus = 'closed';
    session.lastDisconnectAt = Date.now();
    session.lastDisconnectReason = reason ?? 'Socket closed';
    wakeStateWaiters(session);
  };

  ws.on('close', (_code: number, reason: Buffer) => {
    const text = reason.toString();
    onClosed(text.length > 0 ? text : 'Socket closed');
  });
  ws.on('error', (error: Error) => {
    onClosed(error.message || 'Socket error');
  });
};

const waitForWelcome = async (
  session: DeltaVSession,
  timeoutMs: number,
): Promise<void> => {
  const welcomeDeadline = Date.now() + timeoutMs;
  while (Date.now() < welcomeDeadline && session.playerId === null) {
    const remaining = welcomeDeadline - Date.now();
    const arrived = await waitForNextState(session, remaining);
    if (!arrived) break;
  }
  if (session.playerId === null) {
    throw new Error(
      `Timed out waiting for welcome/playerId on session ${session.sessionId}`,
    );
  }
};

const connectSessionSocket = async (
  session: DeltaVSession,
  options?: { awaitWelcome?: boolean },
): Promise<void> => {
  const ws = new WebSocket(
    buildWsUrl(session.serverUrl, session.code, session.playerToken),
  );
  session.ws = ws;
  session.connectionStatus = 'connecting';
  session.lastDisconnectAt = null;
  session.lastDisconnectReason = null;
  if (options?.awaitWelcome) {
    session.playerId = null;
  }
  attachSessionListeners(session, ws);
  await waitForOpen(ws);
  if (session.ws !== ws) {
    throw new Error(
      `Session ${session.sessionId} socket was replaced during connect`,
    );
  }
  session.connectionStatus = 'open';
  if (options?.awaitWelcome) {
    await waitForWelcome(session, WELCOME_TIMEOUT_MS);
  }
};

const getSessionOrThrow = (sessionId: string): DeltaVSession => {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown sessionId: ${sessionId}`);
  return session;
};

const resolveSessionIdOrThrow = ({ sessionId, matchToken }: SessionRefArgs) => {
  const resolved = sessionId ?? matchToken;
  if (!resolved) {
    throw new Error('Provide sessionId (local alias: matchToken).');
  }
  return resolved;
};

const inferSurrenderShipIds = (session: DeltaVSession, action: C2S): C2S => {
  if (action.type !== 'surrender' || action.shipIds !== undefined) {
    return action;
  }
  const { lastState, playerId } = session;
  if (!lastState || playerId === null) {
    throw new Error(
      'Cannot infer surrender shipIds before receiving state and playerId',
    );
  }
  const shipIds = lastState.ships
    .filter(
      (ship) =>
        ship.owner === playerId &&
        ship.lifecycle !== 'destroyed' &&
        ship.control !== 'captured' &&
        ship.control !== 'surrendered',
    )
    .map((ship) => ship.id);
  if (shipIds.length === 0) {
    throw new Error(
      'surrender requires shipIds (none could be inferred for this player)',
    );
  }
  return {
    ...action,
    shipIds,
  };
};

const server = new McpServer(
  {
    name: 'delta-v-mcp',
    version: '0.1.0',
  },
  {
    instructions:
      'Use this server to play Delta-V via quick match. Create a session, inspect state/events, send actions, and chat.',
  },
);

for (const resource of listRulesResources()) {
  server.registerResource(
    resource.name,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    },
    async () => ({
      contents: [
        {
          uri: resource.uri,
          mimeType: RULES_RESOURCE_MIME_TYPE,
          text: readRulesResourceText(resource.uri),
        },
      ],
    }),
  );
}

{
  const resource = leaderboardAgentsResource();
  server.registerResource(
    resource.name,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    },
    async () => {
      const response = await fetch(
        `${normalizeQuickMatchServerUrl(DEFAULT_SERVER_URL)}/api/leaderboard?limit=200&includeProvisional=true`,
      );
      if (!response.ok) {
        throw new Error(
          `Failed to load agent leaderboard resource: HTTP ${response.status}`,
        );
      }
      const body = (await response.json()) as {
        entries?: Array<{
          username: string;
          isAgent: boolean;
          rating: number;
          rd: number;
          gamesPlayed: number;
          provisional: boolean;
          lastPlayedAt: number | null;
        }>;
      };
      const entries: LeaderboardAgentEntry[] = (body.entries ?? [])
        .filter((entry) => entry.isAgent)
        .map((entry) => ({
          username: entry.username,
          rating: entry.rating,
          rd: entry.rd,
          gamesPlayed: entry.gamesPlayed,
          provisional: entry.provisional,
          lastPlayedAt: entry.lastPlayedAt,
        }));
      return {
        contents: [
          {
            uri: LEADERBOARD_AGENTS_URI,
            mimeType: RULES_RESOURCE_MIME_TYPE,
            text: JSON.stringify(
              buildLeaderboardAgentsResourceDocument(entries),
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// HTTP tool handler registry: maps tool names to their async handler
// functions so the HTTP endpoint can dispatch without MCP protocol overhead.
// biome-ignore lint/suspicious/noExplicitAny: handlers accept varied argument shapes
const httpHandlers = new Map<string, (args: any) => Promise<any>>();

// Intercept registerTool to also capture handlers for HTTP dispatch.
{
  const orig = server.registerTool.bind(server);
  // biome-ignore lint/suspicious/noExplicitAny: wrapping SDK generic
  const wrapped: any = (name: string, config: any, handler: any) => {
    if (typeof handler === 'function') httpHandlers.set(name, handler);
    return orig(name, config, handler);
  };
  server.registerTool = wrapped;
}

const QUICK_MATCH_CONNECT_SCHEMA = {
  serverUrl: z.string().optional(),
  scenario: z.string().optional(),
  username: z.string().min(2).max(20).optional(),
  playerKey: z.string().min(8).max(64).optional(),
  waitForOpponent: z.boolean().optional(),
  pollMs: z.number().int().min(200).max(10_000).optional(),
  timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
};

const QUICK_MATCH_PAIR_TICKETS_SCHEMA = {
  serverUrl: z.string().optional(),
  leftTicket: z.string().min(1),
  rightTicket: z.string().min(1),
  pollMs: z.number().int().min(200).max(10_000).optional(),
  timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
};

const createConnectedQuickMatchSession = async (args: {
  serverUrl: string;
  scenario: string;
  code: string;
  ticket: string;
  playerToken: string;
}): Promise<DeltaVSession> => {
  const sessionId = randomUUID();
  const session: DeltaVSession = {
    sessionId,
    createdAt: Date.now(),
    serverUrl: args.serverUrl,
    scenario: args.scenario,
    code: args.code,
    ticket: args.ticket,
    playerToken: args.playerToken,
    ws: null as unknown as WebSocket,
    playerId: null,
    events: [],
    nextEventId: 1,
    lastState: null,
    connectionStatus: 'connecting',
    lastDisconnectAt: null,
    lastDisconnectReason: null,
    stateWaiters: [],
  };
  sessions.set(sessionId, session);
  // Attach listeners before awaiting open so early welcome/state messages are not lost.
  await connectSessionSocket(session, { awaitWelcome: true });
  return session;
};

const handleQuickMatchConnect = async (args: {
  serverUrl?: string;
  scenario?: string;
  username?: string;
  playerKey?: string;
  waitForOpponent?: boolean;
  pollMs?: number;
  timeoutMs?: number;
}) => {
  const serverUrl = normalizeQuickMatchServerUrl(
    args.serverUrl ?? DEFAULT_SERVER_URL,
  );
  const scenario = args.scenario ?? DEFAULT_SCENARIO;
  const playerKey =
    args.playerKey ??
    `agent_mcp_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (!playerKey.startsWith('agent_')) {
    throw new Error('playerKey must start with "agent_"');
  }

  const matched = await queueForMatch({
    serverUrl,
    scenario,
    username: args.username ?? 'Agent',
    playerKey,
    waitForOpponent: args.waitForOpponent,
    pollMs: args.pollMs ?? 1000,
    timeoutMs: args.timeoutMs ?? 120_000,
  });

  if (matched.status === 'queued') {
    return toolOk(
      `Queued Delta-V ticket ${matched.ticket} for scenario ${matched.scenario}.`,
      {
        serverUrl,
        scenario: matched.scenario,
        ticket: matched.ticket,
        playerKey,
        status: 'queued',
        connected: false,
        sessionId: null,
        matchToken: null,
      },
    );
  }

  const session = await createConnectedQuickMatchSession({
    serverUrl,
    scenario,
    code: matched.code,
    ticket: matched.ticket,
    playerToken: matched.playerToken,
  });

  return toolOk(
    `Connected Delta-V session ${session.sessionId} (code ${matched.code}).`,
    {
      sessionId: session.sessionId,
      matchToken: session.sessionId,
      serverUrl,
      scenario,
      code: matched.code,
      ticket: matched.ticket,
      playerKey,
      connectionStatus: session.connectionStatus,
      connected: true,
    },
  );
};

server.registerTool(
  'delta_v_quick_match_connect',
  {
    description:
      'Queue for quick match, optionally return the ticket immediately with waitForOpponent=false, or wait for match and connect a player WebSocket session. Returns sessionId and matchToken (alias of sessionId) for local/hosted payload parity when connected. If the first actionable observation is still fleetBuilding, send fleetReady explicitly; the game only advances after both seats submit it.',
    inputSchema: QUICK_MATCH_CONNECT_SCHEMA,
  },
  handleQuickMatchConnect,
);

server.registerTool(
  'delta_v_pair_quick_match_tickets',
  {
    description:
      'Local-only dev helper: poll two queued quick-match tickets, verify they resolved into the same match, then connect both seats as local MCP sessions without using lobby URLs.',
    inputSchema: QUICK_MATCH_PAIR_TICKETS_SCHEMA,
  },
  async ({ serverUrl, leftTicket, rightTicket, pollMs, timeoutMs }) => {
    const resolvedServerUrl = normalizeQuickMatchServerUrl(
      serverUrl ?? DEFAULT_SERVER_URL,
    );
    const [leftMatch, rightMatch] = await Promise.all([
      pollQuickMatchTicket({
        serverUrl: resolvedServerUrl,
        ticket: leftTicket,
        pollMs: pollMs ?? 1000,
        timeoutMs: timeoutMs ?? 120_000,
      }),
      pollQuickMatchTicket({
        serverUrl: resolvedServerUrl,
        ticket: rightTicket,
        pollMs: pollMs ?? 1000,
        timeoutMs: timeoutMs ?? 120_000,
      }),
    ]);

    if (
      leftMatch.code !== rightMatch.code ||
      leftMatch.scenario !== rightMatch.scenario
    ) {
      throw new Error(
        `Quick-match tickets resolved to different matches: ${leftTicket} -> ${leftMatch.code}/${leftMatch.scenario}, ${rightTicket} -> ${rightMatch.code}/${rightMatch.scenario}.`,
      );
    }

    const [leftSession, rightSession] = await Promise.all([
      createConnectedQuickMatchSession({
        serverUrl: resolvedServerUrl,
        scenario: leftMatch.scenario,
        code: leftMatch.code,
        ticket: leftMatch.ticket,
        playerToken: leftMatch.playerToken,
      }),
      createConnectedQuickMatchSession({
        serverUrl: resolvedServerUrl,
        scenario: rightMatch.scenario,
        code: rightMatch.code,
        ticket: rightMatch.ticket,
        playerToken: rightMatch.playerToken,
      }),
    ]);

    return toolOk(
      `Connected paired Delta-V sessions ${leftSession.sessionId} and ${rightSession.sessionId} (code ${leftMatch.code}).`,
      {
        serverUrl: resolvedServerUrl,
        code: leftMatch.code,
        scenario: leftMatch.scenario,
        left: {
          ticket: leftMatch.ticket,
          sessionId: leftSession.sessionId,
          matchToken: leftSession.sessionId,
          connectionStatus: leftSession.connectionStatus,
          playerId: leftSession.playerId,
        },
        right: {
          ticket: rightMatch.ticket,
          sessionId: rightSession.sessionId,
          matchToken: rightSession.sessionId,
          connectionStatus: rightSession.connectionStatus,
          playerId: rightSession.playerId,
        },
      },
    );
  },
);

server.registerTool(
  'delta_v_quick_match',
  {
    description:
      'Alias for delta_v_quick_match_connect so local and hosted MCP share a quick-match entry point name and return shape.',
    inputSchema: QUICK_MATCH_CONNECT_SCHEMA,
  },
  handleQuickMatchConnect,
);

server.registerTool(
  'delta_v_list_sessions',
  {
    description: 'List active Delta-V MCP sessions.',
  },
  async () =>
    toolOk('Listed active Delta-V sessions.', {
      sessions: [...sessions.values()].map((session) => ({
        sessionId: session.sessionId,
        matchToken: session.sessionId,
        code: session.code,
        scenario: session.scenario,
        serverUrl: session.serverUrl,
        playerId: session.playerId,
        connectionStatus: session.connectionStatus,
        lastDisconnectAt: session.lastDisconnectAt,
        lastDisconnectReason: session.lastDisconnectReason,
        eventsBuffered: session.events.length,
        currentPhase: session.lastState?.phase ?? null,
        turnNumber: session.lastState?.turnNumber ?? null,
      })),
    }),
);

server.registerTool(
  'delta_v_get_state',
  {
    description:
      'Get latest known game state for a local MCP session (sessionId; alias: matchToken).',
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
    },
  },
  async ({ sessionId, matchToken }) => {
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);
    return toolOk(`State for session ${resolvedSessionId}.`, {
      sessionId: session.sessionId,
      matchToken: session.sessionId,
      code: session.code,
      playerId: session.playerId,
      connectionStatus: session.connectionStatus,
      lastDisconnectAt: session.lastDisconnectAt,
      lastDisconnectReason: session.lastDisconnectReason,
      state: session.lastState,
      eventsBuffered: session.events.length,
      latestEventId: session.events.at(-1)?.id ?? 0,
    });
  },
);

server.registerTool(
  'delta_v_get_observation',
  {
    description:
      'Get the unified agent observation for a session: candidates, legal-action metadata, prose summary, and recommendedIndex. Matches the AgentTurnInput shape sent by the stdin/HTTP bridge so the same agent code works via either path. Local MCP defaults to compact state (phase/turn/activePlayer only); pass compactState=false to include the full GameState. Opt-in v2 enrichments (tactical features, ASCII spatial grid, labeled candidates with risk) cost extra tokens but help LLM agents reason without re-deriving geometry.',
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
      includeSummary: z.boolean().optional(),
      includeLegalActionInfo: z.boolean().optional(),
      includeTactical: z.boolean().optional(),
      includeSpatialGrid: z.boolean().optional(),
      includeCandidateLabels: z.boolean().optional(),
      /** Local MCP defaults to compact state. Pass false to force the full GameState. */
      compactState: z.boolean().optional(),
    },
  },
  async ({
    sessionId,
    matchToken,
    includeSummary,
    includeLegalActionInfo,
    includeTactical,
    includeSpatialGrid,
    includeCandidateLabels,
    compactState,
  }) => {
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);
    if (session.lastState === null) {
      throw new Error(
        `Session ${resolvedSessionId} has no state yet; wait for gameStart before requesting an observation.`,
      );
    }
    if (session.playerId === null) {
      throw new Error(
        `Session ${resolvedSessionId} has not received a welcome message yet; cannot build observation without a playerId.`,
      );
    }

    const observation = buildObservation(session.lastState, session.playerId, {
      gameCode: session.code,
      includeSummary,
      includeLegalActionInfo,
      includeTactical,
      includeSpatialGrid,
      includeCandidateLabels,
    });
    const out = shapeObservationForTool(observation, compactState);

    return toolOk(
      `Observation for session ${resolvedSessionId} (turn ${session.lastState.turnNumber}, phase ${session.lastState.phase}).`,
      {
        sessionId: session.sessionId,
        matchToken: session.sessionId,
        ...(out as unknown as Record<string, unknown>),
      },
    );
  },
);

server.registerTool(
  'delta_v_reconnect',
  {
    description:
      'Reconnect a local MCP session using its stored code/playerToken after a dropped WebSocket. Keeps the same sessionId and buffered events.',
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
    },
  },
  async ({ sessionId, matchToken }) => {
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);

    if (
      session.connectionStatus === 'open' &&
      session.ws.readyState === WebSocket.OPEN
    ) {
      return toolOk(`Session ${resolvedSessionId} is already connected.`, {
        sessionId: session.sessionId,
        matchToken: session.sessionId,
        code: session.code,
        playerId: session.playerId,
        connectionStatus: session.connectionStatus,
        lastDisconnectAt: session.lastDisconnectAt,
        lastDisconnectReason: session.lastDisconnectReason,
        reconnected: false,
      });
    }

    await connectSessionSocket(session);

    return toolOk(`Reconnected session ${resolvedSessionId}.`, {
      sessionId: session.sessionId,
      matchToken: session.sessionId,
      code: session.code,
      playerId: session.playerId,
      connectionStatus: session.connectionStatus,
      lastDisconnectAt: session.lastDisconnectAt,
      lastDisconnectReason: session.lastDisconnectReason,
      reconnected: true,
    });
  },
);

server.registerTool(
  'delta_v_wait_for_turn',
  {
    description:
      "Block until it is the caller's turn to act (fleetBuilding: both seats; every other phase including astrogation: state.activePlayer must match this seat), then return a fresh observation. Eliminates polling for MCP agents. If the returned observation is still fleetBuilding, the seat still needs to send fleetReady explicitly. Local MCP defaults to compact state (phase/turn/activePlayer only); pass compactState=false to include the full GameState. Respects a timeout (default 30s) and throws if the game reaches gameOver before becoming actionable. Supports the same v2 enrichment toggles as delta_v_get_observation.",
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
      timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
      includeSummary: z.boolean().optional(),
      includeLegalActionInfo: z.boolean().optional(),
      includeTactical: z.boolean().optional(),
      includeSpatialGrid: z.boolean().optional(),
      includeCandidateLabels: z.boolean().optional(),
      compactState: z.boolean().optional(),
    },
  },
  async ({
    sessionId,
    matchToken,
    timeoutMs,
    includeSummary,
    includeLegalActionInfo,
    includeTactical,
    includeSpatialGrid,
    includeCandidateLabels,
    compactState,
  }) => {
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);
    const deadline = Date.now() + (timeoutMs ?? WAIT_FOR_TURN_DEFAULT_MS);

    while (Date.now() < deadline) {
      const playerId = session.playerId;
      const state = session.lastState;
      if (state && playerId !== null) {
        if (state.phase === 'gameOver') {
          throw new Error(
            `Session ${resolvedSessionId} reached gameOver before becoming actionable.`,
          );
        }
        if (isActionable(state, playerId)) {
          const observation = buildObservation(state, playerId, {
            gameCode: session.code,
            includeSummary,
            includeLegalActionInfo,
            includeTactical,
            includeSpatialGrid,
            includeCandidateLabels,
          });
          const out = shapeObservationForTool(observation, compactState);
          return toolOk(
            `Actionable observation for session ${resolvedSessionId} (turn ${state.turnNumber}, phase ${state.phase}).`,
            {
              sessionId: session.sessionId,
              matchToken: session.sessionId,
              ...(out as unknown as Record<string, unknown>),
            },
          );
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const arrived = await waitForNextState(session, remaining);
      if (!arrived) break;
    }

    throw new Error(
      `wait_for_turn timed out on session ${resolvedSessionId} before it was actionable.`,
    );
  },
);

server.registerTool(
  'delta_v_get_events',
  {
    description: 'Read buffered server events for a session.',
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
      afterEventId: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      clear: z.boolean().optional(),
    },
  },
  async ({ sessionId, matchToken, afterEventId, limit, clear }) => {
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);
    const max = limit ?? 50;
    const filtered = session.events.filter((event) =>
      afterEventId === undefined ? true : event.id > afterEventId,
    );
    const selected = filtered.slice(-max);

    if (clear) {
      session.events = [];
    }

    return toolOk(
      `Returned ${selected.length} event(s) for ${resolvedSessionId}.`,
      {
        sessionId: session.sessionId,
        matchToken: session.sessionId,
        events: selected.map((event) => ({
          id: event.id,
          receivedAt: event.receivedAt,
          type: event.message.type,
          message: event.message,
        })),
        bufferedRemaining: session.events.length,
        latestEventId: session.nextEventId - 1,
      },
    );
  },
);

server.registerTool(
  'delta_v_send_action',
  {
    description:
      "Send a raw C2S game action for a session. ActionGuards are auto-filled from the session's current state unless autoGuards=false. When waitForResult=true (default false), blocks briefly for the next state-bearing S2C or actionRejected and returns an ActionResult with accepted, effects (visible deltas), turn/phase info, and optionally a fresh observation so agents can close the decision loop in one call. Local MCP nextObservation defaults to compact state; pass compactState=false to embed the full GameState.",
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
      action: z.object({ type: z.string() }).passthrough(),
      autoGuards: z.boolean().optional(),
      waitForResult: z.boolean().optional(),
      waitTimeoutMs: z.number().int().min(100).max(60_000).optional(),
      includeNextObservation: z.boolean().optional(),
      includeSummary: z.boolean().optional(),
      includeLegalActionInfo: z.boolean().optional(),
      includeTactical: z.boolean().optional(),
      includeSpatialGrid: z.boolean().optional(),
      includeCandidateLabels: z.boolean().optional(),
      compactState: z.boolean().optional(),
    },
  },
  async ({
    sessionId,
    matchToken,
    action,
    autoGuards,
    waitForResult,
    waitTimeoutMs,
    includeNextObservation,
    includeSummary,
    includeLegalActionInfo,
    includeTactical,
    includeSpatialGrid,
    includeCandidateLabels,
    compactState,
  }) => {
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);
    if (session.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `Session ${resolvedSessionId} socket is not open; call delta_v_reconnect first`,
      );
    }

    const shouldAutoGuard = autoGuards ?? true;
    const rawAction = inferSurrenderShipIds(session, action as C2S);
    const payload: C2S =
      shouldAutoGuard && session.lastState && !rawAction.guards
        ? ({
            ...rawAction,
            guards: {
              expectedTurn: session.lastState.turnNumber,
              expectedPhase: session.lastState.phase,
              idempotencyKey: `t${session.lastState.turnNumber}-${session.lastState.phase}-${randomUUID()}`,
            },
          } as C2S)
        : rawAction;

    const preState = session.lastState;
    const cursor = session.nextEventId;
    session.ws.send(JSON.stringify(payload));

    if (!waitForResult) {
      return toolOk(
        `Sent action ${action.type} on session ${resolvedSessionId}.`,
        {
          sessionId: session.sessionId,
          matchToken: session.sessionId,
          actionType: action.type,
          guarded: Boolean(payload.guards),
        },
      );
    }

    const deadline = Date.now() + (waitTimeoutMs ?? ACTION_RESULT_DEFAULT_MS);
    const buildObs = (
      state: GameState,
    ): Record<string, unknown> | undefined => {
      if (!includeNextObservation) return undefined;
      if (session.playerId === null) return undefined;
      const observation = buildObservation(state, session.playerId, {
        gameCode: session.code,
        includeSummary,
        includeLegalActionInfo,
        includeTactical,
        includeSpatialGrid,
        includeCandidateLabels,
      });
      return shapeObservationForTool(
        observation,
        compactState,
      ) as unknown as Record<string, unknown>;
    };

    while (Date.now() < deadline) {
      const acceptedEvent = session.events.find(
        (e) => e.id >= cursor && e.message.type === 'actionAccepted',
      );
      const guardStatus =
        acceptedEvent && acceptedEvent.message.type === 'actionAccepted'
          ? acceptedEvent.message.guardStatus
          : 'inSync';

      // Any actionRejected since submission dominates: report rejection.
      const rejectedEvent = session.events.find(
        (e) => e.id >= cursor && e.message.type === 'actionRejected',
      );
      if (rejectedEvent && rejectedEvent.message.type === 'actionRejected') {
        const msg = rejectedEvent.message;
        return toolOk(
          `Action ${action.type} rejected: ${msg.reason} — ${msg.message}`,
          {
            sessionId: session.sessionId,
            matchToken: session.sessionId,
            actionType: action.type,
            accepted: false,
            reason: msg.reason,
            message: msg.message,
            submitterPlayerId: msg.submitterPlayerId,
            expected: msg.expected,
            actual: msg.actual,
            idempotencyKey: msg.idempotencyKey,
            nextObservation: buildObs(msg.state),
          },
        );
      }

      const protocolError = session.events.find(
        (e) => e.id >= cursor && e.message.type === 'error',
      );
      if (protocolError && protocolError.message.type === 'error') {
        const msg = protocolError.message;
        return toolOk(`Action ${action.type} failed: ${msg.message}`, {
          sessionId: session.sessionId,
          matchToken: session.sessionId,
          actionType: action.type,
          accepted: false,
          reason: msg.code ?? 'ERROR',
          message: msg.message,
        });
      }

      const stateAdvanced = preState !== null && session.lastState !== preState;
      if (
        stateAdvanced &&
        preState &&
        session.lastState &&
        session.playerId !== null
      ) {
        const { effects, turnAdvanced, phaseChanged } = computeActionEffects(
          preState,
          session.lastState,
          session.playerId,
        );
        const autoSkipLikely =
          phaseChanged &&
          session.lastState.phase !== 'gameOver' &&
          session.lastState.activePlayer !== session.playerId;
        return toolOk(
          `Action ${action.type} accepted (${effects.length} visible effect${effects.length === 1 ? '' : 's'}).`,
          {
            sessionId: session.sessionId,
            matchToken: session.sessionId,
            actionType: action.type,
            accepted: true,
            guardStatus,
            turnApplied: preState.turnNumber,
            phaseApplied: preState.phase,
            nextTurn: session.lastState.turnNumber,
            nextPhase: session.lastState.phase,
            nextActivePlayer: session.lastState.activePlayer,
            autoSkipLikely,
            turnAdvanced,
            phaseChanged,
            effects,
            nextObservation: buildObs(session.lastState),
          },
        );
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await waitForNextState(session, remaining);
    }

    // Timed out without seeing a state transition. Common when both players
    // must submit before the phase advances (e.g. astrogation). The action
    // is still in flight; the caller can poll via wait_for_turn.
    const acceptedEvent = session.events.find(
      (e) => e.id >= cursor && e.message.type === 'actionAccepted',
    );
    const pendingGuardStatus =
      acceptedEvent && acceptedEvent.message.type === 'actionAccepted'
        ? acceptedEvent.message.guardStatus
        : 'inSync';

    return toolOk(
      `Sent action ${action.type} on session ${resolvedSessionId}; no state update within ${waitTimeoutMs ?? ACTION_RESULT_DEFAULT_MS}ms (still pending).`,
      {
        sessionId: session.sessionId,
        matchToken: session.sessionId,
        actionType: action.type,
        accepted: null,
        guardStatus: pendingGuardStatus,
        pending: true,
        guarded: Boolean(payload.guards),
      },
    );
  },
);

server.registerTool(
  'delta_v_send_chat',
  {
    description:
      'Send chat text in a Delta-V session. Canonical arg is `text`; `message` is accepted as an alias for agents that follow the more common chat-field naming.',
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
      text: z.string().min(1).max(200).optional(),
      message: z.string().min(1).max(200).optional(),
    },
  },
  async ({ sessionId, matchToken, text, message }) => {
    const chatText = text ?? message;
    if (!chatText) {
      throw new Error(
        'send_chat requires a non-empty `text` (alias: `message`).',
      );
    }
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);
    if (session.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `Session ${resolvedSessionId} socket is not open; call delta_v_reconnect first`,
      );
    }
    const action: C2S = { type: 'chat', text: chatText };
    session.ws.send(JSON.stringify(action));
    return toolOk(`Sent chat in session ${resolvedSessionId}.`, {
      sessionId: session.sessionId,
      matchToken: session.sessionId,
      text: chatText,
    });
  },
);

server.registerTool(
  'delta_v_close_session',
  {
    description: 'Close and remove a Delta-V session.',
    inputSchema: {
      sessionId: z.string().optional(),
      matchToken: z.string().optional(),
    },
  },
  async ({ sessionId, matchToken }) => {
    const resolvedSessionId = resolveSessionIdOrThrow({
      sessionId,
      matchToken,
    });
    const session = getSessionOrThrow(resolvedSessionId);
    try {
      session.ws.close(1000, 'Closed by MCP tool');
    } catch {
      // ignore close races on already-closed sockets
    }
    sessions.delete(session.sessionId);
    return toolOk(`Closed session ${resolvedSessionId}.`, {
      sessionId: session.sessionId,
      matchToken: session.sessionId,
      closed: true,
    });
  },
);

const DEFAULT_HTTP_PORT = 3939;

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });

const main = async (): Promise<void> => {
  const httpIdx = process.argv.indexOf('--http');
  if (httpIdx === -1) {
    // Default: stdio transport (backward compatible). Serialize outbound
    // JSON-RPC lines so concurrent tool completions cannot interleave writes.
    const transport = new StdioServerTransport();
    patchTransportWithSerializedSends(transport);
    await server.connect(transport);
    return;
  }

  // HTTP mode: lightweight JSON endpoint for concurrent multi-agent play.
  // Each request is independent: POST { tool, arguments } → { result }.
  // No MCP handshake needed — designed for local agent scripts.
  const portArg = process.argv[httpIdx + 1];
  const port =
    portArg && !portArg.startsWith('-') ? Number(portArg) : DEFAULT_HTTP_PORT;

  const httpServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }

    try {
      const body = JSON.parse(await readBody(req)) as {
        tool: string;
        arguments?: Record<string, unknown>;
      };
      const handler = httpHandlers.get(body.tool);
      if (!handler) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Unknown tool: ${body.tool}` }));
        return;
      }
      const result = await handler(body.arguments ?? {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.structuredContent ?? result));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  httpServer.listen(port, () => {
    process.stderr.write(
      `delta-v MCP server (HTTP) listening on http://127.0.0.1:${port}/\n`,
    );
  });
};

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
