// Generic HMAC-signed token helpers used by both agent-token (long-lived
// agent identity) and match-token (per-match credential bag).
//
// Format:  <base64url(payload)>.<base64url(signature)>
// Signature is HMAC-SHA-256 over the payload string with the env secret.
// Constant-time compare is built into Web Crypto's verify(), so we use that
// rather than rolling our own.
//
// Why custom rather than JWT? JWT pulls in the `alg` field complexity we
// don't need (alg=none attacks, key-id confusion, etc.). A two-segment
// payload.signature with one fixed algorithm is the smallest correct thing.

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (raw: string): Uint8Array => {
  const padded = raw
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(raw.length / 4) * 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const importKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

export interface SignedTokenPayload {
  // Discriminator so an agent-token can never be mistaken for a match-token
  // (or vice versa) even if both are HMAC-signed by the same secret.
  kind: string;
  // Issued-at and expires-at, both in milliseconds since epoch. Verified
  // automatically.
  iat: number;
  exp: number;
}

export interface SignTokenOptions {
  secret: string;
  ttlMs: number;
  // Caller-supplied payload merged with iat/exp before signing.
  payload: Omit<SignedTokenPayload, 'iat' | 'exp'> & Record<string, unknown>;
  now?: number;
}

export const signToken = async (opts: SignTokenOptions): Promise<string> => {
  const issuedAt = opts.now ?? Date.now();
  const fullPayload = {
    ...opts.payload,
    iat: issuedAt,
    exp: issuedAt + opts.ttlMs,
  } satisfies SignedTokenPayload & Record<string, unknown>;
  const payloadBytes = encoder.encode(JSON.stringify(fullPayload));
  const key = await importKey(opts.secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, payloadBytes),
  );
  return `${toBase64Url(payloadBytes)}.${toBase64Url(sig)}`;
};

export type VerifyResult<T> =
  | { ok: true; payload: T }
  | {
      ok: false;
      reason: 'malformed' | 'badSignature' | 'expired' | 'wrongKind';
    };

export interface VerifyTokenOptions {
  secret: string;
  expectedKind: string;
  now?: number;
}

export const verifyToken = async <T extends SignedTokenPayload>(
  token: string,
  opts: VerifyTokenOptions,
): Promise<VerifyResult<T>> => {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot >= token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const payloadStr = token.slice(0, dot);
  const sigStr = token.slice(dot + 1);

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(payloadStr);
    sigBytes = fromBase64Url(sigStr);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const key = await importKey(opts.secret);
  // Cast to BufferSource — TS infers ArrayBufferLike from Uint8Array but
  // crypto.subtle.verify wants ArrayBuffer; in Workers/V8 the underlying
  // buffer is always ArrayBuffer, never SharedArrayBuffer.
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes as BufferSource,
    payloadBytes as BufferSource,
  );
  if (!valid) return { ok: false, reason: 'badSignature' };

  let parsed: T;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as T;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (parsed.kind !== opts.expectedKind) {
    return { ok: false, reason: 'wrongKind' };
  }

  const now = opts.now ?? Date.now();
  if (typeof parsed.exp !== 'number' || parsed.exp <= now) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload: parsed };
};
