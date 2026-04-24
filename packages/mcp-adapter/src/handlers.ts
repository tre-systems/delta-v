// Worker-side MCP entry point. Hosts a stateless streamable-HTTP transport
// at POST /mcp; each tool call is a single JSON-RPC POST that returns JSON
// (no SSE — agents poll via delta_v_wait_for_turn instead).
//
// Every tool delegates straight to the GAME Durable Object via env.GAME so
// the Worker holds no per-session state. The DO already validates the
// playerToken and owns the entire game pipeline.
//
// Two-token authorization model:
//   - agentToken (Authorization: Bearer …): long-lived (24h) HMAC-signed
//     identity. Issued by POST /api/agent-token. Required on every hosted MCP
//     call so the adapter can mint and validate per-match credentials.
//   - matchToken (tool args): per-match HMAC blob returned by
//     delta_v_quick_match or delta_v_list_sessions. The hosted adapter also
//     accepts sessionId as a compatibility alias for the same opaque token.

import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  type AgentTokenPayload,
  extractBearerToken,
  hashAgentToken,
  isAgentTokenSecretSet,
  issueMatchToken,
  MissingAgentTokenSecretError,
  resolveAgentTokenSecret,
  verifyAgentToken,
  verifyMatchToken,
} from '../../../src/server/auth';
import type { Env } from '../../../src/server/env';
import { handleLeaderboardQuery } from '../../../src/server/leaderboard/query-route';
import { handleLiveMatchesList } from '../../../src/server/live-matches-list';
import {
  hashIp,
  logSampledOperationalEvent,
} from '../../../src/server/reporting';
import {
  type AgentTurnInput,
  buildLeaderboardAgentsResourceDocument,
  buildMatchLogResourceDocument,
  buildMatchObservationResourceDocument,
  buildMatchReplayResourceDocument,
  LEADERBOARD_AGENTS_URI,
  type LeaderboardAgentEntry,
  leaderboardAgentsResource,
  listRulesResources,
  MATCH_LOG_URI_TEMPLATE,
  MATCH_OBSERVATION_URI_TEMPLATE,
  MATCH_REPLAY_URI_TEMPLATE,
  matchLogUri,
  matchObservationUri,
  matchReplayUri,
  RULES_RESOURCE_MIME_TYPE,
  readRulesResourceText,
} from '../../../src/shared/agent';
import { validateClientMessage } from '../../../src/shared/protocol';
import { queueRemoteMatch } from './quick-match';

// Maximum JSON-RPC payload the hosted MCP endpoint will parse. The tool
// surface is intentionally small (a dozen tools, each with a few string
// arguments); anything larger is a malformed payload or an attempt to
// burn server CPU on parsing. Kept below Cloudflare's Worker request
// body cap so this rejection short-circuits transport-level handling.
const MCP_MAX_BODY_BYTES = 16 * 1024;
const MCP_RATE_LIMIT = 20;
const MCP_RATE_LIMIT_WINDOW_MS = 60_000;
const MCP_RATE_LIMIT_MAP_MAX_KEYS = 2000;

const mcpRateLimitMap = new Map<
  string,
  { count: number; windowStart: number }
>();

const SERVER_INTERNAL = 'https://game.internal';
const RENDEZVOUS_CODE_PATTERN = /^[A-Za-z0-9]{3,16}$/;

type JsonRecord = Record<string, unknown>;
type ObservationBody = JsonRecord;
type EventsBody = JsonRecord & {
  events?: Array<{
    id: number;
    receivedAt: number;
    type: string;
    message: unknown;
  }>;
  latestEventId?: number;
  bufferedRemaining?: number;
};

const text = (body: string): { type: 'text'; text: string } => ({
  type: 'text',
  text: body,
});

const ok = <T extends JsonRecord>(summary: string, structuredContent: T) => ({
  content: [text(summary)],
  structuredContent,
});

const fail = (message: string): never => {
  throw new Error(message);
};

const callDurableObject = (
  env: Env,
  code: string,
  init: RequestInit & { url: string },
): Promise<Response> => {
  const stub = env.GAME.get(env.GAME.idFromName(code));
  return stub.fetch(new Request(init.url, init));
};

