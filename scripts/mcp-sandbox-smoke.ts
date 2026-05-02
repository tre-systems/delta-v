import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

type ToolName =
  | 'delta_v_quick_match_connect'
  | 'delta_v_pair_quick_match_tickets'
  | 'delta_v_wait_for_turn'
  | 'delta_v_validate_action'
  | 'delta_v_send_action'
  | 'delta_v_close_session'
  | 'delta_v_list_sessions';

interface CandidateAction {
  type: string;
  [key: string]: unknown;
}

interface QuickMatchQueuedResponse {
  status?: string;
  ticket?: string;
  connected?: boolean;
  agentSandbox?: boolean;
}

interface QueuedSeat {
  label: string;
  playerKey: string;
  ticket: string;
}

interface PairTicketsResponse {
  code: string;
  scenario: string;
  agentSandbox?: boolean;
  left: {
    sessionId: string;
    matchToken?: string;
    playerId?: 0 | 1 | null;
  };
  right: {
    sessionId: string;
    matchToken?: string;
    playerId?: 0 | 1 | null;
  };
}

interface AgentReadyInfo {
  actionable?: boolean;
  reason?: string;
  actionDeadlineAt?: number | null;
  msUntilAutoplay?: number | null;
  fallbackAutoplayPending?: boolean;
}

interface WaitForTurnResponse {
  sessionId?: string;
  playerId?: 0 | 1;
  candidates?: CandidateAction[];
  recommendedIndex?: number;
  summary?: string;
  agentReady?: AgentReadyInfo;
  legalActionInfo?: {
    phase?: string;
    allowedTypes?: string[];
  };
  state?: {
    phase?: string;
    turnNumber?: number;
    activePlayer?: 0 | 1;
  };
}

interface ValidateActionResponse {
  valid?: boolean;
  stage?: string;
  message?: string;
}

interface SendActionResponse {
  accepted?: boolean | null;
  pending?: boolean;
  reason?: string;
  message?: string;
  actionType?: string;
}

interface LiveMatchesResponse {
  matches?: Array<{ code?: string; scenario?: string }>;
}

interface AgentTokenResponse {
  ok?: boolean;
  token?: string;
  error?: string;
  message?: string;
}

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse<T> {
  error?: JsonRpcError;
  result?: T;
}

interface HostedResource {
  mimeType?: string;
  name?: string;
  title?: string;
  uri: string;
}

interface HostedResourceListResult {
  resources?: HostedResource[];
}

interface HostedResourceContent {
  mimeType?: string;
  text?: string;
  uri: string;
}

interface HostedResourceReadResult {
  contents?: HostedResourceContent[];
}

interface HostedResourceSmokeResult {
  checked: boolean;
  resources: string[];
}

