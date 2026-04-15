// Handler for GET /api/matches?status=live — fetches the list of
// in-progress matches from the LIVE_REGISTRY singleton Durable Object.

import type { Env } from './env';
import type { LiveMatchEntry } from './live-registry-do';

export interface LiveMatchListingResponse {
  matches: LiveMatchEntry[];
}

export const handleLiveMatchesList = async (env: Env): Promise<Response> => {
  if (!env.LIVE_REGISTRY) {
    return Response.json({ matches: [] } satisfies LiveMatchListingResponse, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const stub = env.LIVE_REGISTRY.get(env.LIVE_REGISTRY.idFromName('global'));

  const res = await stub.fetch(
    new Request('https://live-registry.internal/list', { method: 'GET' }),
  );

  const body = (await res.json()) as LiveMatchListingResponse;

  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
};
