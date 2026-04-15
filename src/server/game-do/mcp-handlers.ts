// HTTP endpoints inside the GAME Durable Object that serve the remote MCP
// path. The Worker's /mcp route translates JSON-RPC tool calls into these
// HTTP fetches, so the DO stays the single source of truth for state and
// the MCP transport itself owns no game-specific data.
//
// All routes require a valid playerToken (matches the pattern of the
// existing /join and /replay routes). Token → seat resolution is done from
// roomConfig.playerTokens, the same array WebSocket joins use.

import {
  type BuildObservationOptions,
  buildObservation,
  computeActionEffects,
} from '../../shared/agent';
import { filterStateForPlayer } from '../../shared/engine/game-engine';
import { isPlayerToken, type PlayerToken } from '../../shared/ids';
import { validateClientMessage } from '../../shared/protocol';
import {
  ErrorCode,
  type GameState,
  type PlayerId,
} from '../../shared/types/domain';
import type { C2S, S2C } from '../../shared/types/protocol';
import type { RoomConfig } from '../protocol';
import type { IdempotencyKeyCache } from './action-guards';
import {
  type createGameStateActionHandlers,
  type DispatchOutcome,
  dispatchGameStateActionForHttp,
  isGameStateActionMessage,
} from './actions';
import type { StateWaiters } from './state-waiters';

export interface McpRequestDeps {
  getRoomConfig: () => Promise<RoomConfig | null>;
  getCurrentGameState: () => Promise<GameState | null>;
  getGameCode: () => Promise<string>;
  reportEngineError: (
    code: string,
    phase: string,
    turn: number,
    err: unknown,
  ) => void;
  handlers: ReturnType<typeof createGameStateActionHandlers>;
  idempotencyCache: IdempotencyKeyCache;
  stateWaiters: StateWaiters;
  broadcast: (msg: S2C) => void;
  touchInactivity: () => Promise<void>;
  // MCP-only clients never establish a WebSocket, so the existing
  // "game starts when both seats connect" trigger never fires for them.
  // We call initGame() ourselves when both player tokens are filled and
  // there is no game state yet — same end state as a WS join would produce.
  initGameIfReady: () => Promise<void>;
}

const MAX_WAIT_TIMEOUT_MS = 25_000;
const DEFAULT_WAIT_TIMEOUT_MS = 25_000;
const MAX_ACTION_WAIT_MS = 25_000;
const DEFAULT_ACTION_WAIT_MS = 5_000;

const json = (body: unknown, status = 200): Response =>
  Response.json(body as Record<string, unknown>, { status });

const error = (status: number, message: string): Response =>
  json({ ok: false, error: message }, status);

// Look up which seat a presented token belongs to. Same logic as
// resolveSeatAssignment but read-only.
const resolveSeatFromToken = (
  roomConfig: RoomConfig,
  presented: PlayerToken,
): PlayerId | null => {
  if (roomConfig.playerTokens[0] === presented) return 0;
  if (roomConfig.playerTokens[1] === presented) return 1;
  return null;
};

interface AuthorizedRequest {
  playerToken: PlayerToken;
  playerId: PlayerId;
  roomConfig: RoomConfig;
}

// Common auth: extract & validate the token, look up the seat, ensure the
// room exists. Also kicks off initGame() if both seats are filled and we
// haven't started yet — the MCP-only path has no WebSocket connection to
// trigger the normal start path. Returns either the resolved triple or a
// Response to bail with.
const authorizeRequest = async (
  deps: McpRequestDeps,
  url: URL,
): Promise<
  { ok: true; value: AuthorizedRequest } | { ok: false; response: Response }
