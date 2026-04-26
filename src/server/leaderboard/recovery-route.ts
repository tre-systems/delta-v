import { isValidPlayerKey } from '../../shared/player';
import type { Env } from '../env';
import { jsonError } from '../json-errors';
import {
  revokePlayerRecovery,
  selectPlayerRecoveryByHash,
  upsertPlayerRecovery,
} from './player-recovery-store';
import { selectPlayerByKey } from './player-store';
import {
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-code';

interface IssueBody {
  playerKey?: unknown;
}

interface RestoreBody {
  recoveryCode?: unknown;
}

const readJson = async <T>(request: Request): Promise<T | null> => {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
};

const methodNotAllowed = (): Response =>
  jsonError(405, 'method_not_allowed', 'Use POST on this endpoint.', {
    headers: { Allow: 'POST' },
  });

const validateHumanPlayerKey = (
  playerKey: unknown,
): { ok: true; playerKey: string } | { ok: false; response: Response } => {
  if (!isValidPlayerKey(playerKey)) {
    return {
      ok: false,
      response: jsonError(
        400,
        'invalid_player_key',
        'playerKey must be 8-64 chars, alphanumeric plus _ or -.',
      ),
    };
  }

  if (playerKey.startsWith('agent_')) {
    return {
      ok: false,
      response: jsonError(
        400,
        'agent_recovery_not_supported',
        'Agent callsigns do not support recovery codes.',
      ),
    };
  }

  return { ok: true, playerKey };
};

export const handlePlayerRecoveryIssue = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const body = await readJson<IssueBody>(request);
  if (!body) {
    return jsonError(400, 'invalid_json', 'Invalid JSON body.');
  }

  const validated = validateHumanPlayerKey(body.playerKey);
  if (!validated.ok) {
    return validated.response;
  }

  if (!env.DB) {
    return jsonError(
      503,
      'leaderboard_unavailable',
      'Leaderboard unavailable.',
    );
  }

  const player = await selectPlayerByKey(env.DB, validated.playerKey);
  if (!player) {
    return jsonError(404, 'player_not_claimed', 'Callsign is not claimed.');
  }
  if (player.isAgent) {
    return jsonError(
      400,
      'agent_recovery_not_supported',
      'Agent callsigns do not support recovery codes.',
    );
  }

  const recoveryCode = generateRecoveryCode();
  await upsertPlayerRecovery({
    db: env.DB,
    playerKey: player.playerKey,
    recoveryHash: await hashRecoveryCode(recoveryCode),
    issuedAt: Date.now(),
  });

  return Response.json({ ok: true, recoveryCode }, { status: 200 });
};

export const handlePlayerRecoveryRestore = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const body = await readJson<RestoreBody>(request);
  if (!body) {
    return jsonError(400, 'invalid_json', 'Invalid JSON body.');
  }

  const recoveryCode = normalizeRecoveryCode(body.recoveryCode);
  if (!recoveryCode) {
    return jsonError(400, 'invalid_recovery_code', 'Invalid recovery code.');
  }

  if (!env.DB) {
    return jsonError(
      503,
      'leaderboard_unavailable',
      'Leaderboard unavailable.',
    );
  }

  const recovery = await selectPlayerRecoveryByHash(
    env.DB,
    await hashRecoveryCode(recoveryCode),
  );
  if (!recovery) {
    return jsonError(404, 'recovery_not_found', 'Recovery code not found.');
  }

  const player = await selectPlayerByKey(env.DB, recovery.playerKey);
  if (!player || player.isAgent) {
    return jsonError(404, 'recovery_not_found', 'Recovery code not found.');
  }

  return Response.json(
    {
      ok: true,
      profile: {
        playerKey: player.playerKey,
        username: player.username,
      },
    },
    { status: 200 },
  );
};

export const handlePlayerRecoveryRevoke = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const body = await readJson<IssueBody>(request);
  if (!body) {
    return jsonError(400, 'invalid_json', 'Invalid JSON body.');
  }

  const validated = validateHumanPlayerKey(body.playerKey);
  if (!validated.ok) {
    return validated.response;
  }

  if (!env.DB) {
    return jsonError(
      503,
      'leaderboard_unavailable',
      'Leaderboard unavailable.',
    );
  }

  await revokePlayerRecovery(env.DB, validated.playerKey);
  return Response.json({ ok: true }, { status: 200 });
};
