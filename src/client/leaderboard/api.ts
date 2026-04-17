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
  fetchImpl?: typeof fetch;
}

export const postClaimName = async (
  opts: PostClaimNameOpts,
): Promise<ClaimNameResult> => {
  const fetcher = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetcher('/api/claim-name', {
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
