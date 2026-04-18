// Canonical quick-match queue-and-poll helper used by the MCP server,
// the single-agent quick-match runner, and the scrimmage harness.
// Keep this side-effect free (only calls fetch + setTimeout) so it stays
// safe to import from anywhere.

import type { QuickMatchResponse } from '../matchmaking';

export interface QuickMatchArgs {
  serverUrl: string;
  scenario: string;
  username: string;
  playerKey: string;
  pollMs?: number;
  timeoutMs?: number;
  /**
   * When omitted and `playerKey` starts with `agent_`, a token is minted via
   * POST /api/agent-token then sent as Authorization on `/quick-match`.
   */
  authorizationBearer?: string;
}

export interface QuickMatchResult {
  code: string;
  playerToken: string;
  ticket: string;
}

const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

/** Strip trailing slashes and map WebSocket URLs to HTTP for REST calls. */
export const normalizeQuickMatchServerUrl = (raw: string): string => {
  let u = raw.trim().replace(/\/+$/, '');
  if (u.startsWith('ws://')) {
    u = `http://${u.slice(5)}`;
  } else if (u.startsWith('wss://')) {
    u = `https://${u.slice(6)}`;
  }
  return u;
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw || 'request failed'}`);
  }
  return JSON.parse(raw) as T;
};

// Enqueue the player into the public quick-match queue and poll until matched,
// expired, or the caller-supplied timeout elapses. playerKey should be prefixed
// with "agent_" for bot tagging; enforce that at call sites rather than here so
// the server keeps the single point of truth.
export const queueForMatch = async (
  args: QuickMatchArgs,
): Promise<QuickMatchResult> => {
  const serverUrl = normalizeQuickMatchServerUrl(args.serverUrl);
  const pollMs = args.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let bearer = args.authorizationBearer;
  if (args.playerKey.startsWith('agent_') && !bearer) {
    const issued = await fetchJson<{
      ok: boolean;
      token?: string;
      error?: string;
    }>(`${serverUrl}/api/agent-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerKey: args.playerKey }),
    });
    if (!issued.ok || !issued.token) {
      throw new Error(
        `agent-token issuance failed: ${issued.error ?? 'unknown'} (agent playerKeys require a Bearer token for quick-match)`,
      );
    }
    bearer = issued.token;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  const enqueue = await fetchJson<QuickMatchResponse>(
    `${serverUrl}/quick-match`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scenario: args.scenario,
        player: {
          playerKey: args.playerKey,
          username: args.username,
        },
      }),
    },
  );

  if (enqueue.status === 'matched') {
    return {
      code: enqueue.code,
      playerToken: enqueue.playerToken,
      ticket: enqueue.ticket,
    };
  }

  if (enqueue.status !== 'queued') {
    throw new Error(`Unexpected quick-match status: ${enqueue.status}`);
  }

  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Quick-match timed out after ${timeoutMs}ms (no opponent joined in time; start a second client or MCP session, or raise timeoutMs).`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    const poll = await fetchJson<QuickMatchResponse>(
      `${serverUrl}/quick-match/${enqueue.ticket}`,
    );
    if (poll.status === 'matched') {
      return {
        code: poll.code,
        playerToken: poll.playerToken,
        ticket: poll.ticket,
      };
    }
    if (poll.status === 'expired') {
      throw new Error(`Quick-match expired: ${poll.reason}`);
    }
  }
};
