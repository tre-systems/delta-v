import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import {
  type OAuthGrant,
  oauthExpiryKey,
  type StoredAuthorizationCode,
  type StoredAuthorizationRequest,
  type StoredRefreshFamily,
  type StoredRefreshToken,
} from './model';

type JsonObject = Record<string, unknown>;

const requestKey = (hash: string): string => `request:${hash}`;
const codeKey = (hash: string): string => `code:${hash}`;
const familyKey = (id: string): string => `family:${id}`;
const refreshKey = (hash: string): string => `refresh:${hash}`;

const readJson = async (request: Request): Promise<JsonObject | null> => {
  try {
    return (await request.json()) as JsonObject;
  } catch {
    return null;
  }
};

const jsonError = (status: number, error: string): Response =>
  Response.json({ ok: false, error }, { status });

export class OAuthDO extends DurableObject<Env> {
  private async scheduleExpiry(expiresAt: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || expiresAt < current) {
      await this.ctx.storage.setAlarm(expiresAt);
    }
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const pointers = await this.ctx.storage.list<string>({
      prefix: 'expiry:',
    });
    let next: number | null = null;
    for (const [pointerKey, recordKey] of pointers) {
      const encoded = pointerKey.slice('expiry:'.length).split(':', 1)[0];
      const expiresAt = Number(encoded);
      if (!Number.isFinite(expiresAt)) {
        await this.ctx.storage.delete(pointerKey);
      } else if (expiresAt <= now) {
        await this.ctx.storage.delete([pointerKey, recordKey]);
      } else if (next === null || expiresAt < next) {
        next = expiresAt;
      }
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await readJson(request) : null;
    if (request.method === 'POST' && body === null) {
      return jsonError(400, 'invalid_json');
    }

    if (url.pathname === '/request/create' && body) {
      const hash = body.hash;
      const record = body.record as StoredAuthorizationRequest | undefined;
      if (typeof hash !== 'string' || !record) {
        return jsonError(400, 'invalid_request');
      }
      const key = requestKey(hash);
      const expiryKey = oauthExpiryKey(record.expiresAt, key);
      record.expiryKey = expiryKey;
      await this.ctx.storage.put({ [key]: record, [expiryKey]: key });
      await this.scheduleExpiry(record.expiresAt);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/request/consume' && body) {
      const hash = body.hash;
      if (typeof hash !== 'string') return jsonError(400, 'invalid_request');
      const key = requestKey(hash);
      const record = await this.ctx.storage.transaction(async (tx) => {
        const stored = await tx.get<StoredAuthorizationRequest>(key);
        if (!stored || stored.expiresAt <= Date.now()) return null;
        await tx.delete([key, stored.expiryKey]);
        return stored;
      });
      return record
        ? Response.json({ ok: true, record })
        : jsonError(400, 'invalid_request');
    }

    if (url.pathname === '/request/get' && body) {
      const hash = body.hash;
      if (typeof hash !== 'string') return jsonError(400, 'invalid_request');
      const record = await this.ctx.storage.get<StoredAuthorizationRequest>(
        requestKey(hash),
      );
      return record && record.expiresAt > Date.now()
        ? Response.json({ ok: true, record })
        : jsonError(400, 'invalid_request');
    }

    if (url.pathname === '/code/create' && body) {
      const hash = body.hash;
      const record = body.record as StoredAuthorizationCode | undefined;
      if (typeof hash !== 'string' || !record) {
        return jsonError(400, 'invalid_grant');
      }
      const key = codeKey(hash);
      const expiryKey = oauthExpiryKey(record.expiresAt, key);
      record.expiryKey = expiryKey;
      await this.ctx.storage.put({ [key]: record, [expiryKey]: key });
      await this.scheduleExpiry(record.expiresAt);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/code/redeem' && body) {
      const { hash, clientId, redirectUri, resource, derivedChallenge } = body;
      if (
        typeof hash !== 'string' ||
        typeof clientId !== 'string' ||
        typeof redirectUri !== 'string' ||
        typeof resource !== 'string' ||
        typeof derivedChallenge !== 'string'
      ) {
        return jsonError(400, 'invalid_grant');
      }
      const key = codeKey(hash);
      const record = await this.ctx.storage.transaction(async (tx) => {
        const stored = await tx.get<StoredAuthorizationCode>(key);
        if (
          !stored ||
          stored.expiresAt <= Date.now() ||
          stored.clientId !== clientId ||
          stored.redirectUri !== redirectUri ||
          stored.resource !== resource ||
          stored.codeChallenge !== derivedChallenge
        ) {
          return null;
        }
        await tx.delete([key, stored.expiryKey]);
        return stored;
      });
      return record
        ? Response.json({ ok: true, record })
        : jsonError(400, 'invalid_grant');
    }

    if (url.pathname === '/refresh/create' && body) {
      const { familyId, refreshHash, expiresAt } = body;
      const grant = body.grant as OAuthGrant | undefined;
      if (
        typeof familyId !== 'string' ||
        typeof refreshHash !== 'string' ||
        typeof expiresAt !== 'number' ||
        !grant
      ) {
        return jsonError(400, 'invalid_grant');
      }
      const tokenKey = refreshKey(refreshHash);
      const expiryKey = oauthExpiryKey(expiresAt, tokenKey);
      const storedFamilyKey = familyKey(familyId);
      const familyExpiryKey = oauthExpiryKey(expiresAt, storedFamilyKey);
      const family: StoredRefreshFamily = {
        v: 1,
        clientId: grant.clientId,
        resource: grant.resource,
        scope: grant.scope,
        subject: grant.subject,
        playerKey: grant.playerKey,
        username: grant.username,
        currentRefreshHash: refreshHash,
        expiresAt,
        revokedAt: null,
      };
      const token: StoredRefreshToken = {
        v: 1,
        familyId,
        generation: 0,
        state: 'active',
        expiresAt,
        usedAt: null,
        expiryKey,
      };
      await this.ctx.storage.put({
        [storedFamilyKey]: family,
        [tokenKey]: token,
        [expiryKey]: tokenKey,
        [familyExpiryKey]: storedFamilyKey,
      });
      await this.scheduleExpiry(expiresAt);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/refresh/rotate' && body) {
      const { oldHash, newHash, clientId, resource } = body;
      if (
        typeof oldHash !== 'string' ||
        typeof newHash !== 'string' ||
        typeof clientId !== 'string' ||
        typeof resource !== 'string'
      ) {
        return jsonError(400, 'invalid_grant');
      }
      const outcome = await this.ctx.storage.transaction(async (tx) => {
        const oldKey = refreshKey(oldHash);
        const old = await tx.get<StoredRefreshToken>(oldKey);
        if (!old) return { status: 'invalid' as const };
        const fKey = familyKey(old.familyId);
        const family = await tx.get<StoredRefreshFamily>(fKey);
        const now = Date.now();
        if (!family || family.expiresAt <= now || family.revokedAt !== null) {
          return { status: 'invalid' as const };
        }
        if (old.state === 'used') {
          await tx.put(fKey, { ...family, revokedAt: now });
          return { status: 'replayed' as const };
        }
        if (
          family.clientId !== clientId ||
          family.resource !== resource ||
          family.currentRefreshHash !== oldHash
        ) {
          return { status: 'invalid' as const };
        }
        const newKey = refreshKey(newHash);
        const newExpiryKey = oauthExpiryKey(family.expiresAt, newKey);
        const next: StoredRefreshToken = {
          v: 1,
          familyId: old.familyId,
          generation: old.generation + 1,
          state: 'active',
          expiresAt: family.expiresAt,
          usedAt: null,
          expiryKey: newExpiryKey,
        };
        await tx.put({
          [oldKey]: { ...old, state: 'used', usedAt: now },
          [newKey]: next,
          [newExpiryKey]: newKey,
          [fKey]: { ...family, currentRefreshHash: newHash },
        });
        return {
          status: 'ok' as const,
          grant: {
            clientId: family.clientId,
            resource: family.resource,
            scope: family.scope,
            subject: family.subject,
            playerKey: family.playerKey,
            username: family.username,
            grantId: old.familyId,
          } satisfies OAuthGrant,
        };
      });
      return outcome.status === 'ok'
        ? Response.json({ ok: true, grant: outcome.grant })
        : jsonError(400, 'invalid_grant');
    }

    if (url.pathname === '/refresh/revoke' && body) {
      const hash = body.hash;
      if (typeof hash !== 'string') return Response.json({ ok: true });
      await this.ctx.storage.transaction(async (tx) => {
        const token = await tx.get<StoredRefreshToken>(refreshKey(hash));
        if (!token) return;
        const key = familyKey(token.familyId);
        const family = await tx.get<StoredRefreshFamily>(key);
        if (family && family.revokedAt === null) {
          await tx.put(key, { ...family, revokedAt: Date.now() });
        }
      });
      return Response.json({ ok: true });
    }

    return new Response('Not Found', { status: 404 });
  }
}
