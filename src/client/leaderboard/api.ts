// Client-side POST helper for /api/claim-name. Translates HTTP
// outcomes into a discriminated union the UI can branch on without
// caring about fetch details.
//
// `username` in the request body matches the server contract and also
// the Callsign field the user types — one vocabulary end-to-end.

export interface ClaimedPlayer {
  username: string;
  isAgent: boolean;
  rating: number;
  rd: number;
  gamesPlayed: number;
}

export type ClaimNameResult =
  | { ok: true; player: ClaimedPlayer; renamed: boolean }
  | {
      ok: false;
      error:
        | 'invalid_name'
        | 'name_taken'
        | 'rate_limited'
        | 'unavailable'
        | 'network'
        | 'unknown';
      message?: string;
    };

export interface PostClaimNameOpts {
  playerKey: string;
  username: string;
  fetchImpl: typeof fetch;
}

export const postClaimName = async (
  opts: PostClaimNameOpts,
): Promise<ClaimNameResult> => {
  let res: Response;
  try {
    res = await opts.fetchImpl('/api/claim-name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerKey: opts.playerKey,
        username: opts.username,
      }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      player?: ClaimedPlayer;
      renamed?: boolean;
    } | null;
    if (body?.ok && body.player) {
      return {
        ok: true,
        player: body.player,
        renamed: Boolean(body.renamed),
      };
    }
    return { ok: false, error: 'unknown' };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    return {
      ok: false,
      error: 'invalid_name',
      message: body?.error,
    };
  }
  if (res.status === 409) {
    return { ok: false, error: 'name_taken' };
  }
  if (res.status === 429) {
    return { ok: false, error: 'rate_limited' };
  }
  if (res.status === 503) {
    return { ok: false, error: 'unavailable' };
  }
  return { ok: false, error: 'unknown' };
};

export interface PlayerRank {
  username: string;
  rating: number;
  rd: number;
  gamesPlayed: number;
  provisional: boolean;
  // Non-null only for non-provisional players.
  rank: number | null;
}

export type FetchPlayerRankResult =
  | { ok: true; player: PlayerRank }
  | { ok: false; error: 'not_found' | 'network' | 'unavailable' | 'unknown' };

export const fetchPlayerRank = async (opts: {
  playerKey: string;
  fetchImpl: typeof fetch;
}): Promise<FetchPlayerRankResult> => {
  let res: Response;
  try {
    res = await opts.fetchImpl(
      `/api/leaderboard/me?playerKey=${encodeURIComponent(opts.playerKey)}`,
    );
  } catch {
    return { ok: false, error: 'network' };
  }
  if (res.status === 200) {
    const body = (await res.json().catch(() => null)) as PlayerRank | null;
    if (body && typeof body.username === 'string') {
      return { ok: true, player: body };
    }
    return { ok: false, error: 'unknown' };
  }
  if (res.status === 404) {
    return { ok: false, error: 'not_found' };
  }
  if (res.status === 503) {
    return { ok: false, error: 'unavailable' };
  }
  return { ok: false, error: 'unknown' };
};

export type IssueRecoveryCodeResult =
  | { ok: true; recoveryCode: string }
  | {
      ok: false;
      error:
        | 'invalid_player'
        | 'not_claimed'
        | 'rate_limited'
        | 'unavailable'
        | 'network'
        | 'unknown';
    };

export const issueRecoveryCode = async (opts: {
  playerKey: string;
  fetchImpl: typeof fetch;
}): Promise<IssueRecoveryCodeResult> => {
  let res: Response;
  try {
    res = await opts.fetchImpl('/api/player-recovery/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerKey: opts.playerKey }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      recoveryCode?: unknown;
    } | null;
    if (body?.ok && typeof body.recoveryCode === 'string') {
      return { ok: true, recoveryCode: body.recoveryCode };
    }
    return { ok: false, error: 'unknown' };
  }
  if (res.status === 400) {
    return { ok: false, error: 'invalid_player' };
  }
  if (res.status === 404) {
    return { ok: false, error: 'not_claimed' };
  }
  if (res.status === 429) {
    return { ok: false, error: 'rate_limited' };
  }
  if (res.status === 503) {
    return { ok: false, error: 'unavailable' };
  }
  return { ok: false, error: 'unknown' };
};

export interface RestoredPlayerProfile {
  playerKey: string;
  username: string;
}

export type RestoreRecoveryCodeResult =
  | { ok: true; profile: RestoredPlayerProfile }
  | {
      ok: false;
      error:
        | 'invalid_code'
        | 'not_found'
        | 'rate_limited'
        | 'unavailable'
        | 'network'
        | 'unknown';
    };

export const restoreRecoveryCode = async (opts: {
  recoveryCode: string;
  fetchImpl: typeof fetch;
}): Promise<RestoreRecoveryCodeResult> => {
  let res: Response;
  try {
    res = await opts.fetchImpl('/api/player-recovery/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryCode: opts.recoveryCode }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      profile?: Partial<RestoredPlayerProfile>;
    } | null;
    if (
      body?.ok &&
      typeof body.profile?.playerKey === 'string' &&
      typeof body.profile.username === 'string'
    ) {
      return {
        ok: true,
        profile: {
          playerKey: body.profile.playerKey,
          username: body.profile.username,
        },
      };
    }
    return { ok: false, error: 'unknown' };
  }
  if (res.status === 400) {
    return { ok: false, error: 'invalid_code' };
  }
  if (res.status === 404) {
    return { ok: false, error: 'not_found' };
  }
  if (res.status === 429) {
    return { ok: false, error: 'rate_limited' };
  }
  if (res.status === 503) {
    return { ok: false, error: 'unavailable' };
  }
  return { ok: false, error: 'unknown' };
};

export type RevokeRecoveryCodeResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_player'
        | 'rate_limited'
        | 'unavailable'
        | 'network'
        | 'unknown';
    };

export const revokeRecoveryCode = async (opts: {
  playerKey: string;
  fetchImpl: typeof fetch;
}): Promise<RevokeRecoveryCodeResult> => {
  let res: Response;
  try {
    res = await opts.fetchImpl('/api/player-recovery/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerKey: opts.playerKey }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    return { ok: true };
  }
  if (res.status === 400) {
    return { ok: false, error: 'invalid_player' };
  }
  if (res.status === 429) {
    return { ok: false, error: 'rate_limited' };
  }
  if (res.status === 503) {
    return { ok: false, error: 'unavailable' };
  }
  return { ok: false, error: 'unknown' };
};
