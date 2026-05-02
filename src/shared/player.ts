export interface PublicPlayerProfile {
  playerKey: string;
  username: string;
}

// Explicit identity-lifecycle classification for `player` rows
// (migration 0009). Replaces username-prefix globbing for retention,
// archive-quality, and recovery-eligibility decisions.
//
//   claimed_human  - explicit POST /api/claim-name with a real callsign
//   default_human  - matchmaker auto-claim with `Pilot XXXX` default
//   agent          - POST /api/agent-token (not the official bot)
//   official_bot   - OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY
//   seed_agent     - bootstrap / seeded thematic agents
//   test           - reserved-test prefixes (QA_, Probe_, Bot_)
export const IDENTITY_KINDS = [
  'claimed_human',
  'default_human',
  'agent',
  'official_bot',
  'seed_agent',
  'test',
] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

export const isIdentityKind = (value: unknown): value is IdentityKind =>
  typeof value === 'string' &&
  (IDENTITY_KINDS as readonly string[]).includes(value);

export const OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY =
  'agent_official_quickmatch_normal';
export const OFFICIAL_QUICK_MATCH_BOT_USERNAME = 'Official Bot';

export const isOfficialQuickMatchBotPlayerKey = (playerKey: string): boolean =>
  playerKey === OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY;

export const buildOfficialQuickMatchBotProfile = (): PublicPlayerProfile => ({
  playerKey: OFFICIAL_QUICK_MATCH_BOT_PLAYER_KEY,
  username: OFFICIAL_QUICK_MATCH_BOT_USERNAME,
});

export const hasOfficialQuickMatchBot = (
  players: readonly Pick<PublicPlayerProfile, 'playerKey'>[],
): boolean =>
  players.some((player) => isOfficialQuickMatchBotPlayerKey(player.playerKey));

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