> => {
  const tokenRaw = url.searchParams.get('playerToken');
  if (!tokenRaw || !isPlayerToken(tokenRaw)) {
    return {
      ok: false,
      response: error(400, 'Invalid or missing playerToken'),
    };
  }
  const roomConfig = await deps.getRoomConfig();
  if (!roomConfig) {
    return { ok: false, response: error(404, 'Game not found') };
  }
  const playerId = resolveSeatFromToken(roomConfig, tokenRaw);
  if (playerId === null) {
    return { ok: false, response: error(403, 'Token does not match any seat') };
  }
  await deps.initGameIfReady();
  return {
    ok: true,
    value: { playerToken: tokenRaw, playerId, roomConfig },
  };
};

const parseObservationOptions = (
  source: URLSearchParams | Record<string, unknown>,
): BuildObservationOptions => {
  const get = (key: string): unknown =>
    source instanceof URLSearchParams ? source.get(key) : source[key];

  const truthy = (v: unknown): boolean =>
    v === true || v === 'true' || v === '1';

  return {
    gameCode: '',
    includeSummary: truthy(get('summary')) || truthy(get('includeSummary')),
    includeLegalActionInfo:
      truthy(get('legalActionInfo')) || truthy(get('includeLegalActionInfo')),
    includeTactical: truthy(get('tactical')) || truthy(get('includeTactical')),
    includeSpatialGrid:
      truthy(get('spatialGrid')) || truthy(get('includeSpatialGrid')),
    includeCandidateLabels:
      truthy(get('candidateLabels')) || truthy(get('includeCandidateLabels')),
  };
};

interface PlayerStateView {
  state: GameState;
  filtered: GameState;
}

const resolvePlayerState = async (
  deps: McpRequestDeps,
  playerId: PlayerId,
): Promise<PlayerStateView | null> => {
  const state = await deps.getCurrentGameState();
  if (!state) return null;
  return { state, filtered: filterStateForPlayer(state, playerId) };
};

const handleStateRequest = async (
  deps: McpRequestDeps,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);
  const auth = await authorizeRequest(deps, url);
  if (!auth.ok) return auth.response;
  const { playerId, roomConfig } = auth.value;
  const view = await resolvePlayerState(deps, playerId);
  await deps.touchInactivity();
  return json({
    ok: true,
    code: roomConfig.code,
    playerId,
    state: view?.filtered ?? null,
    hasState: view !== null,
  });
};

const handleObservationRequest = async (
  deps: McpRequestDeps,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);
  const auth = await authorizeRequest(deps, url);
  if (!auth.ok) return auth.response;
  const { playerId, roomConfig } = auth.value;
  const view = await resolvePlayerState(deps, playerId);
  if (!view) return error(409, 'Game has no state yet — wait for gameStart');
  const opts = parseObservationOptions(url.searchParams);
  opts.gameCode = roomConfig.code;
  const observation = buildObservation(view.filtered, playerId, opts);
  await deps.touchInactivity();
  return json({ ok: true, ...observation });
};

// Mirrors scripts/llm-player.ts:sendForState. fleetBuilding is the only
// truly simultaneous phase in the engine — every other phase requires
// state.activePlayer === playerId before submission, even astrogation
// (which feels simultaneous in the UI but is sequential at the engine
// level: the engine flips activePlayer to the other seat after the first
// submission).
const isActionable = (state: GameState, playerId: PlayerId): boolean => {
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
      void _exhaustive;
      return false;
    }
  }
};

const clampTimeout = (raw: unknown, max: number, fallback: number): number => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.max(1_000, Math.min(max, Math.floor(raw)));
};

