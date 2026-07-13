export const OAUTH_SCOPE = 'game:play';
export const OAUTH_CODE_TTL_MS = 5 * 60 * 1_000;
export const OAUTH_REQUEST_TTL_MS = 10 * 60 * 1_000;
export const OAUTH_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const OAUTH_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1_000;

export interface OAuthClientMetadata {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export interface StoredAuthorizationRequest {
  v: 1;
  clientId: string;
  clientName: string;
  redirectUri: string;
  resource: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  expiresAt: number;
  expiryKey: string;
}

export interface StoredAuthorizationCode {
  v: 1;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
  subject: string;
  playerKey: string;
  username: string;
  grantId: string;
  expiresAt: number;
  expiryKey: string;
}

export interface StoredRefreshFamily {
  v: 1;
  clientId: string;
  resource: string;
  scope: string;
  subject: string;
  playerKey: string;
  username: string;
  currentRefreshHash: string;
  expiresAt: number;
  revokedAt: number | null;
}

export interface StoredRefreshToken {
  v: 1;
  familyId: string;
  generation: number;
  state: 'active' | 'used';
  expiresAt: number;
  usedAt: number | null;
  expiryKey: string;
}

export interface OAuthGrant {
  clientId: string;
  resource: string;
  scope: string;
  subject: string;
  playerKey: string;
  username: string;
  grantId: string;
}

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const randomOAuthSecret = (bytes = 32): string => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
};

export const sha256Base64Url = async (value: string): Promise<string> =>
  bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  );

export const sha256Hex = async (value: string): Promise<string> =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export const oauthExpiryKey = (expiresAt: number, recordKey: string): string =>
  `expiry:${String(expiresAt).padStart(16, '0')}:${recordKey}`;
