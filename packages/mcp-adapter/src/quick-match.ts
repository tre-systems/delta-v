// Worker-side helper that drives the existing MATCHMAKER Durable Object
// from inside an MCP tool call. Mirrors what an external HTTP client does
// (`POST /quick-match` then poll `GET /quick-match/{ticket}`) but stays
// in-process via `env.MATCHMAKER.get(...).fetch(...)` so we avoid a network
// hop.
//
// Returns the matched room code + playerToken once the matchmaker pairs us
// with an opponent, or throws on timeout / expiry.

import type { Env } from '../../../src/server/env';
import { QUICK_MATCH_VERIFIED_AGENT_HEADER } from '../../../src/server/quick-match-internal';
import { isValidScenario } from '../../../src/shared/map-data';
import type { QuickMatchResponse } from '../../../src/shared/matchmaking';

export interface QuickMatchArgs {
  scenario: string;
  username: string;
  playerKey: string;
  pollMs?: number;
  timeoutMs?: number;
  waitForOpponent?: boolean;
  /** When true, enqueue carries the internal verified-agent header for leaderboard isAgent. */
  verifiedLeaderboardAgent?: boolean;
}

export type QuickMatchResult =
  | {
      status: 'queued';
      ticket: string;
      scenario: string;
    }
  | {
      status: 'matched';
      code: string;
      playerToken: string;
      ticket: string;
      scenario: string;
    };

const MATCHMAKER_BASE = 'https://matchmaker.internal';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const queueRemoteMatch = async (
  env: Env,
  args: QuickMatchArgs,
): Promise<QuickMatchResult> => {
  if (!args.playerKey.startsWith('agent_')) {
    throw new Error(
      'playerKey must start with "agent_" for remote matchmaking',
    );
  }
  if (!isValidScenario(args.scenario)) {
    throw new Error(`Unknown scenario: ${args.scenario}`);
  }
  const matchmaker = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (args.verifiedLeaderboardAgent && args.playerKey.startsWith('agent_')) {
    headers[QUICK_MATCH_VERIFIED_AGENT_HEADER] = '1';
  }

  const enqueueResponse = await matchmaker.fetch(
    new Request(`${MATCHMAKER_BASE}/enqueue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scenario: args.scenario,
        player: {
          playerKey: args.playerKey,
          username: args.username,
        },
      }),
    }),
  );
  if (!enqueueResponse.ok) {
    throw new Error(
      `enqueue failed: ${enqueueResponse.status} ${await enqueueResponse.text()}`,
    );
  }
  const enqueued = (await enqueueResponse.json()) as QuickMatchResponse;
  if (enqueued.status !== 'queued') {
    throw new Error(
      `unexpected enqueue status: ${'status' in enqueued ? enqueued.status : 'unknown'}`,
    );
  }
  const ticket = enqueued.ticket;
  if (args.waitForOpponent === false) {
    return {
      status: 'queued',
      ticket,
      scenario: enqueued.scenario,
    };
  }
  const pollMs = args.pollMs ?? 750;
  const deadline = Date.now() + (args.timeoutMs ?? 60_000);

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const status = await matchmaker.fetch(
      new Request(`${MATCHMAKER_BASE}/ticket/${ticket}`, { method: 'GET' }),
    );
    if (!status.ok) {
      throw new Error(`poll failed: ${status.status} ${await status.text()}`);
    }
    const body = (await status.json()) as QuickMatchResponse;
    if (body.status === 'matched') {
      return {
        status: 'matched',
        code: body.code,
        playerToken: body.playerToken,
        ticket,
        scenario: body.scenario,
      };
    }
    if (body.status === 'expired') {
      throw new Error(`quick match expired: ${body.reason ?? 'no reason'}`);
    }
  }
  throw new Error('quick match timed out before pairing');
};
