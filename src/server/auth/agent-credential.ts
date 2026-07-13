const AGENT_SECRET_PREFIX = 'dv-agent-';
const AGENT_SECRET_BYTES = 32;

interface AgentCredentialRow {
  credential_hash: string;
  legacy_locked: number;
}

export type AgentCredentialAuthorization =
  | {
      ok: true;
      created: boolean;
      agentSecret?: string;
    }
  | {
      ok: false;
      reason: 'credential_required' | 'legacy_upgrade_required';
    };

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const generateAgentSecret = (): string => {
  const bytes = new Uint8Array(AGENT_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return `${AGENT_SECRET_PREFIX}${toBase64Url(bytes)}`;
};

export const isValidAgentSecret = (value: unknown): value is string =>
  typeof value === 'string' &&
  new RegExp(`^${AGENT_SECRET_PREFIX}[A-Za-z0-9_-]{43}$`).test(value);

export const hashAgentSecret = async (secret: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const selectCredential = (
  db: D1Database,
  playerKey: string,
): Promise<AgentCredentialRow | null> =>
  db
    .prepare(
      'SELECT credential_hash, legacy_locked FROM agent_credential ' +
        'WHERE player_key = ? LIMIT 1',
    )
    .bind(playerKey)
    .first<AgentCredentialRow>();

const rotateCredential = async (
  db: D1Database,
  playerKey: string,
  now: number,
): Promise<string> => {
  const agentSecret = generateAgentSecret();
  await db
    .prepare(
      'UPDATE agent_credential SET credential_hash = ?, rotated_at = ?, ' +
        'legacy_locked = 0 WHERE player_key = ?',
    )
    .bind(await hashAgentSecret(agentSecret), now, playerKey)
    .run();
  return agentSecret;
};

export const authorizeAgentCredential = async (opts: {
  db: D1Database;
  playerKey: string;
  presentedSecret: unknown;
  validBearer: boolean;
  now?: number;
}): Promise<AgentCredentialAuthorization> => {
  const now = opts.now ?? Date.now();
  const existing = await selectCredential(opts.db, opts.playerKey);

  if (!existing) {
    const agentSecret = generateAgentSecret();
    const result = await opts.db
      .prepare(
        'INSERT INTO agent_credential ' +
          '(player_key, credential_hash, created_at, legacy_locked) ' +
          'VALUES (?, ?, ?, 0) ON CONFLICT(player_key) DO NOTHING',
      )
      .bind(opts.playerKey, await hashAgentSecret(agentSecret), now)
      .run();
    if ((result.meta?.changes ?? 0) === 1) {
      return { ok: true, created: true, agentSecret };
    }
    // A concurrent first registration won. Never hand its identity to this
    // request; the caller must prove possession on a subsequent attempt.
    return { ok: false, reason: 'credential_required' };
  }

  if (existing.legacy_locked === 1) {
    if (!opts.validBearer) {
      return { ok: false, reason: 'legacy_upgrade_required' };
    }
    return {
      ok: true,
      created: false,
      agentSecret: await rotateCredential(opts.db, opts.playerKey, now),
    };
  }

  if (opts.validBearer) return { ok: true, created: false };
  if (!isValidAgentSecret(opts.presentedSecret)) {
    return { ok: false, reason: 'credential_required' };
  }

  const matching = await opts.db
    .prepare(
      'SELECT credential_hash, legacy_locked FROM agent_credential ' +
        'WHERE player_key = ? AND credential_hash = ? ' +
        'AND legacy_locked = 0 LIMIT 1',
    )
    .bind(opts.playerKey, await hashAgentSecret(opts.presentedSecret))
    .first<AgentCredentialRow>();
  return matching
    ? { ok: true, created: false }
    : { ok: false, reason: 'credential_required' };
};

export const deleteAgentCredential = async (
  db: D1Database,
  playerKey: string,
): Promise<void> => {
  await db
    .prepare('DELETE FROM agent_credential WHERE player_key = ?')
    .bind(playerKey)
    .run();
};