const handleWaitRequest = async (
  deps: McpRequestDeps,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);
  const auth = await authorizeRequest(deps, url);
  if (!auth.ok) return auth.response;
  const { playerId, roomConfig } = auth.value;

  let body: Record<string, unknown> = {};
  try {
    if (request.headers.get('content-length') !== '0') {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object') {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Empty/invalid body is fine — defaults apply.
  }

  const timeoutMs = clampTimeout(
    body.timeoutMs,
    MAX_WAIT_TIMEOUT_MS,
    DEFAULT_WAIT_TIMEOUT_MS,
  );
  const opts = parseObservationOptions(body);
  opts.gameCode = roomConfig.code;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const view = await resolvePlayerState(deps, playerId);
    if (view) {
      if (view.state.phase === 'gameOver') {
        return json({
          ok: true,
          actionable: false,
          gameOver: true,
          observation: null,
          state: view.filtered,
        });
      }
      if (isActionable(view.state, playerId)) {
        const observation = buildObservation(view.filtered, playerId, opts);
        await deps.touchInactivity();
        return json({
          ok: true,
          actionable: true,
          gameOver: false,
          observation,
        });
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const arrived = await deps.stateWaiters.wait(playerId, remaining);
    if (!arrived) break;
  }

  return json({
    ok: true,
    actionable: false,
    gameOver: false,
    observation: null,
    timedOut: true,
  });
};

interface ActionRequestBody {
  action?: unknown;
  autoGuards?: unknown;
  waitForResult?: unknown;
  waitTimeoutMs?: unknown;
  includeNextObservation?: unknown;
  includeSummary?: unknown;
  includeLegalActionInfo?: unknown;
  includeTactical?: unknown;
  includeSpatialGrid?: unknown;
  includeCandidateLabels?: unknown;
}

const buildActionPayload = (
  raw: unknown,
  state: GameState,
  shouldAutoGuard: boolean,
): { ok: true; value: C2S } | { ok: false; error: string } => {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'action must be an object with a `type` field' };
  }
  // Lift turn/phase guards from current state when the caller didn't supply
  // them. Mirror of the local MCP server's autoGuard logic so HTTP and stdio
  // agents behave the same. Skipped when shouldAutoGuard=false or the agent
  // already provided guards explicitly.
  let candidate = raw as Record<string, unknown> & { type: string };
  const hasGuards = candidate.guards !== undefined && candidate.guards !== null;
  if (shouldAutoGuard && !hasGuards) {
    candidate = {
      ...candidate,
      guards: {
        expectedTurn: state.turnNumber,
        expectedPhase: state.phase,
        idempotencyKey: `t${state.turnNumber}-${state.phase}-${crypto.randomUUID()}`,
      },
    };
  }
  const validated = validateClientMessage(candidate);
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, value: validated.value };
};

const buildOptionalObservation = (
  body: ActionRequestBody,
  view: PlayerStateView,
  playerId: PlayerId,
  gameCode: string,
): Record<string, unknown> | undefined => {
  if (body.includeNextObservation !== true) return undefined;
  const opts = parseObservationOptions(body as Record<string, unknown>);
  opts.gameCode = gameCode;
  return { ...buildObservation(view.filtered, playerId, opts) };
};

