import { describe, expect, it, vi } from 'vitest';

import { fetchPlayerRank, postClaimName } from './api';

describe('leaderboard api', () => {
  it('uses the injected fetch for claim-name requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        player: {
          username: 'Pilot 1',
          isAgent: false,
          rating: 1200,
          rd: 150,
          gamesPlayed: 3,
        },
        renamed: false,
      }),
    );

    const result = await postClaimName({
      playerKey: 'player-key',
      username: 'Pilot 1',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      player: {
        username: 'Pilot 1',
        isAgent: false,
        rating: 1200,
        rd: 150,
        gamesPlayed: 3,
      },
      renamed: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/claim-name',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('uses the injected fetch for player-rank requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        username: 'Pilot 1',
        rating: 1215,
        rd: 140,
        gamesPlayed: 9,
        provisional: false,
        rank: 12,
      }),
    );

    const result = await fetchPlayerRank({
      playerKey: 'player-key',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      player: {
        username: 'Pilot 1',
        rating: 1215,
        rd: 140,
        gamesPlayed: 9,
        provisional: false,
        rank: 12,
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/leaderboard/me?playerKey=player-key',
    );
  });
});
