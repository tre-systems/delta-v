export interface PublicPlayerProfile {
  playerKey: string;
  username: string;
}

export const OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY =
  'agent_official_quickmatch_normal';
export const OFFICIAL_QUICK_MATCH_BOT_USERNAME = 'Official Bot';

export const isOfficialQuickMatchBotPlayerKey = (playerKey: string): boolean =>
  playerKey === OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY;

export const buildOfficialQuickMatchBotProfile = (): PublicPlayerProfile => ({
  playerKey: OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
  username: OFFICIAL_QUICK_MATCH_BOT_USERNAME,
});

const PLAYER_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9 _-]{2,20}$/;

const normalizeWhitespace = (value: string): string =>
  value.trim().replace(/\s+/g, ' ');

export const isValidPlayerKey = (value: unknown): value is string =>
  typeof value === 'string' && PLAYER_KEY_PATTERN.test(value);

export const normalizePlayerKey = (value: unknown): string | null =>
  isValidPlayerKey(value) ? value : null;

export const isValidUsername = (value: unknown): value is string =>
  typeof value === 'string' && USERNAME_PATTERN.test(value);

export const normalizeUsername = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  return isValidUsername(normalized) ? normalized : null;
};

export const buildDefaultUsername = (playerKey: string): string => {
  const suffix = playerKey
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(-4)
    .toUpperCase();
  return suffix.length > 0 ? `Pilot ${suffix}` : 'Pilot';
};
