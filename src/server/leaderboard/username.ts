// Server-side username validation + moderation for the public
// leaderboard. Thin wrapper around `normalizeUsername` from
// shared/player.ts (format + whitespace normalisation) that adds a
// server-authoritative moderation pass.
//
// Callers that already have a normalised username (e.g. trusted
// internal flows) can skip straight to `isBlockedUsername`.

import { normalizeUsername } from '../../shared/player';

// Substring match, case-insensitive. Deliberately minimal — a floor,
// not a ceiling. Extend or replace with an operator-controlled list
// if moderation load grows.
const BLOCKED_SUBSTRINGS: readonly string[] = [
  'nigger',
  'nigga',
  'chink',
  'spic',
  'kike',
  'gook',
  'faggot',
  'retard',
  'tranny',
];

export type UsernameValidationError = 'invalid_format' | 'blocked';

export type UsernameValidation =
  | { ok: true; normalised: string }
  | { ok: false; error: UsernameValidationError };

export const isBlockedUsername = (username: string): boolean => {
  const lower = username.toLowerCase();
  return BLOCKED_SUBSTRINGS.some((s) => lower.includes(s));
};

export const validateUsername = (raw: unknown): UsernameValidation => {
  const normalised = normalizeUsername(raw);
  if (!normalised) {
    return { ok: false, error: 'invalid_format' };
  }
  if (isBlockedUsername(normalised)) {
    return { ok: false, error: 'blocked' };
  }
  return { ok: true, normalised };
};
