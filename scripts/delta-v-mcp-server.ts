import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import process from 'node:process';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import WebSocket from 'ws';
import { z } from 'zod';

import {
  buildObservation,
  computeActionEffects,
  queueForMatch,
} from '../src/shared/agent';
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
      'Get the unified agent observation for a session: candidates, legal-action metadata, prose summary, and recommendedIndex. Matches the AgentTurnInput shape sent by the stdin/HTTP bridge so the same agent code works via either path. Opt-in v2 enrichments (tactical features, ASCII spatial grid, labeled candidates with risk) cost extra tokens but help LLM agents reason without re-deriving geometry.',
    inputSchema: {
      sessionId: z.string(),
      includeSummary: z.boolean().optional(),
      includeLegalActionInfo: z.boolean().optional(),
      includeTactical: z.boolean().optional(),
      includeSpatialGrid: z.boolean().optional(),
      includeCandidateLabels: z.boolean().optional(),
    },
  },
  async ({
    sessionId,
    includeSummary,
    includeLegalActionInfo,
    includeTactical,
    includeSpatialGrid,
    includeCandidateLabels,
  }) => {
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
      includeTactical,
      includeSpatialGrid,
      includeCandidateLabels,
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
      "Block until it is the caller's turn to act (or the fleetBuilding/astrogation phase opens, which both seats can act in), then return a fresh observation. Eliminates polling for MCP agents. Respects a timeout (default 30s) and throws if the game reaches gameOver before becoming actionable. Supports the same v2 enrichment toggles as delta_v_get_observation.",
    inputSchema: {
      sessionId: z.string(),
      timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
      includeSummary: z.boolean().optional(),
      includeLegalActionInfo: z.boolean().optional(),
      includeTactical: z.boolean().optional(),
      includeSpatialGrid: z.boolean().optional(),
      includeCandidateLabels: z.boolean().optional(),
    },
  },
  async ({
    sessionId,
    timeoutMs,
    includeSummary,
    includeLegalActionInfo,
    includeTactical,
    includeSpatialGrid,
    includeCandidateLabels,
  }) => {
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
            includeTactical,
            includeSpatialGrid,
            includeCandidateLabels,
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
      "Send a raw C2S game action for a session. ActionGuards are auto-filled from the session's current state unless autoGuards=false. When waitForResult=true (default false), blocks briefly for the next state-bearing S2C or actionRejected and returns an ActionResult with accepted, effects (visible deltas), turn/phase info, and optionally a fresh observation so agents can close the decision loop in one call.",
    inputSchema: {
      sessionId: z.string(),
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
    },
  },
  async ({
    sessionId,
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
  }) => {
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

    const preState = session.lastState;
    const cursor = session.nextEventId;
    session.ws.send(JSON.stringify(payload));

    if (!waitForResult) {
      return toolOk(`Sent action ${action.type} on session ${sessionId}.`, {
        sessionId,
        actionType: action.type,
        guarded: Boolean(payload.guards),
      });
    }

    const deadline = Date.now() + (waitTimeoutMs ?? 5_000);
    const buildObs = (
      state: GameState,
    ): Record<string, unknown> | undefined => {
      if (!includeNextObservation) return undefined;
      if (session.playerId === null) return undefined;
      return {
        ...buildObservation(state, session.playerId, {
          gameCode: session.code,
          includeSummary,
          includeLegalActionInfo,
          includeTactical,
          includeSpatialGrid,
          includeCandidateLabels,
        }),
      } as Record<string, unknown>;
    };

    while (Date.now() < deadline) {
      // Any actionRejected since submission dominates: report rejection.
      const rejectedEvent = session.events.find(
        (e) => e.id >= cursor && e.message.type === 'actionRejected',
      );
      if (rejectedEvent && rejectedEvent.message.type === 'actionRejected') {
        const msg = rejectedEvent.message;
        return toolOk(
          `Action ${action.type} rejected: ${msg.reason} — ${msg.message}`,
          {
            sessionId,
            actionType: action.type,
            accepted: false,
            reason: msg.reason,
            message: msg.message,
            expected: msg.expected,
            actual: msg.actual,
            idempotencyKey: msg.idempotencyKey,
            nextObservation: buildObs(msg.state),
          },
        );
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
        return toolOk(
          `Action ${action.type} accepted (${effects.length} visible effect${effects.length === 1 ? '' : 's'}).`,
          {
            sessionId,
            actionType: action.type,
            accepted: true,
            turnApplied: preState.turnNumber,
            phaseApplied: preState.phase,
            nextTurn: session.lastState.turnNumber,
            nextPhase: session.lastState.phase,
            nextActivePlayer: session.lastState.activePlayer,
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
    return toolOk(
      `Sent action ${action.type} on session ${sessionId}; no state update within ${waitTimeoutMs ?? 5_000}ms (still pending).`,
      {
        sessionId,
        actionType: action.type,
        accepted: null,
        pending: true,
        guarded: Boolean(payload.guards),
      },
    );
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
    // Default: stdio transport (backward compatible)
    const transport = new StdioServerTransport();
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
