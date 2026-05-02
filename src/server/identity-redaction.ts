// Telemetry-side redaction for raw `playerKey` values. Player keys are
// opaque but stable, so writing them to D1 `events.props` lets future
// log dumps re-identify players. The 2026-05-02 audit found
// `rating_applied` rows that included `aKey`, `bKey`, `winnerKey` and
// matchmaker events that included raw `playerKey` strings.
//
// Two redaction shapes are exposed:
//
//   playerKeyRole(key)       — sync. Returns 'human' | 'agent' |
//                              'official_bot'. Cheap to embed in any
//                              telemetry write; loses per-player
//                              correlation but keeps role separation.
//   hashPlayerKey(key, env)  — async. Returns a 16-hex-char salted
//                              digest using the IP_HASH_SALT secret
//                              (or AGENT_TOKEN_SECRET fallback). Use
//                              when the operator query needs "is this
//                              the same player across two events".
//
// Both leave the underlying database row untouched (player.player_key
// stays as the auth identifier) — the redaction targets only the
// `events.props` JSON, which lives 30 days under retention and is
// queried for aggregate debugging.

import { isOfficialQuickMatchBotPlayerKey } from '../shared/player';
import type { Env } from './env';
import { MissingIpHashSaltError } from './reporting';

export type PlayerKeyRole = 'human' | 'agent' | 'official_bot';

export const playerKeyRole = (playerKey: string): PlayerKeyRole => {
  if (isOfficialQuickMatchBotPlayerKey(playerKey)) {
    return 'official_bot';
  }
  if (playerKey.startsWith('agent_')) {
    return 'agent';
  }
  return 'human';
};

const DEV_PLAYER_KEY_HASH_SALT =
  'delta-v-dev-only-player-key-hash-salt-do-not-use-in-production';

const resolvePlayerKeyHashSalt = (
  env: Pick<Env, 'AGENT_TOKEN_SECRET' | 'IP_HASH_SALT' | 'DEV_MODE'>,
): string => {
  if (env.IP_HASH_SALT && env.IP_HASH_SALT.length >= 16) {
    return env.IP_HASH_SALT;
  }
  if (env.AGENT_TOKEN_SECRET && env.AGENT_TOKEN_SECRET.length >= 16) {
    return env.AGENT_TOKEN_SECRET;
  }
  if (env.DEV_MODE === '1') {
    return DEV_PLAYER_KEY_HASH_SALT;
  }
  throw new MissingIpHashSaltError();
};

// Salted, truncated SHA-256 of the playerKey. Mirrors the IP-hash
// primitive in reporting.ts so dev/prod salt policy is shared.
export const hashPlayerKey = async (
  playerKey: string,
  env: Pick<Env, 'AGENT_TOKEN_SECRET' | 'IP_HASH_SALT' | 'DEV_MODE'>,
): Promise<string> => {
  const salt = resolvePlayerKeyHashSalt(env);
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`pk:${salt}:${playerKey}`),
  );
  return [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