const buildHostedMatchObservationResource = async (
  env: Env,
  target: MatchTarget,
): Promise<string> => {
  const params = buildObservationParams({
    includeSummary: true,
    includeLegalActionInfo: true,
    includeCandidateLabels: true,
    compactState: true,
  });
  params.set('playerToken', target.playerToken);
  const response = await callDurableObject(env, target.code, {
    url: `${SERVER_INTERNAL}/mcp/observation?${params.toString()}`,
    method: 'GET',
  });
  const body = (await response.json()) as ObservationBody;
  if (!response.ok) {
    fail(`match observation resource failed: ${JSON.stringify(body)}`);
  }
  return JSON.stringify(
    buildMatchObservationResourceDocument(
      target.code,
      body as unknown as AgentTurnInput,
    ),
    null,
    2,
  );
};

const buildHostedMatchLogResource = async (
  env: Env,
  target: MatchTarget,
): Promise<string> => {
  const response = await callDurableObject(env, target.code, {
    url: `${SERVER_INTERNAL}/mcp/events?playerToken=${encodeURIComponent(target.playerToken)}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 200 }),
  });
  const body = (await response.json()) as EventsBody;
  if (!response.ok) {
    fail(`match log resource failed: ${JSON.stringify(body)}`);
  }
  return JSON.stringify(
    buildMatchLogResourceDocument(
      target.code,
      (body.events ?? []) as never,
      typeof body.latestEventId === 'number' ? body.latestEventId : 0,
      typeof body.bufferedRemaining === 'number' ? body.bufferedRemaining : 0,
    ),
    null,
    2,
  );
};

const buildHostedMatchReplayResource = async (
  env: Env,
  target: MatchTarget,
): Promise<string> => {
  const response = await callDurableObject(env, target.code, {
    url: `${SERVER_INTERNAL}/replay?playerToken=${encodeURIComponent(target.playerToken)}`,
    method: 'GET',
  });
  if (!response.ok) {
    const body = await response.text();
    fail(`match replay resource failed: ${body}`);
  }
  return JSON.stringify(
    buildMatchReplayResourceDocument(
      target.code,
      (await response.json()) as import('../../../src/shared/replay').ReplayTimeline,
    ),
    null,
    2,
  );
};

const buildObservationParams = (args: {
  includeSummary?: boolean;
  includeLegalActionInfo?: boolean;
  includeTactical?: boolean;
  includeSpatialGrid?: boolean;
  includeCandidateLabels?: boolean;
  compactState?: boolean;
}): URLSearchParams => {
  const params = new URLSearchParams();
  if (args.includeSummary) params.set('includeSummary', 'true');
  if (args.includeLegalActionInfo) params.set('includeLegalActionInfo', 'true');
  if (args.includeTactical) params.set('includeTactical', 'true');
  if (args.includeSpatialGrid) params.set('includeSpatialGrid', 'true');
  if (args.includeCandidateLabels) params.set('includeCandidateLabels', 'true');
  if (args.compactState) params.set('compactState', 'true');
  return params;
};

const includeOptionsSchema = {
  includeSummary: z.boolean().optional(),
  includeLegalActionInfo: z.boolean().optional(),
  includeTactical: z.boolean().optional(),
  includeSpatialGrid: z.boolean().optional(),
  includeCandidateLabels: z.boolean().optional(),
  compactState: z.boolean().optional(),
};

// Identifier schema for hosted in-match tools: accept the canonical opaque
// matchToken, or sessionId as a compatibility alias used by some MCP hosts.
const matchTargetSchema = {
  sessionId: z.string().optional(),
  matchToken: z.string().optional(),
};

interface MatchTarget {
  code: string;
  playerToken: string;
}

// Resolve the hosted match handle into the concrete {code, playerToken} pair
// the GAME DO needs. matchToken is canonical; sessionId is a compatibility
// alias used by some MCP hosts. All hosted in-match tools require the same
// Bearer token that minted the match handle.
const resolveMatchTarget = async (
  args: {
    sessionId?: string;
    matchToken?: string;
  },
  env: Env,
  agentIdentity: AgentIdentity | null,
): Promise<MatchTarget> => {
  const sessionHandle = args.matchToken ?? args.sessionId;
  if (!sessionHandle) {
    fail(
      'Provide matchToken (hosted alias: sessionId). Start a match with delta_v_quick_match or recover one with delta_v_list_sessions.',
    );
  }
  if (!agentIdentity) {
    fail(
      'Hosted MCP requires Authorization: Bearer <agentToken>. Mint one via POST /api/agent-token, then call delta_v_quick_match.',
    );
  }
  const requiredSessionHandle = sessionHandle as string;
  const authenticatedAgent = agentIdentity as AgentIdentity;

  const secret = resolveAgentTokenSecret(env);
  const verified = await verifyMatchToken(requiredSessionHandle, { secret });
  if (!verified.ok) {
    if (args.sessionId && !args.matchToken) {
      fail(
        'Unknown or expired sessionId. Pass a fresh matchToken/sessionId from delta_v_quick_match or delta_v_list_sessions.',
      );
    }
    fail(`Invalid matchToken: ${verified.reason}`);
  }
  if (!verified.ok) throw new Error('unreachable');
  const expected = await hashAgentToken(authenticatedAgent.rawAgentToken);
  if (verified.payload.agentTokenHash !== expected) {
    fail(
      'matchToken does not bind to the supplied agentToken — likely issued for a different agent',
    );
  }
  return {
    code: verified.payload.code,
    playerToken: verified.payload.playerToken,
  };
};

export interface AgentIdentity {
  payload: AgentTokenPayload;
  rawAgentToken: string;
}

export const buildMcpServer = (
  env: Env,
  agentIdentity: AgentIdentity | null,
): McpServer => {
  const server = new McpServer(
    { name: 'delta-v-mcp-remote', version: '0.1.0' },
    {
      instructions:
        'Use this server to play Delta-V via the hosted MCP endpoint. Recommended flow: (1) call POST /api/agent-token once with your stable agent_-prefixed playerKey to obtain an agentToken; (2) send it as Authorization: Bearer <token> on every /mcp request; (3) call delta_v_quick_match (no args needed) to receive an opaque matchToken; (4) drive the game via delta_v_wait_for_turn / delta_v_send_action passing matchToken in args (sessionId is accepted as a hosted compatibility alias).',
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
        const response = await handleLeaderboardQuery(
          new Request(
            'https://game.internal/api/leaderboard?limit=200&includeProvisional=true',
            { method: 'GET' },
          ),
          env,
        );
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

  {
    const template = new ResourceTemplate(MATCH_OBSERVATION_URI_TEMPLATE, {
      list: undefined,
    });
    server.registerResource(
      'delta-v-match-observation',
      template,
      {
        title: 'Match Observation',
        description:
          'Current agent observation for a live match. Hosted MCP uses matchToken as {id}.',
        mimeType: RULES_RESOURCE_MIME_TYPE,
      },
      async (_uri, variables) => {
        const id = String(variables.id ?? '');
        const target = await resolveMatchTarget(
          { matchToken: id },
          env,
          agentIdentity,
        );
        return {
          contents: [
            {
              uri: matchObservationUri(id),
              mimeType: RULES_RESOURCE_MIME_TYPE,
              text: await buildHostedMatchObservationResource(env, target),
            },
          ],
        };
      },
    );
  }

  {
    const template = new ResourceTemplate(MATCH_LOG_URI_TEMPLATE, {
      list: undefined,
    });
    server.registerResource(
      'delta-v-match-log',
      template,
      {
        title: 'Match Log',
        description:
          'Buffered append-only event log for a live match. Hosted MCP uses matchToken as {id}.',
        mimeType: RULES_RESOURCE_MIME_TYPE,
      },
      async (_uri, variables) => {
        const id = String(variables.id ?? '');
        const target = await resolveMatchTarget(
          { matchToken: id },
          env,
          agentIdentity,
        );
        return {
          contents: [
            {
              uri: matchLogUri(id),
              mimeType: RULES_RESOURCE_MIME_TYPE,
              text: await buildHostedMatchLogResource(env, target),
            },
          ],
        };
      },
    );
  }

  {
    const template = new ResourceTemplate(MATCH_REPLAY_URI_TEMPLATE, {
      list: undefined,
    });
    server.registerResource(
      'delta-v-match-replay',
      template,
      {
        title: 'Match Replay',
        description:
          'Latest replay timeline for a live match. Hosted MCP uses matchToken as {id}.',
        mimeType: RULES_RESOURCE_MIME_TYPE,
      },
      async (_uri, variables) => {
        const id = String(variables.id ?? '');
        const target = await resolveMatchTarget(
          { matchToken: id },
          env,
          agentIdentity,
        );
        return {
          contents: [
            {
              uri: matchReplayUri(id),
              mimeType: RULES_RESOURCE_MIME_TYPE,
              text: await buildHostedMatchReplayResource(env, target),
            },
          ],
        };
      },
    );
  }

  const quickMatchInputSchema = z
    .object({
      scenario: z.string().optional(),
      rendezvousCode: z
        .string()
        .regex(
          RENDEZVOUS_CODE_PATTERN,
          'rendezvousCode must be 3-16 characters using letters and numbers.',
        )
        .optional(),
      username: z.string().min(2).max(20).optional(),
      playerKey: z.string().min(8).max(64).optional(),
      waitForOpponent: z.boolean().optional(),
      pollMs: z.number().int().min(200).max(5_000).optional(),
      timeoutMs: z.number().int().min(5_000).max(120_000).optional(),
    })
    .strict();
  type QuickMatchToolArgs = z.infer<typeof quickMatchInputSchema>;

  const quickMatchHandler = async (args: QuickMatchToolArgs) => {
    if (agentIdentity === null) {
      fail(
        'delta_v_quick_match requires Authorization: Bearer <agentToken>. Mint one via POST /api/agent-token first.',
      );
    }
    const authenticatedAgent = agentIdentity as AgentIdentity;

    const playerKey =
      args.playerKey ??
      authenticatedAgent.payload.playerKey ??
      `agent_remote_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const username =
      args.username ??
      (authenticatedAgent.payload.playerKey ?? 'agent').slice(0, 20);
    const verifiedLeaderboardAgent = Boolean(
      playerKey.startsWith('agent_') &&
        authenticatedAgent.payload.playerKey === playerKey,
    );
    const matched = await queueRemoteMatch(env, {
      scenario: args.scenario ?? 'duel',
      rendezvousCode: args.rendezvousCode,
      username,
      playerKey,
      waitForOpponent: args.waitForOpponent,
      pollMs: args.pollMs,
      timeoutMs: args.timeoutMs,
      verifiedLeaderboardAgent,
    });

    if (matched.status === 'queued') {
      return ok(
        `Queued quick-match ticket ${matched.ticket} for scenario ${matched.scenario}.`,
        {
          status: 'queued',
          ticket: matched.ticket,
          scenario: matched.scenario,
          rendezvousCode: args.rendezvousCode ?? null,
          playerKey,
        },
      );
    }

    const secret = resolveAgentTokenSecret(env);
    const { token: matchToken, expiresAt } = await issueMatchToken({
      secret,
      code: matched.code,
      playerToken: matched.playerToken,
      agentToken: authenticatedAgent.rawAgentToken,
    });
    return ok(`Matched into a new game (scenario ${matched.scenario}).`, {
      matchToken,
      sessionId: matchToken,
      matchTokenExpiresAt: expiresAt,
      scenario: matched.scenario,
      rendezvousCode: args.rendezvousCode ?? null,
      ticket: matched.ticket,
      playerKey,
    });
  };

  server.registerTool(
    'delta_v_quick_match',
    {
      description:
        'Queue for public matchmaking. Requires Authorization: Bearer <agentToken>. With waitForOpponent=false, returns a queued ticket immediately so another client can join later; otherwise blocks until paired. On match, returns { matchToken, sessionId, scenario } where matchToken is the canonical opaque handle for later tool calls and sessionId is a hosted compatibility alias. username/playerKey are inferred from the agentToken when present.',
      inputSchema: quickMatchInputSchema,
    },
    quickMatchHandler,
  );

  server.registerTool(
    'delta_v_quick_match_connect',
    {
      description:
        'Alias for delta_v_quick_match so local and hosted MCP can share one quick-match entry point name. Supports waitForOpponent=false for immediate ticket return. If the first actionable observation is still fleetBuilding, send fleetReady explicitly; that phase advances only after both seats submit it.',
      inputSchema: quickMatchInputSchema,
    },
    quickMatchHandler,
  );

  server.registerTool(
    'delta_v_list_sessions',
    {
      description:
        'List active hosted MCP sessions for the authenticated agent. Requires Authorization: Bearer <agentToken> so the adapter can discover seated live matches and mint fresh matchTokens.',
    },
    async () => {
      if (agentIdentity === null) {
        throw new Error(
          'delta_v_list_sessions requires Authorization: Bearer <agentToken>.',
        );
      }
      const authenticatedAgent: AgentIdentity = agentIdentity;
      const live = await handleLiveMatchesList(env);
      const body = (await live.json()) as {
        matches?: Array<{ code: string; scenario: string; startedAt: number }>;
      };
      const secret = resolveAgentTokenSecret(env);
      const sessions = await Promise.all(
        (body.matches ?? []).map(async (match) => {
          const response = await callDurableObject(env, match.code, {
            url: `${SERVER_INTERNAL}/mcp/session-summary?playerKey=${encodeURIComponent(authenticatedAgent.payload.playerKey)}`,
            method: 'GET',
          });
          if (!response.ok) {
            return null;
          }
          const sessionBody = (await response.json()) as {
            session?: {
              code: string;
              scenario: string;
              playerId: number;
              playerToken: string;
              currentPhase: string | null;
              turnNumber: number | null;
              eventsBuffered: number;
            };
          };
          if (!sessionBody.session) {
            return null;
          }
          const { token: matchToken, expiresAt } = await issueMatchToken({
            secret,
            code: sessionBody.session.code,
            playerToken: sessionBody.session.playerToken,
            agentToken: authenticatedAgent.rawAgentToken,
          });
          return {
            matchToken,
            sessionId: matchToken,
            matchTokenExpiresAt: expiresAt,
            code: sessionBody.session.code,
            scenario: sessionBody.session.scenario,
            playerId: sessionBody.session.playerId,
            connectionStatus: 'open',
            currentPhase: sessionBody.session.currentPhase,
            turnNumber: sessionBody.session.turnNumber,
            eventsBuffered: sessionBody.session.eventsBuffered,
          };
        }),
      );
      return ok('Listed hosted MCP sessions.', {
        sessions: sessions.filter((session) => session !== null),
      });
    },
  );

  server.registerTool(
    'delta_v_get_state',
    {
      description: 'Fetch the latest game state for a seat.',
      inputSchema: matchTargetSchema,
    },
    async (args) => {
      const target = await resolveMatchTarget(args, env, agentIdentity);
      const response = await callDurableObject(env, target.code, {
        url: `${SERVER_INTERNAL}/mcp/state?playerToken=${encodeURIComponent(target.playerToken)}`,
        method: 'GET',
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`get_state failed: ${JSON.stringify(body)}`);
      return ok(`State for ${target.code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_get_observation',
    {
      description:
        'Build the unified agent observation (candidates, recommendedIndex, optional v2 enrichments). Matches the AgentTurnInput shape so agents that work via the bridge or local MCP work here unchanged.',
      inputSchema: { ...matchTargetSchema, ...includeOptionsSchema },
    },
    async (args) => {
      const target = await resolveMatchTarget(args, env, agentIdentity);
      const params = buildObservationParams(args);
      params.set('playerToken', target.playerToken);
      const response = await callDurableObject(env, target.code, {
        url: `${SERVER_INTERNAL}/mcp/observation?${params.toString()}`,
        method: 'GET',
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`get_observation failed: ${JSON.stringify(body)}`);
      return ok(`Observation for ${target.code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_wait_for_turn',
    {
      description:
        "Block (server-side) until it's the caller's turn to act (fleetBuilding: both seats; later phases including astrogation: activePlayer must match this seat), then return a fresh observation. If the returned observation is still fleetBuilding, the seat still needs to send fleetReady explicitly. Default 25 s timeout — issue successive calls for longer waits. Returns { actionable: false, timedOut: true } on timeout instead of throwing.",
      inputSchema: {
        ...matchTargetSchema,
        timeoutMs: z.number().int().min(1_000).max(25_000).optional(),
        ...includeOptionsSchema,
      },
    },
    async (args) => {
      const target = await resolveMatchTarget(args, env, agentIdentity);
      const response = await callDurableObject(env, target.code, {
        url: `${SERVER_INTERNAL}/mcp/wait?playerToken=${encodeURIComponent(target.playerToken)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeoutMs: args.timeoutMs,
          includeSummary: args.includeSummary,
          includeLegalActionInfo: args.includeLegalActionInfo,
          includeTactical: args.includeTactical,
          includeSpatialGrid: args.includeSpatialGrid,
          includeCandidateLabels: args.includeCandidateLabels,
          compactState: args.compactState,
        }),
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`wait_for_turn failed: ${JSON.stringify(body)}`);
      return ok(`wait_for_turn for ${target.code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_get_events',
    {
      description:
        'Read the Durable-Object-backed hosted event buffer for a match seat. Useful for reconnect/recovery when the caller wants append-only chat/state history between MCP requests.',
      inputSchema: {
        ...matchTargetSchema,
        afterEventId: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        clear: z.boolean().optional(),
      },
    },
    async (args) => {
      const target = await resolveMatchTarget(args, env, agentIdentity);
      const response = await callDurableObject(env, target.code, {
        url: `${SERVER_INTERNAL}/mcp/events?playerToken=${encodeURIComponent(target.playerToken)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          afterEventId: args.afterEventId,
          limit: args.limit,
          clear: args.clear,
        }),
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`get_events failed: ${JSON.stringify(body)}`);
      return ok(`Buffered events for ${target.code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_send_action',
    {
      description:
        'Submit a C2S game-state action. ActionGuards (expectedTurn / expectedPhase / idempotencyKey) are auto-filled from the current state unless autoGuards=false. With waitForResult=true (recommended), blocks for the next state-bearing publish and returns ActionResult: { accepted, turnApplied, phaseApplied, nextTurn, nextPhase, effects[], nextObservation? }. With includeNextObservation=true the next observation is embedded so you can close the decide loop in one call.',
      inputSchema: {
        ...matchTargetSchema,
        action: z.object({ type: z.string() }).passthrough(),
        autoGuards: z.boolean().optional(),
        waitForResult: z.boolean().optional(),
        waitTimeoutMs: z.number().int().min(1_000).max(25_000).optional(),
        includeNextObservation: z.boolean().optional(),
        ...includeOptionsSchema,
      },
    },
    async (args) => {
      const parsedAction = validateClientMessage(args.action);
      if (!parsedAction.ok) {
        fail(`Invalid action payload: ${parsedAction.error}`);
      }
      const target = await resolveMatchTarget(args, env, agentIdentity);
      const response = await callDurableObject(env, target.code, {
        url: `${SERVER_INTERNAL}/mcp/action?playerToken=${encodeURIComponent(target.playerToken)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: args.action,
          autoGuards: args.autoGuards,
          waitForResult: args.waitForResult,
          waitTimeoutMs: args.waitTimeoutMs,
          includeNextObservation: args.includeNextObservation,
          includeSummary: args.includeSummary,
          includeLegalActionInfo: args.includeLegalActionInfo,
          includeTactical: args.includeTactical,
          includeSpatialGrid: args.includeSpatialGrid,
          includeCandidateLabels: args.includeCandidateLabels,
          compactState: args.compactState,
        }),
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) {
        return ok(`send_action failed for ${target.code}.`, body);
      }
      const accepted = body.accepted === true ? 'accepted' : 'not accepted';
      return ok(
        `Action ${args.action.type} on ${target.code}: ${accepted}.`,
        body,
      );
    },
  );

  server.registerTool(
    'delta_v_send_chat',
    {
      description:
        'Send a chat message in the current match (≤200 chars). The canonical argument name is `text`; `message` is accepted as an alias for clients that follow the conventional chat-field naming.',
      inputSchema: {
        ...matchTargetSchema,
        text: z.string().min(1).max(200).optional(),
        message: z.string().min(1).max(200).optional(),
      },
    },
    async (args) => {
      const chatText = args.text ?? args.message;
      if (!chatText) {
        fail('send_chat requires a non-empty `text` (alias: `message`).');
      }
      const target = await resolveMatchTarget(args, env, agentIdentity);
      const response = await callDurableObject(env, target.code, {
        url: `${SERVER_INTERNAL}/mcp/chat?playerToken=${encodeURIComponent(target.playerToken)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chatText }),
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`send_chat failed: ${JSON.stringify(body)}`);
      return ok(`Sent chat in ${target.code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_close_session',
    {
      description:
        'Clear the hosted MCP event buffer for this seat. This does not invalidate the underlying matchToken or alter the match itself; it only resets the Durable-Object-backed helper state.',
      inputSchema: matchTargetSchema,
    },
    async (args) => {
      const target = await resolveMatchTarget(args, env, agentIdentity);
      const response = await callDurableObject(env, target.code, {
        url: `${SERVER_INTERNAL}/mcp/close?playerToken=${encodeURIComponent(target.playerToken)}`,
        method: 'POST',
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`close_session failed: ${JSON.stringify(body)}`);
      return ok(
        `Cleared hosted session helper state for ${target.code}.`,
        body,
      );
    },
  );

  return server;
};

// Validate the Authorization header on entry. Returns:
//   - { ok: true, identity: ... } when a valid agentToken was supplied
//   - { ok: true, identity: null } when no header was supplied (legacy)
//   - { ok: false, response } when a header was supplied but invalid (401)
const resolveAgentIdentity = async (
  request: Request,
  env: Env,
): Promise<
  | { ok: true; identity: AgentIdentity | null }
  | { ok: false; response: Response }
> => {
  const raw = extractBearerToken(request.headers.get('Authorization'));
  if (!raw) return { ok: true, identity: null };
  const verified = await verifyAgentToken(raw, {
    secret: resolveAgentTokenSecret(env),
  });
  if (!verified.ok) {
    const ipHash = await hashIp(
      request.headers.get('cf-connecting-ip') ?? 'unknown',
      env,
    );
    logSampledOperationalEvent('auth-failure', ipHash, {
      route: '/mcp',
      reason: 'invalid_agent_token',
      detail: verified.reason,
    });
    return {
      ok: false,
      response: Response.json(
        {
          error: 'invalid_agent_token',
          reason: verified.reason,
          message: 'Authorization header present but agentToken did not verify',
        },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer realm="delta-v"' },
        },
      ),
    };
  }
  return {
    ok: true,
    identity: { payload: verified.payload, rawAgentToken: raw },
  };
};

const isMcpRateLimitedInMemory = (key: string): boolean => {
  const now = Date.now();
  if (mcpRateLimitMap.size > MCP_RATE_LIMIT_MAP_MAX_KEYS) {
    for (const [currentKey, value] of mcpRateLimitMap) {
      if (now - value.windowStart >= MCP_RATE_LIMIT_WINDOW_MS) {
        mcpRateLimitMap.delete(currentKey);
      }
    }
  }

  const existing = mcpRateLimitMap.get(key);
  if (!existing || now - existing.windowStart >= MCP_RATE_LIMIT_WINDOW_MS) {
    mcpRateLimitMap.set(key, { count: 1, windowStart: now });
    return false;
  }

  existing.count += 1;
  return existing.count > MCP_RATE_LIMIT;
};

const enforceMcpRateLimit = async (
  env: Env,
  request: Request,
): Promise<Response | null> => {
  const bearer = extractBearerToken(request.headers.get('Authorization'));
  const key = bearer
    ? `agent:${await hashAgentToken(bearer)}`
    : `ip:${await hashIp(request.headers.get('cf-connecting-ip') ?? 'unknown', env)}`;
  const localBlocked = isMcpRateLimitedInMemory(key);
  if (!env.MCP_RATE_LIMITER) {
    return localBlocked
      ? new Response('Too many requests', {
          status: 429,
          headers: { 'Retry-After': '60' },
        })
      : null;
  }
  const { success } = await env.MCP_RATE_LIMITER.limit({ key });
  return localBlocked || !success
    ? new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    : null;
};

// Per-request entry. Stateless: each request spins up a fresh McpServer +
// transport, handles the JSON-RPC payload synchronously, and tears down.
// `enableJsonResponse: true` returns a single JSON object instead of an SSE
// stream — simpler for agents that only call tools and don't subscribe.
export const handleMcpHttpRequest = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'POST, DELETE' },
    });
  }
  // Fail closed on a mis-deployed Worker before any tool runs. The dev
  // fallback only engages when DEV_MODE=1, so production with a missing
  // secret returns 500 rather than signing / verifying with a placeholder
  // that is readable from the repo.
  if (!isAgentTokenSecretSet(env) && env.DEV_MODE !== '1') {
    const ipHash = await hashIp(
      request.headers.get('cf-connecting-ip') ?? 'unknown',
      env,
    );
    logSampledOperationalEvent('auth-failure', ipHash, {
      route: '/mcp',
      reason: 'server_misconfigured',
    });
    return Response.json(
      {
        error: 'server_misconfigured',
        message:
          'AGENT_TOKEN_SECRET is not set on this deployment. Contact the operator.',
      },
      { status: 500 },
    );
  }

  // Size-cap the JSON-RPC payload before anything else touches it so a
  // multi-megabyte body never reaches the MCP transport.
  let body = '';
  if (request.method === 'POST') {
    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > MCP_MAX_BODY_BYTES) {
      return Response.json(
        {
          error: 'payload_too_large',
          message: `MCP request body exceeds the ${MCP_MAX_BODY_BYTES}-byte cap.`,
        },
        { status: 413 },
      );
    }
    try {
      body = await request.text();
    } catch {
      return Response.json({ error: 'bad_body' }, { status: 400 });
    }
    if (body.length > MCP_MAX_BODY_BYTES) {
      return Response.json(
        {
          error: 'payload_too_large',
          message: `MCP request body exceeds the ${MCP_MAX_BODY_BYTES}-byte cap.`,
        },
        { status: 413 },
      );
    }
  }

  // Global rate limit keyed on agentToken (preferred) or hashed IP.
  // Limits spam of delta_v_quick_match (each call polls the matchmaker
  // for up to 60s) and repeat /mcp/wait long-polls that would otherwise
  // pin the GAME DO warm. Configured in wrangler.toml [[ratelimits]].
  const rateLimited = await enforceMcpRateLimit(env, request);
  if (rateLimited) {
    const ipHash = await hashIp(
      request.headers.get('cf-connecting-ip') ?? 'unknown',
      env,
    );
    logSampledOperationalEvent('rate-limit', ipHash, {
      route: '/mcp',
      reason: 'mcp_bucket',
    });
    return rateLimited;
  }

  const auth = await resolveAgentIdentity(request, env);
  if (!auth.ok) return auth.response;

  // Rebuild the Request with the body we already consumed so the MCP
  // transport sees the original payload intact.
  const rebuilt =
    request.method === 'POST'
      ? new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body,
        })
      : request;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildMcpServer(env, auth.identity);
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(rebuilt);
    await transport.close();
    return response;
  } catch (error) {
    await transport.close();
    if (error instanceof MissingAgentTokenSecretError) {
      return Response.json(
        {
          error: 'server_misconfigured',
          message:
            'AGENT_TOKEN_SECRET is not set on this deployment. Contact the operator.',
        },
        { status: 500 },
      );
    }
    throw error;
  }
};
