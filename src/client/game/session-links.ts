export interface LocationLike {
  protocol: string;
  host: string;
  origin: string;
}

export const buildGameRoute = (code: string): string => {
  return `/?code=${code}`;
};

export const buildJoinCheckUrl = (
  location: Pick<LocationLike, 'origin'>,
  code: string,
  playerToken: string | null,
): string => {
  const url = new URL(`/join/${code}`, location.origin);

  if (playerToken) {
    url.searchParams.set('playerToken', playerToken);
  }

  return url.toString();
};

export const buildWebSocketUrl = (
  location: LocationLike,
  code: string,
  playerToken: string | null,
  options?: { viewer?: 'spectator' },
): string => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${location.host}/ws/${code}`;

  if (options?.viewer === 'spectator') {
    return `${base}?viewer=spectator`;
  }

  const tokenSuffix = playerToken
    ? `?playerToken=${encodeURIComponent(playerToken)}`
    : '';

  return `${base}${tokenSuffix}`;
};