interface SeatResult {
  label: string;
  sessionId: string;
  playerId: 0 | 1 | null;
  actions: number;
  phases: string[];
  issues: string[];
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SERVER_URL = 'https://delta-v.tre.systems';
const DEFAULT_MCP_PORT = 3939;
const RUN_ID = Date.now().toString(36).toUpperCase();

const usage = `Delta-V MCP sandbox smoke

Runs a two-seat, unrated agent match through the local HTTP MCP bridge, then
checks hosted MCP match resources on the same target.

Usage:
  npm run mcp:sandbox-smoke

Environment:
  SERVER_URL          target Delta-V app (default: ${DEFAULT_SERVER_URL})
  MCP_URL             existing local MCP HTTP endpoint; when unset, this script starts one
  MCP_PORT            port for the auto-started MCP HTTP server (default: ${DEFAULT_MCP_PORT})
  SCENARIO            scenario to queue (default: duel)
  RENDEZVOUS_CODE     private queue code, 3-16 chars (default: SMOKE<run id>)
  MAX_ACTIONS         total accepted/pending actions before stopping (default: 8)
  MIN_ACTIONS         minimum actions required for success (default: 4)
  TURN_TIMEOUT_MS     per-seat wait_for_turn timeout (default: 12000)
  START_MCP_SERVER=0  require MCP_URL/port to already be running
  CHECK_PUBLIC_LIVE=0 skip the /api/matches?status=live visibility assertion
  CHECK_HOSTED_RESOURCES=0 skip hosted /mcp resources/list + resources/read assertions
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(usage);
  process.exit(0);
}

const envNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SERVER_URL = process.env.SERVER_URL ?? DEFAULT_SERVER_URL;
const MCP_PORT = envNumber('MCP_PORT', DEFAULT_MCP_PORT);
const MCP_URL = process.env.MCP_URL ?? `http://127.0.0.1:${MCP_PORT}/`;
const SCENARIO = process.env.SCENARIO ?? 'duel';
const RENDEZVOUS_CODE =
  process.env.RENDEZVOUS_CODE ?? `SMOKE${RUN_ID.slice(-8)}`;
const MAX_ACTIONS = envNumber('MAX_ACTIONS', 8);
const MIN_ACTIONS = envNumber('MIN_ACTIONS', 4);
const TURN_TIMEOUT_MS = envNumber('TURN_TIMEOUT_MS', 12_000);
const HTTP_TIMEOUT_PAD_MS = 2_000;
const START_MCP_SERVER = process.env.START_MCP_SERVER !== '0';
const CHECK_PUBLIC_LIVE = process.env.CHECK_PUBLIC_LIVE !== '0';
const CHECK_HOSTED_RESOURCES = process.env.CHECK_HOSTED_RESOURCES !== '0';

const ensureCodeFitsQueue = (code: string): string => {
  if (code.length >= 3 && code.length <= 16) return code;
  throw new Error(
    `RENDEZVOUS_CODE must be 3-16 characters for quick match; got "${code}"`,
  );
};

const callTool = async <T>(
  tool: ToolName,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, arguments: args }),
      signal: controller.signal,
    });
    const body = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
    return (body ? JSON.parse(body) : {}) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`MCP ${tool} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const postJson = async <T>(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 30_000,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
    return (body ? JSON.parse(body) : {}) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`POST ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

class HostedMcpClient {
  private requestId = 0;

  private constructor(private readonly agentToken: string) {}

