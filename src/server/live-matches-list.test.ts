import { describe, expect, it, vi } from 'vitest';

import type { Env } from './env';
import {
  handleLiveMatchesList,
  type LiveMatchListingResponse,
} from './live-matches-list';

const buildEnv = (registryResponse: unknown | null): Env => {
  if (registryResponse === null) {
    return { LIVE_REGISTRY: undefined } as unknown as Env;
  }

  const stub = {
    fetch: vi.fn(async () => Response.json(registryResponse)),
  };

  return {
    LIVE_REGISTRY: {
      idFromName: vi.fn(() => 'global-id'),
      get: vi.fn(() => stub),
    },
  } as unknown as Env;
};

describe('handleLiveMatchesList', () => {
  it('returns live matches from the registry', async () => {
    const response = await handleLiveMatchesList(
      buildEnv({
        matches: [{ code: 'ABCDE', scenario: 'duel', startedAt: Date.now() }],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as LiveMatchListingResponse;
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].code).toBe('ABCDE');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns an empty listing when LIVE_REGISTRY is not bound', async () => {
    const response = await handleLiveMatchesList(buildEnv(null));

    expect(response.status).toBe(200);
    const body = (await response.json()) as LiveMatchListingResponse;
    expect(body.matches).toEqual([]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns an empty listing when registry has no matches', async () => {
    const response = await handleLiveMatchesList(buildEnv({ matches: [] }));

    const body = (await response.json()) as LiveMatchListingResponse;
    expect(body.matches).toEqual([]);
  });
});
