import { isValidPlayerKey } from '../../shared/player';
import type { Env } from '../env';
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
  Response.json(
    {
      ok: false,
      error: 'method_not_allowed',
      message: 'Use POST on this endpoint.',
    },
    { status: 405, headers: { Allow: 'POST' } },
  );

const validateHumanPlayerKey = (
  playerKey: unknown,
): { ok: true; playerKey: string } | { ok: false; response: Response } => {
  if (!isValidPlayerKey(playerKey)) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          error: 'playerKey must be 8-64 chars, alphanumeric plus _ or -',
        },
        { status: 400 },
      ),
    };
  }

  if (playerKey.startsWith('agent_')) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: 'agent_recovery_not_supported' },
        { status: 400 },
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
    return Response.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const validated = validateHumanPlayerKey(body.playerKey);
  if (!validated.ok) {
    return validated.response;
  }

  if (!env.DB) {
    return Response.json(
      { ok: false, error: 'leaderboard_unavailable' },
      { status: 503 },
    );
  }

  const player = await selectPlayerByKey(env.DB, validated.playerKey);
  if (!player) {
    return Response.json(
      { ok: false, error: 'player_not_claimed' },
      { status: 404 },
    );
  }
  if (player.isAgent) {
    return Response.json(
      { ok: false, error: 'agent_recovery_not_supported' },
      { status: 400 },
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
    return Response.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const recoveryCode = normalizeRecoveryCode(body.recoveryCode);
  if (!recoveryCode) {
    return Response.json(
      { ok: false, error: 'invalid_recovery_code' },
      { status: 400 },
    );
  }

  if (!env.DB) {
    return Response.json(
      { ok: false, error: 'leaderboard_unavailable' },
      { status: 503 },
    );
  }

  const recovery = await selectPlayerRecoveryByHash(
    env.DB,
    await hashRecoveryCode(recoveryCode),
  );
  if (!recovery) {
    return Response.json(
      { ok: false, error: 'recovery_not_found' },
      { status: 404 },
    );
  }

  const player = await selectPlayerByKey(env.DB, recovery.playerKey);
  if (!player || player.isAgent) {
    return Response.json(
      { ok: false, error: 'recovery_not_found' },
      { status: 404 },
    );
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
    return Response.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const validated = validateHumanPlayerKey(body.playerKey);
  if (!validated.ok) {
    return validated.response;
  }

  if (!env.DB) {
    return Response.json(
      { ok: false, error: 'leaderboard_unavailable' },
      { status: 503 },
    );
  }

  await revokePlayerRecovery(env.DB, validated.playerKey);
  return Response.json({ ok: true }, { status: 200 });
};
