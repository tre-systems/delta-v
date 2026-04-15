import { describe, expect, it } from 'vitest';

import { signToken, verifyToken } from './tokens';

const SECRET = 'test-secret-must-be-at-least-16-chars';

describe('signToken / verifyToken', () => {
  it('round-trips a valid token', async () => {
    const token = await signToken({
      secret: SECRET,
      ttlMs: 60_000,
      payload: { kind: 'test', userId: 42 },
    });
    const result = await verifyToken<{
      kind: 'test';
      userId: number;
      iat: number;
      exp: number;
    }>(token, { secret: SECRET, expectedKind: 'test' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.userId).toBe(42);
      expect(result.payload.kind).toBe('test');
      expect(result.payload.exp).toBeGreaterThan(result.payload.iat);
    }
  });

  it('rejects malformed tokens', async () => {
    const result = await verifyToken('not-a-token', {
      secret: SECRET,
      expectedKind: 'test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await signToken({
      secret: SECRET,
      ttlMs: 60_000,
      payload: { kind: 'test' },
    });
    const result = await verifyToken(token, {
      secret: 'a-different-secret-of-equal-len-x',
      expectedKind: 'test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('badSignature');
  });

  it('rejects tokens with the wrong discriminator', async () => {
    const token = await signToken({
      secret: SECRET,
      ttlMs: 60_000,
      payload: { kind: 'agent' },
    });
    const result = await verifyToken(token, {
      secret: SECRET,
      expectedKind: 'match',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrongKind');
  });

  it('rejects expired tokens', async () => {
    const token = await signToken({
      secret: SECRET,
      ttlMs: 1_000,
      payload: { kind: 'test' },
      now: 100,
    });
    const result = await verifyToken(token, {
      secret: SECRET,
      expectedKind: 'test',
      now: 10_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('tampered payloads fail signature verification', async () => {
    const token = await signToken({
      secret: SECRET,
      ttlMs: 60_000,
      payload: { kind: 'test', role: 'guest' },
    });
    // Replace the payload segment with a different base64 blob that
    // happens to encode "role:admin". Signature is over the original
    // payload bytes — the swap should not validate.
    const sig = token.split('.')[1];
    const tamperedPayload = btoa(
      JSON.stringify({ kind: 'test', role: 'admin', iat: 1, exp: 9e15 }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const result = await verifyToken(`${tamperedPayload}.${sig}`, {
      secret: SECRET,
      expectedKind: 'test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('badSignature');
  });
});