  static async create(playerKey: string): Promise<HostedMcpClient> {
    const issued = await postJson<AgentTokenResponse>(
      new URL('/api/agent-token', SERVER_URL).toString(),
      { playerKey },
      {},
      10_000,
    );
    if (issued.ok !== true || !issued.token) {
      throw new Error(
        `agent-token issuance failed: ${issued.error ?? issued.message ?? 'unknown'}`,
      );
    }
    const client = new HostedMcpClient(issued.token);
    await client.rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'delta-v-mcp-sandbox-smoke', version: '1.0' },
    });
    return client;
  }

  async rpc<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<T> {
    this.requestId += 1;
    const response = await postJson<JsonRpcResponse<T>>(
      new URL('/mcp', SERVER_URL).toString(),
      {
        jsonrpc: '2.0',
        id: this.requestId,
        method,
        ...(params ? { params } : {}),
      },
      {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${this.agentToken}`,
        'MCP-Protocol-Version': '2025-11-25',
      },
      timeoutMs,
    );
    if (response.error) {
      throw new Error(
        `MCP ${method} failed: ${response.error.message ?? JSON.stringify(response.error)}`,
      );
    }
    if (!response.result) {
      throw new Error(`MCP ${method} returned no result`);
    }
    return response.result;
  }

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.rpc<{
      isError?: boolean;
      structuredContent?: T;
    }>('tools/call', {
      name,
      arguments: args,
    });
    if (result.isError === true) {
      throw new Error(`MCP tool ${name} returned isError=true`);
    }
    if (result.structuredContent === undefined) {
      throw new Error(`MCP tool ${name} returned no structuredContent`);
    }
    return result.structuredContent;
  }
}

const probeMcp = async (): Promise<boolean> => {
  try {
    await callTool('delta_v_list_sessions', {}, 1_500);
    return true;
  } catch {
    return false;
  }
};

const startMcpServerIfNeeded = async (): Promise<ReturnType<
  typeof spawn
> | null> => {
  if (await probeMcp()) {
    process.stderr.write(`Using existing MCP HTTP server at ${MCP_URL}\n`);
    return null;
  }

  if (!START_MCP_SERVER || process.env.MCP_URL) {
    throw new Error(
      `No MCP HTTP server responded at ${MCP_URL}. Start one with npm run mcp:delta-v:http or unset MCP_URL so this script can start it.`,
    );
  }

  process.stderr.write(`Starting MCP HTTP server on port ${MCP_PORT}\n`);
  const child = spawn(
    'npm',
    ['run', 'mcp:delta-v:http', '--', String(MCP_PORT)],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, SERVER_URL },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    if (process.env.VERBOSE_MCP_SMOKE === '1') {
      process.stderr.write(text);
    }
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null) {
      throw new Error(
        `MCP HTTP server exited early with code ${child.exitCode}: ${stderr}`,
      );
    }
    if (await probeMcp()) {
      return child;
    }
    await sleep(250);
  }

  child.kill('SIGTERM');
  throw new Error(`Timed out waiting for MCP HTTP server: ${stderr}`);
};

const queueSeat = async (
  label: string,
  rendezvousCode: string,
): Promise<QueuedSeat> => {
  const playerKey = `agent_smoke_${label.toLowerCase()}_${RUN_ID.toLowerCase()}`;
  const queued = await callTool<QuickMatchQueuedResponse>(
    'delta_v_quick_match_connect',
    {
      serverUrl: SERVER_URL,
      scenario: SCENARIO,
      username: `Smoke-${label}`,
      playerKey,
      rendezvousCode,
      agentSandbox: true,
      waitForOpponent: false,
      pollMs: 500,
      timeoutMs: 30_000,
    },
  );

  if (queued.status !== 'queued' || !queued.ticket) {
    throw new Error(
      `Seat ${label} did not return a queued ticket: ${JSON.stringify(queued)}`,
    );
  }
  if (queued.connected === true) {
    throw new Error(`Seat ${label} connected before paired-ticket smoke step`);
  }
  return {
    label,
    playerKey,
    ticket: queued.ticket,
  };
};

const asArray = <T>(value: unknown): T[] => {
  if (!Array.isArray(value)) return [];
  return value as T[];
};

const phaseFromObservation = (observation: WaitForTurnResponse): string => {
  return (
    observation.legalActionInfo?.phase ?? observation.state?.phase ?? 'unknown'
  );
};

const recommendedIndexFor = (
  observation: WaitForTurnResponse,
  candidates: CandidateAction[],
): number => {
  const raw = observation.recommendedIndex;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return 0;
  return Math.max(0, Math.min(raw, Math.max(0, candidates.length - 1)));
};

const findAction = (
  candidates: CandidateAction[],
  recommendedIndex: number,
  type: string,
): CandidateAction | null => {
  return (
    candidates.find((candidate) => candidate.type === type) ??
    candidates[recommendedIndex] ??
    null
  );
};

const chooseAction = (
  observation: WaitForTurnResponse,
): CandidateAction | null => {
  const candidates = asArray<CandidateAction>(observation.candidates);
  if (candidates.length === 0) return null;

  const recommendedIndex = recommendedIndexFor(observation, candidates);
  const phase = phaseFromObservation(observation);
  switch (phase) {
    case 'fleetBuilding':
      return findAction(candidates, recommendedIndex, 'fleetReady');
    case 'astrogation':
      return findAction(candidates, recommendedIndex, 'astrogation');
    case 'ordnance':
      return findAction(candidates, recommendedIndex, 'skipOrdnance');
    case 'combat':
      return findAction(candidates, recommendedIndex, 'skipCombat');
    case 'logistics':
      return findAction(candidates, recommendedIndex, 'skipLogistics');
    default:
      return candidates[recommendedIndex] ?? null;
  }
};

const driveSeat = async (
  label: string,
  sessionId: string,
  playerId: 0 | 1 | null,
  stop: { actions: number; done: boolean },
): Promise<SeatResult> => {
  const result: SeatResult = {
    label,
    sessionId,
    playerId,
    actions: 0,
    phases: [],
    issues: [],
  };

  while (!stop.done) {
    let observation: WaitForTurnResponse;
    try {
      observation = await callTool<WaitForTurnResponse>(
        'delta_v_wait_for_turn',
        {
          sessionId,
          timeoutMs: TURN_TIMEOUT_MS,
          includeSummary: true,
          includeLegalActionInfo: true,
          includeCandidateLabels: true,
          compactState: true,
        },
        TURN_TIMEOUT_MS + HTTP_TIMEOUT_PAD_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (stop.done && message.includes('timed out')) break;
      if (message.includes('reached gameOver')) break;
      result.issues.push(`wait_for_turn failed: ${message}`);
      break;
    }

    const phase = phaseFromObservation(observation);
    result.phases.push(phase);

    if (observation.agentReady?.actionable !== true) {
      result.issues.push(
        `agentReady did not report actionable=true for phase ${phase}`,
      );
      break;
    }

    const action = chooseAction(observation);
    if (!action) {
      result.issues.push(`No candidate action returned for phase ${phase}`);
      break;
    }

    const allowedTypes = asArray<string>(
      observation.legalActionInfo?.allowedTypes,
    );
    if (allowedTypes.length > 0 && !allowedTypes.includes(action.type)) {
      result.issues.push(
        `Chosen action ${action.type} is not allowed in ${phase}; allowed=${allowedTypes.join(
          ',',
        )}`,
      );
      break;
    }

    const validation = await callTool<ValidateActionResponse>(
      'delta_v_validate_action',
      { sessionId, action },
    );
    if (validation.valid !== true) {
      result.issues.push(
        `Validation rejected ${action.type}: ${validation.stage ?? 'unknown'} ${validation.message ?? ''}`.trim(),
      );
      break;
    }

    const sent = await callTool<SendActionResponse>(
      'delta_v_send_action',
      {
        sessionId,
        action,
        waitForResult: true,
        waitTimeoutMs: 10_000,
        includeNextObservation: false,
      },
      12_000,
    );
    if (sent.accepted === false) {
      result.issues.push(
        `send_action rejected ${action.type}: ${sent.reason ?? 'unknown'} ${sent.message ?? ''}`.trim(),
      );
      break;
    }

    result.actions += 1;
    stop.actions += 1;
    process.stderr.write(
      `[${label}] ${phase} -> ${action.type} (${sent.accepted === null ? 'pending' : 'accepted'})\n`,
    );

    if (stop.actions >= MAX_ACTIONS) {
      stop.done = true;
    }
  }

  return result;
};

const assertHiddenFromPublicLive = async (
  matchCode: string,
  issues: string[],
): Promise<void> => {
  if (!CHECK_PUBLIC_LIVE) return;
  const url = new URL('/api/matches', SERVER_URL);
  url.searchParams.set('status', 'live');
  const response = await fetch(url);
  if (!response.ok) {
    issues.push(`Public live-list check failed: HTTP ${response.status}`);
    return;
  }
  const body = (await response.json()) as LiveMatchesResponse;
  const publicMatch = asArray<{ code?: string }>(body.matches).find(
    (match) => match.code === matchCode,
  );
  if (publicMatch) {
    issues.push(
      `Sandbox match ${matchCode} appeared in /api/matches?status=live`,
    );
  }
};

const resourceKindFromUri = (
  uri: string,
): 'matchLog' | 'matchObservation' | 'matchReplay' | null => {
  if (uri.endsWith('/observation')) return 'matchObservation';
  if (uri.endsWith('/log')) return 'matchLog';
  if (uri.endsWith('/replay')) return 'matchReplay';
  return null;
};

const extractMatchTokenFromResourceUri = (uri: string): string | null => {
  const match = uri.match(
    /^game:\/\/matches\/(.+)\/(?:observation|log|replay)$/,
  );
  return match?.[1] ?? null;
};

const assertHostedResourceReads = async (
  seat: QueuedSeat,
  issues: string[],
): Promise<HostedResourceSmokeResult> => {
  if (!CHECK_HOSTED_RESOURCES) {
    return { checked: false, resources: [] };
  }

  const client = await HostedMcpClient.create(seat.playerKey);
  let matchToken: string | null = null;
  try {
    const listed = await client.rpc<HostedResourceListResult>(
      'resources/list',
      undefined,
      15_000,
    );
    const resources = asArray<HostedResource>(listed.resources).filter(
      (resource) => resource.uri.startsWith('game://matches/'),
    );
    const byKind = new Map<string, HostedResource>();
    for (const resource of resources) {
      const kind = resourceKindFromUri(resource.uri);
      if (kind) byKind.set(kind, resource);
    }

    const expectedKinds = [
      'matchObservation',
      'matchLog',
      'matchReplay',
    ] as const;
    for (const kind of expectedKinds) {
      const resource = byKind.get(kind);
      if (!resource) {
        issues.push(
          `Hosted resources/list missing ${kind} for seat ${seat.label}`,
        );
        continue;
      }

      matchToken ??= extractMatchTokenFromResourceUri(resource.uri);
      const read = await client.rpc<HostedResourceReadResult>(
        'resources/read',
        { uri: resource.uri },
        15_000,
      );
      const first = asArray<HostedResourceContent>(read.contents)[0];
      if (!first) {
        issues.push(`Hosted resources/read returned no content for ${kind}`);
        continue;
      }
      if (first.uri !== resource.uri) {
        issues.push(
          `Hosted ${kind} content URI mismatch: expected ${resource.uri}, got ${first.uri}`,
        );
      }
      if (first.mimeType !== 'application/json') {
        issues.push(
          `Hosted ${kind} content mimeType mismatch: ${first.mimeType ?? 'missing'}`,
        );
      }
      let parsed: { kind?: unknown };
      try {
        parsed = JSON.parse(first.text ?? '{}') as { kind?: unknown };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(`Hosted ${kind} resource JSON parse failed: ${message}`);
        continue;
      }
      if (parsed.kind !== kind) {
        issues.push(
          `Hosted ${kind} document kind mismatch: ${String(parsed.kind)}`,
        );
      }
    }

    return {
      checked: true,
      resources: resources.map((resource) => resource.uri).sort(),
    };
  } finally {
    if (matchToken) {
      try {
        await client.callTool('delta_v_close_session', { matchToken });
      } catch {
        // Best-effort cleanup only; the underlying sandbox match still expires normally.
      }
    }
  }
};

const closeSessions = async (sessionIds: string[]): Promise<void> => {
  const closes = sessionIds.map(async (sessionId) => {
    try {
      await callTool('delta_v_close_session', { sessionId }, 5_000);
    } catch {
      // Session cleanup is best-effort; the game server has its own idle expiry.
    }
  });
  await Promise.all(closes);
};

const main = async (): Promise<void> => {
  const rendezvousCode = ensureCodeFitsQueue(RENDEZVOUS_CODE);
  const mcpChild = await startMcpServerIfNeeded();
  const issues: string[] = [];
  let sessionIds: string[] = [];

  const stopChild = (): void => {
    if (mcpChild && mcpChild.exitCode === null) {
      mcpChild.kill('SIGTERM');
    }
  };
  process.once('SIGINT', () => {
    stopChild();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stopChild();
    process.exit(143);
  });

  try {
    process.stderr.write(
      `Queueing sandbox quick match on ${SERVER_URL} (${SCENARIO}, ${rendezvousCode})\n`,
    );
    const [leftSeat, rightSeat] = await Promise.all([
      queueSeat('A', rendezvousCode),
      queueSeat('B', rendezvousCode),
    ]);

    const paired = await callTool<PairTicketsResponse>(
      'delta_v_pair_quick_match_tickets',
      {
        serverUrl: SERVER_URL,
        leftTicket: leftSeat.ticket,
        rightTicket: rightSeat.ticket,
        pollMs: 500,
        timeoutMs: 60_000,
      },
      65_000,
    );

    if (paired.agentSandbox !== true) {
      issues.push('Paired match did not report agentSandbox=true');
    }
    sessionIds = [paired.left.sessionId, paired.right.sessionId];
    await assertHiddenFromPublicLive(paired.code, issues);
    const hostedResources = await assertHostedResourceReads(leftSeat, issues);

    const stop = { actions: 0, done: false };
    const [leftResult, rightResult] = await Promise.all([
      driveSeat('A', paired.left.sessionId, paired.left.playerId ?? null, stop),
      driveSeat(
        'B',
        paired.right.sessionId,
        paired.right.playerId ?? null,
        stop,
      ),
    ]);

    issues.push(...leftResult.issues, ...rightResult.issues);
    if (stop.actions < MIN_ACTIONS) {
      issues.push(
        `Only submitted ${stop.actions} action(s); expected at least ${MIN_ACTIONS}`,
      );
    }

    const summary = {
      ok: issues.length === 0,
      serverUrl: SERVER_URL,
      mcpUrl: MCP_URL,
      scenario: paired.scenario,
      rendezvousCode,
      matchCode: paired.code,
      actions: stop.actions,
      minActions: MIN_ACTIONS,
      maxActions: MAX_ACTIONS,
      hostedResources,
      issues,
      seats: [leftResult, rightResult],
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (issues.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeSessions(sessionIds);
    stopChild();
  }
};

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