const handleActionRequest = async (
  deps: McpRequestDeps,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);
  const auth = await authorizeRequest(deps, url);
  if (!auth.ok) return auth.response;
  const { playerId, roomConfig } = auth.value;

  let body: ActionRequestBody;
  try {
    body = (await request.json()) as ActionRequestBody;
  } catch {
    return error(400, 'Invalid JSON body');
  }

  const stateBefore = await deps.getCurrentGameState();
  if (!stateBefore) return error(409, 'Game has no state yet');

  const shouldAutoGuard = body.autoGuards !== false;
  const built = buildActionPayload(body.action, stateBefore, shouldAutoGuard);
  if (!built.ok) return error(400, built.error);
  const action = built.value;

  // Aux messages (chat/ping/rematch) are out of scope for /mcp/action.
  // /mcp/chat handles chat; rematch isn't part of the agent loop today.
  if (!isGameStateActionMessage(action)) {
    return error(
      400,
      `Action type "${action.type}" is not a game-state action`,
    );
  }

  const outcome: DispatchOutcome = await dispatchGameStateActionForHttp(
    playerId,
    action,
    {
      getCurrentGameState: deps.getCurrentGameState,
      getGameCode: deps.getGameCode,
      reportEngineError: deps.reportEngineError,
      handlers: deps.handlers,
      idempotencyCache: deps.idempotencyCache,
    },
  );

  await deps.touchInactivity();

  if (outcome.kind === 'noState') {
    return error(409, 'Game has no state yet');
  }
  if (outcome.kind === 'rejected') {
    return json(
      {
        ok: true,
        accepted: false,
        actionType: action.type,
        rejection: outcome.rejected,
      },
      200,
    );
  }
  if (outcome.kind === 'error') {
    return json(
      {
        ok: false,
        accepted: false,
        actionType: action.type,
        error: outcome.message,
        code: outcome.code ?? ErrorCode.STATE_CONFLICT,
      },
      400,
    );
  }

  const waitForResult = body.waitForResult === true;
  if (!waitForResult) {
    return json({
      ok: true,
      accepted: true,
      actionType: action.type,
      pending: true,
      guarded: action.guards !== undefined,
    });
  }

  const waitMs = clampTimeout(
    body.waitTimeoutMs,
    MAX_ACTION_WAIT_MS,
    DEFAULT_ACTION_WAIT_MS,
  );
  const deadline = Date.now() + waitMs;

  // Wait until the publishStateChange triggered by our action lands, or
  // until a state-bearing event arrives that lets us compute effects. The
  // accepted-but-pending case (e.g. simultaneous astrogation waiting on the
  // opponent) returns with pending=true after the timeout.
  while (Date.now() < deadline) {
    const after = await resolvePlayerState(deps, playerId);
    if (after && after.state !== stateBefore) {
      const { effects, turnAdvanced, phaseChanged } = computeActionEffects(
        stateBefore,
        after.state,
        playerId,
      );
      return json({
        ok: true,
        accepted: true,
        actionType: action.type,
        turnApplied: stateBefore.turnNumber,
        phaseApplied: stateBefore.phase,
        nextTurn: after.state.turnNumber,
        nextPhase: after.state.phase,
        nextActivePlayer: after.state.activePlayer,
        turnAdvanced,
        phaseChanged,
        effects,
        nextObservation: buildOptionalObservation(
          body,
          after,
          playerId,
          roomConfig.code,
        ),
      });
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await deps.stateWaiters.wait(playerId, remaining);
  }

  return json({
    ok: true,
    accepted: true,
    actionType: action.type,
    pending: true,
    guarded: action.guards !== undefined,
  });
};

const handleChatRequest = async (
  deps: McpRequestDeps,
  request: Request,
): Promise<Response> => {
  const url = new URL(request.url);
  const auth = await authorizeRequest(deps, url);
  if (!auth.ok) return auth.response;
  const { playerId } = auth.value;

  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return error(400, 'Invalid JSON body');
  }
  if (typeof body.text !== 'string') return error(400, 'text is required');
  const text = body.text.trim();
  if (text.length === 0 || text.length > 200) {
    return error(400, 'text must be 1-200 characters');
  }

  deps.broadcast({ type: 'chat', playerId, text });
  await deps.touchInactivity();
  return json({ ok: true, sent: true, text });
};

// Entry point dispatched from handleGameDoFetch. Returns null when the
// pathname/method combination is not an MCP route so the caller can continue
// matching (WebSocket upgrade, /init, etc.).
export const handleMcpRequest = async (
  deps: McpRequestDeps,
  request: Request,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/mcp/state' && request.method === 'GET') {
    return handleStateRequest(deps, request);
  }
  if (path === '/mcp/observation' && request.method === 'GET') {
    return handleObservationRequest(deps, request);
  }
  if (path === '/mcp/wait' && request.method === 'POST') {
    return handleWaitRequest(deps, request);
  }
  if (path === '/mcp/action' && request.method === 'POST') {
    return handleActionRequest(deps, request);
  }
  if (path === '/mcp/chat' && request.method === 'POST') {
    return handleChatRequest(deps, request);
  }
  return null;
};
