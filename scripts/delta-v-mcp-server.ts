import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import WebSocket from 'ws';
import { z } from 'zod';

import { buildObservation, queueForMatch } from '../src/shared/agent';
import type { GameState } from '../src/shared/types/domain';
import type { C2S, S2C } from '../src/shared/types/protocol';

const DEFAULT_SERVER_URL =
  process.env.SERVER_URL || 'https://delta-v.tre.systems';
const DEFAULT_SCENARIO = 'duel';
const MAX_EVENTS_PER_SESSION = 500;

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
  // Resolvers waiting for the next state-bearing S2C message.
  // Used by delta_v_wait_for_turn to avoid polling.
  stateWaiters: Array<() => void>;
}

const sessions = new Map<string, DeltaVSession>();

const asTextContent = (text: string): { type: 'text'; text: string } => ({
  type: 'text',
  text,
});

const toolOk = <T>(text: string, structuredContent: T) => ({
  content: [asTextContent(text)],
  structuredContent,
});

const normalizeServerUrl = (raw: string): string => raw.replace(/\/+$/, '');

const buildWsUrl = (
  serverUrl: string,
  code: string,
  playerToken: string,
): string => {
  const wsBase = serverUrl.replace(/^http/, 'ws');
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
    message.type === 'stateUpdate'
  ) {
    session.lastState = message.state;
    stateChanged = true;
  }
  if (message.type === 'welcome') {
    session.playerId = message.playerId;
    stateChanged = true;
  }

  if (stateChanged && session.stateWaiters.length > 0) {
    const waiters = session.stateWaiters;
    session.stateWaiters = [];
    for (const resolve of waiters) resolve();
  }
};

// Returns true when the caller should decide and submit an action now:
//   - simultaneous phases (fleetBuilding, astrogation) are always actionable by both seats
//   - sequential phases are actionable only for the active player
//   - waiting / gameOver phases are never actionable
const isActionable = (state: GameState, playerId: PlayerSeat): boolean => {
  switch (state.phase) {
    case 'waiting':
    case 'gameOver':
      return false;
    case 'fleetBuilding':
    case 'astrogation':
      return true;
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

const attachSessionListeners = (session: DeltaVSession): void => {
  session.ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const parsed = JSON.parse(raw.toString()) as S2C;
      pushEvent(session, parsed);
    } catch {
      // ignore non-JSON payloads
    }
  });

  const onClosed = (): void => {
    sessions.delete(session.sessionId);
  };

  session.ws.on('close', onClosed);
  session.ws.on('error', onClosed);
};

