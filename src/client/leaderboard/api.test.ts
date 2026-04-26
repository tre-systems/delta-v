import { describe, expect, it, vi } from 'vitest';

import {
  fetchPlayerRank,
  issueRecoveryCode,
  postClaimName,
  restoreRecoveryCode,
  revokeRecoveryCode,
} from './api';

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

  it('issues recovery codes through the injected fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        recoveryCode: 'dv1-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ',
      }),
    );

    const result = await issueRecoveryCode({
      playerKey: 'human_alpha-v1',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      recoveryCode: 'dv1-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/player-recovery/issue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ playerKey: 'human_alpha-v1' }),
      }),
    );
  });

  it('maps recovery issue failures', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      issueRecoveryCode({
        playerKey: 'human_missing-v1',
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, error: 'not_claimed' });
  });

  it('restores recovery codes through the injected fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        profile: {
          playerKey: 'human_alpha-v1',
          username: 'Zephyr',
        },
      }),
    );

    const result = await restoreRecoveryCode({
      recoveryCode: 'dv1-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      profile: {
        playerKey: 'human_alpha-v1',
        username: 'Zephyr',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/player-recovery/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          recoveryCode: 'dv1-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ',
        }),
      }),
    );
  });

  it('maps recovery restore failures', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 400 }));

    await expect(
      restoreRecoveryCode({
        recoveryCode: 'bad-code',
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_code' });
  });

  it('revokes recovery codes through the injected fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
      }),
    );

    const result = await revokeRecoveryCode({
      playerKey: 'human_alpha-v1',
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/player-recovery/revoke',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ playerKey: 'human_alpha-v1' }),
      }),
    );
  });
});
