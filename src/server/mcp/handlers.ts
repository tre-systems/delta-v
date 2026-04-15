// Worker-side MCP entry point. Hosts a stateless streamable-HTTP transport
// at POST /mcp; each tool call is a single JSON-RPC POST that returns JSON
// (no SSE — agents poll via delta_v_wait_for_turn instead).
//
// Every tool delegates straight to the GAME Durable Object via env.GAME so
// the Worker holds no per-session state. The DO already validates the
// playerToken and owns the entire game pipeline.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

import { isPlayerToken, isRoomCode } from '../../shared/ids';
import type { Env } from '../env';
import { queueRemoteMatch } from './quick-match';

const SERVER_INTERNAL = 'https://game.internal';

// Lift the body forward as-is for HTTP responses; this is intentionally
// loose because the GAME DO produces its own structured JSON and the MCP SDK
// just needs a serialisable result.
type JsonRecord = Record<string, unknown>;

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

const requireRoomCode = (raw: string): string => {
  if (!isRoomCode(raw)) fail(`Invalid room code: ${raw}`);
  return raw;
};

const requirePlayerToken = (raw: string): string => {
  if (!isPlayerToken(raw)) fail('Invalid playerToken');
  return raw;
};

const callDurableObject = async (
  env: Env,
  code: string,
  init: RequestInit & { url: string },
): Promise<Response> => {
  const stub = env.GAME.get(env.GAME.idFromName(code));
  return stub.fetch(new Request(init.url, init));
};

const buildObservationParams = (args: {
  includeSummary?: boolean;
  includeLegalActionInfo?: boolean;
  includeTactical?: boolean;
  includeSpatialGrid?: boolean;
  includeCandidateLabels?: boolean;
}): URLSearchParams => {
  const params = new URLSearchParams();
  if (args.includeSummary) params.set('includeSummary', 'true');
  if (args.includeLegalActionInfo) params.set('includeLegalActionInfo', 'true');
  if (args.includeTactical) params.set('includeTactical', 'true');
  if (args.includeSpatialGrid) params.set('includeSpatialGrid', 'true');
  if (args.includeCandidateLabels) params.set('includeCandidateLabels', 'true');
  return params;
};

const includeOptionsSchema = {
  includeSummary: z.boolean().optional(),
  includeLegalActionInfo: z.boolean().optional(),
  includeTactical: z.boolean().optional(),
  includeSpatialGrid: z.boolean().optional(),
  includeCandidateLabels: z.boolean().optional(),
};