const getSessionOrThrow = (sessionId: string): DeltaVSession => {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown sessionId: ${sessionId}`);
  return session;
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

server.registerTool(
  'delta_v_quick_match_connect',
  {
    description:
      'Queue for quick match, wait for match, and connect a player WebSocket session.',
    inputSchema: {
      serverUrl: z.string().optional(),
      scenario: z.string().optional(),
      username: z.string().min(2).max(20),
      playerKey: z.string().min(8).max(64).optional(),
      pollMs: z.number().int().min(200).max(10_000).optional(),
      timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
    },
  },
  async (args) => {
    const serverUrl = normalizeServerUrl(args.serverUrl ?? DEFAULT_SERVER_URL);
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
      username: args.username,
      playerKey,
      pollMs: args.pollMs ?? 1000,
      timeoutMs: args.timeoutMs ?? 120_000,
    });

    const sessionId = randomUUID();
    const wsUrl = buildWsUrl(serverUrl, matched.code, matched.playerToken);
    const ws = new WebSocket(wsUrl);
    const session: DeltaVSession = {
      sessionId,
      createdAt: Date.now(),
      serverUrl,
      scenario,
      code: matched.code,
      ticket: matched.ticket,
      playerToken: matched.playerToken,
      ws,
      playerId: null,
      events: [],
      nextEventId: 1,
      lastState: null,
      stateWaiters: [],
    };
    sessions.set(sessionId, session);
    // Attach listeners before awaiting open so early welcome/state messages are not lost.
    attachSessionListeners(session);
    await waitForOpen(ws);

    return toolOk(
      `Connected Delta-V session ${sessionId} (code ${matched.code}).`,
      {
        sessionId,
        serverUrl,
        scenario,
        code: matched.code,
        ticket: matched.ticket,
        playerKey,
        connected: true,
      },
    );
  },
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
        code: session.code,
        scenario: session.scenario,
        serverUrl: session.serverUrl,
        playerId: session.playerId,
        eventsBuffered: session.events.length,
        currentPhase: session.lastState?.phase ?? null,
        turnNumber: session.lastState?.turnNumber ?? null,
      })),
    }),
);

server.registerTool(
  'delta_v_get_state',
  {
    description: 'Get latest known game state for a session.',
    inputSchema: {
      sessionId: z.string(),
    },
  },
  async ({ sessionId }) => {
    const session = getSessionOrThrow(sessionId);
    return toolOk(`State for session ${sessionId}.`, {
      sessionId: session.sessionId,
      code: session.code,
      playerId: session.playerId,
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
      'Get the unified agent observation for a session: candidates, legal-action metadata, prose summary, and recommendedIndex. Matches the AgentTurnInput shape sent by the stdin/HTTP bridge so the same agent code works via either path.',
    inputSchema: {
      sessionId: z.string(),
      includeSummary: z.boolean().optional(),
      includeLegalActionInfo: z.boolean().optional(),
    },
  },
  async ({ sessionId, includeSummary, includeLegalActionInfo }) => {
    const session = getSessionOrThrow(sessionId);
    if (session.lastState === null) {
      throw new Error(
        `Session ${sessionId} has no state yet; wait for gameStart before requesting an observation.`,
      );
    }
    if (session.playerId === null) {
      throw new Error(
        `Session ${sessionId} has not received a welcome message yet; cannot build observation without a playerId.`,
      );
    }

    const observation = buildObservation(session.lastState, session.playerId, {
      gameCode: session.code,
      includeSummary,
      includeLegalActionInfo,
    });

    return toolOk(
      `Observation for session ${sessionId} (turn ${session.lastState.turnNumber}, phase ${session.lastState.phase}).`,
      { ...observation } as Record<string, unknown>,
    );
  },
);

server.registerTool(
  'delta_v_wait_for_turn',
  {
    description:
      "Block until it is the caller's turn to act (or the fleetBuilding/astrogation phase opens, which both seats can act in), then return a fresh observation. Eliminates polling for MCP agents. Respects a timeout (default 30s) and throws if the game reaches gameOver before becoming actionable.",
    inputSchema: {
      sessionId: z.string(),
      timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
      includeSummary: z.boolean().optional(),
      includeLegalActionInfo: z.boolean().optional(),
    },
  },
  async ({ sessionId, timeoutMs, includeSummary, includeLegalActionInfo }) => {
    const session = getSessionOrThrow(sessionId);
    const deadline = Date.now() + (timeoutMs ?? 30_000);

    while (Date.now() < deadline) {
      const playerId = session.playerId;
      const state = session.lastState;
      if (state && playerId !== null) {
        if (state.phase === 'gameOver') {
          throw new Error(
            `Session ${sessionId} reached gameOver before becoming actionable.`,
          );
        }
        if (isActionable(state, playerId)) {
          const observation = buildObservation(state, playerId, {
            gameCode: session.code,
            includeSummary,
            includeLegalActionInfo,
          });
          return toolOk(
            `Actionable observation for session ${sessionId} (turn ${state.turnNumber}, phase ${state.phase}).`,
            { ...observation } as Record<string, unknown>,
          );
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const arrived = await waitForNextState(session, remaining);
      if (!arrived) break;
    }

    throw new Error(
      `wait_for_turn timed out on session ${sessionId} before it was actionable.`,
    );
  },
);

server.registerTool(
  'delta_v_get_events',
  {
    description: 'Read buffered server events for a session.',
    inputSchema: {
      sessionId: z.string(),
      afterEventId: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      clear: z.boolean().optional(),
    },
  },
  async ({ sessionId, afterEventId, limit, clear }) => {
    const session = getSessionOrThrow(sessionId);
    const max = limit ?? 50;
    const filtered = session.events.filter((event) =>
      afterEventId === undefined ? true : event.id > afterEventId,
    );
    const selected = filtered.slice(-max);

    if (clear) {
      session.events = [];
    }

    return toolOk(`Returned ${selected.length} event(s) for ${sessionId}.`, {
      sessionId,
      events: selected.map((event) => ({
        id: event.id,
        receivedAt: event.receivedAt,
        type: event.message.type,
        message: event.message,
      })),
      bufferedRemaining: session.events.length,
      latestEventId: session.nextEventId - 1,
    });
  },
);

server.registerTool(
  'delta_v_send_action',
  {
    description:
      "Send a raw C2S game action for a session. ActionGuards are auto-filled from the session's current state unless autoGuards=false; in that case the caller supplies `guards` on the action payload itself.",
    inputSchema: {
      sessionId: z.string(),
      action: z.object({ type: z.string() }).passthrough(),
      autoGuards: z.boolean().optional(),
    },
  },
  async ({ sessionId, action, autoGuards }) => {
    const session = getSessionOrThrow(sessionId);
    if (session.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Session ${sessionId} socket is not open`);
    }

    const shouldAutoGuard = autoGuards ?? true;
    const rawAction = action as C2S;
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

    session.ws.send(JSON.stringify(payload));
    return toolOk(`Sent action ${action.type} on session ${sessionId}.`, {
      sessionId,
      actionType: action.type,
      guarded: Boolean(payload.guards),
    });
  },
);

server.registerTool(
  'delta_v_send_chat',
  {
    description: 'Send chat text in a Delta-V session.',
    inputSchema: {
      sessionId: z.string(),
      text: z.string().min(1).max(200),
    },
  },
  async ({ sessionId, text }) => {
    const session = getSessionOrThrow(sessionId);
    if (session.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Session ${sessionId} socket is not open`);
    }
    const action: C2S = { type: 'chat', text };
    session.ws.send(JSON.stringify(action));
    return toolOk(`Sent chat in session ${sessionId}.`, {
      sessionId,
      text,
    });
  },
);

server.registerTool(
  'delta_v_close_session',
  {
    description: 'Close and remove a Delta-V session.',
    inputSchema: {
      sessionId: z.string(),
    },
  },
  async ({ sessionId }) => {
    const session = getSessionOrThrow(sessionId);
    session.ws.close(1000, 'Closed by MCP tool');
    sessions.delete(sessionId);
    return toolOk(`Closed session ${sessionId}.`, { sessionId, closed: true });
  },
);

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