export const buildMcpServer = (env: Env): McpServer => {
  const server = new McpServer(
    { name: 'delta-v-mcp-remote', version: '0.1.0' },
    {
      instructions:
        'Use this server to play Delta-V via the hosted MCP endpoint. Call delta_v_quick_match for a public match (or supply an existing code+playerToken from /create), then drive the game with delta_v_wait_for_turn / delta_v_get_observation / delta_v_send_action. Every tool other than delta_v_quick_match requires { code, playerToken } from a successful match.',
    },
  );

  server.registerTool(
    'delta_v_quick_match',
    {
      description:
        'Queue for public matchmaking and block until paired. Returns { code, playerToken, scenario } that every other tool requires. Use a stable agent_-prefixed playerKey across runs to keep server logs and replays consistent.',
      inputSchema: {
        scenario: z.string().optional(),
        username: z.string().min(2).max(20),
        playerKey: z.string().min(8).max(64).optional(),
        pollMs: z.number().int().min(200).max(5_000).optional(),
        timeoutMs: z.number().int().min(5_000).max(120_000).optional(),
      },
    },
    async (args) => {
      const playerKey =
        args.playerKey ??
        `agent_remote_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const matched = await queueRemoteMatch(env, {
        scenario: args.scenario ?? 'duel',
        username: args.username,
        playerKey,
        pollMs: args.pollMs,
        timeoutMs: args.timeoutMs,
      });
      return ok(
        `Matched into ${matched.code} (scenario ${matched.scenario}).`,
        {
          code: matched.code,
          playerToken: matched.playerToken,
          ticket: matched.ticket,
          scenario: matched.scenario,
          playerKey,
        },
      );
    },
  );

  server.registerTool(
    'delta_v_get_state',
    {
      description: 'Fetch the latest game state for a seat.',
      inputSchema: {
        code: z.string().length(5),
        playerToken: z.string(),
      },
    },
    async (args) => {
      const code = requireRoomCode(args.code);
      const token = requirePlayerToken(args.playerToken);
      const response = await callDurableObject(env, code, {
        url: `${SERVER_INTERNAL}/mcp/state?playerToken=${encodeURIComponent(token)}`,
        method: 'GET',
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`get_state failed: ${JSON.stringify(body)}`);
      return ok(`State for ${code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_get_observation',
    {
      description:
        'Build the unified agent observation (candidates, recommendedIndex, optional v2 enrichments). Matches the AgentTurnInput shape so agents that work via the bridge or local MCP work here unchanged.',
      inputSchema: {
        code: z.string().length(5),
        playerToken: z.string(),
        ...includeOptionsSchema,
      },
    },
    async (args) => {
      const code = requireRoomCode(args.code);
      const token = requirePlayerToken(args.playerToken);
      const params = buildObservationParams(args);
      params.set('playerToken', token);
      const response = await callDurableObject(env, code, {
        url: `${SERVER_INTERNAL}/mcp/observation?${params.toString()}`,
        method: 'GET',
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`get_observation failed: ${JSON.stringify(body)}`);
      return ok(`Observation for ${code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_wait_for_turn',
    {
      description:
        "Block (server-side) until it's the caller's turn (or fleetBuilding/astrogation opens), then return a fresh observation. Default 25 s timeout — issue successive calls for longer waits. Returns { actionable: false, timedOut: true } on timeout instead of throwing.",
      inputSchema: {
        code: z.string().length(5),
        playerToken: z.string(),
        timeoutMs: z.number().int().min(1_000).max(25_000).optional(),
        ...includeOptionsSchema,
      },
    },
    async (args) => {
      const code = requireRoomCode(args.code);
      const token = requirePlayerToken(args.playerToken);
      const response = await callDurableObject(env, code, {
        url: `${SERVER_INTERNAL}/mcp/wait?playerToken=${encodeURIComponent(token)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeoutMs: args.timeoutMs,
          includeSummary: args.includeSummary,
          includeLegalActionInfo: args.includeLegalActionInfo,
          includeTactical: args.includeTactical,
          includeSpatialGrid: args.includeSpatialGrid,
          includeCandidateLabels: args.includeCandidateLabels,
        }),
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`wait_for_turn failed: ${JSON.stringify(body)}`);
      return ok(`wait_for_turn for ${code}.`, body);
    },
  );

  server.registerTool(
    'delta_v_send_action',
    {
      description:
        'Submit a C2S game-state action. ActionGuards (expectedTurn / expectedPhase / idempotencyKey) are auto-filled from the current state unless autoGuards=false. With waitForResult=true (recommended), blocks for the next state-bearing publish and returns ActionResult: { accepted, turnApplied, phaseApplied, nextTurn, nextPhase, effects[], nextObservation? }. With includeNextObservation=true the next observation is embedded so you can close the decide loop in one call.',
      inputSchema: {
        code: z.string().length(5),
        playerToken: z.string(),
        action: z.object({ type: z.string() }).passthrough(),
        autoGuards: z.boolean().optional(),
        waitForResult: z.boolean().optional(),
        waitTimeoutMs: z.number().int().min(1_000).max(25_000).optional(),
        includeNextObservation: z.boolean().optional(),
        ...includeOptionsSchema,
      },
    },
    async (args) => {
      const code = requireRoomCode(args.code);
      const token = requirePlayerToken(args.playerToken);
      const response = await callDurableObject(env, code, {
        url: `${SERVER_INTERNAL}/mcp/action?playerToken=${encodeURIComponent(token)}`,
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
        }),
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) {
        return ok(`send_action failed for ${code}.`, body);
      }
      const accepted = body.accepted === true ? 'accepted' : 'not accepted';
      return ok(`Action ${args.action.type} on ${code}: ${accepted}.`, body);
    },
  );

  server.registerTool(
    'delta_v_send_chat',
    {
      description: 'Send a chat message in the current match (≤200 chars).',
      inputSchema: {
        code: z.string().length(5),
        playerToken: z.string(),
        text: z.string().min(1).max(200),
      },
    },
    async (args) => {
      const code = requireRoomCode(args.code);
      const token = requirePlayerToken(args.playerToken);
      const response = await callDurableObject(env, code, {
        url: `${SERVER_INTERNAL}/mcp/chat?playerToken=${encodeURIComponent(token)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: args.text }),
      });
      const body = (await response.json()) as JsonRecord;
      if (!response.ok) fail(`send_chat failed: ${JSON.stringify(body)}`);
      return ok(`Sent chat in ${code}.`, body);
    },
  );

  return server;
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
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildMcpServer(env);
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  await transport.close();
  return response;
};
