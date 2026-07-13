import {
  issueOAuthAccessToken,
  OAUTH_ACCESS_TOKEN_TTL_MS,
  resolveAgentTokenSecret,
  signToken,
  verifyToken,
} from '../auth';
import type { Env } from '../env';
import { claimPlayerName } from '../leaderboard/player-store';
import { validateUsername } from '../leaderboard/username';
import { renderOAuthConsentPage, renderOAuthErrorPage } from './consent-page';
import {
  OAUTH_CODE_TTL_MS,
  OAUTH_REFRESH_TTL_MS,
  OAUTH_REQUEST_TTL_MS,
  OAUTH_SCOPE,
  OAUTH_SESSION_TTL_MS,
  type OAuthClientMetadata,
  type OAuthGrant,
  randomOAuthSecret,
  type StoredAuthorizationCode,
  type StoredAuthorizationRequest,
  sha256Base64Url,
  sha256Hex,
} from './model';

const OAUTH_SESSION_KIND = 'delta-v.oauth-session.v1';
const OAUTH_CSRF_COOKIE = 'delta_v_oauth_consent';
const OAUTH_SESSION_COOKIE = 'delta_v_oauth_session';
const MAX_FORM_BYTES = 16 * 1024;

interface OAuthSessionPayload {
  kind: typeof OAUTH_SESSION_KIND;
  iat: number;
  exp: number;
  subject: string;
  playerKey: string;
  username: string;
}

const noStoreHeaders = (contentType?: string): Headers => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  });
  if (contentType) headers.set('Content-Type', contentType);
  return headers;
};

const oauthJson = (body: Record<string, unknown>, status = 200): Response =>
  Response.json(body, {
    status,
    headers: noStoreHeaders('application/json'),
  });

const oauthError = (
  status: number,
  error: string,
  description: string,
): Response => oauthJson({ error, error_description: description }, status);

const consentResponse = (
  html: string,
  requestToken?: string,
  secure = true,
): Response => {
  const headers = noStoreHeaders('text/html; charset=utf-8');
  if (requestToken) {
    headers.append(
      'Set-Cookie',
      secureCookie(
        OAUTH_CSRF_COOKIE,
        requestToken,
        OAUTH_REQUEST_TTL_MS / 1_000,
        '/oauth/authorize',
        secure,
      ),
    );
  }
  return new Response(html, { status: 200, headers });
};

const secureCookie = (
  name: string,
  value: string,
  maxAgeSeconds: number,
  path: string,
  secure = true,
): string =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

const clearCookie = (name: string, path: string, secure = true): string =>
  `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

const readCookies = (request: Request): Map<string, string> => {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0) {
      cookies.set(
        part.slice(0, separator).trim(),
        part.slice(separator + 1).trim(),
      );
    }
  }
  return cookies;
};

const parseForm = async (request: Request): Promise<URLSearchParams | null> => {
  if (
    !(request.headers.get('content-type') ?? '')
      .toLowerCase()
      .startsWith('application/x-www-form-urlencoded')
  ) {
    return null;
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_FORM_BYTES) return null;
  const raw = await request.text();
  return raw.length <= MAX_FORM_BYTES ? new URLSearchParams(raw) : null;
};

const storeFetch = (
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  env.OAUTH.get(env.OAUTH.idFromName('global')).fetch(
    new Request(`https://oauth.internal${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const isSafeRedirectUri = (raw: string): boolean => {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
};

const oauthOrigin = (request: Request): string => new URL(request.url).origin;
const isAllowedConsentOrigin = (request: Request, env: Env): boolean => {
  const origin = request.headers.get('origin');
  if (origin === oauthOrigin(request)) return true;
  if (env.DEV_MODE !== '1' || !origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    );
  } catch {
    return false;
  }
};
export const oauthResource = (request: Request): string =>
  `${oauthOrigin(request)}/mcp`;
export const oauthResourceMetadataUrl = (request: Request): string =>
  `${oauthOrigin(request)}/.well-known/oauth-protected-resource/mcp`;

export const buildOAuthChallenge = (
  request: Request,
  error = 'invalid_token',
  description = 'Authentication is required to play Delta-V',
): string =>
  `Bearer resource_metadata="${oauthResourceMetadataUrl(request)}", scope="${OAUTH_SCOPE}", error="${error}", error_description="${description}"`;

const fetchCimdClient = async (
  request: Request,
  env: Env,
  clientId: string,
): Promise<OAuthClientMetadata | null> => {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  const chatGptClient =
    url.protocol === 'https:' &&
    url.hostname === 'chatgpt.com' &&
    url.pathname.startsWith('/oauth/') &&
    url.pathname.endsWith('/client.json') &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  const localTestClient =
    env.DEV_MODE === '1' &&
    url.origin === oauthOrigin(request) &&
    url.pathname === '/oauth/test-client.json';
  if (!chatGptClient && !localTestClient) return null;
  if (localTestClient) {
    return {
      clientId,
      clientName: 'Delta-V OAuth test client',
      redirectUris: ['https://client.test/callback'],
    };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
  const length = Number(response.headers.get('Content-Length') ?? '0');
  if (!response.ok || length > MAX_FORM_BYTES) return null;
  const raw = await response.text();
  if (raw.length > MAX_FORM_BYTES) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const redirectUris = parsed.redirect_uris;
  if (
    parsed.client_id !== clientId ||
    typeof parsed.client_name !== 'string' ||
    parsed.client_name.length < 1 ||
    parsed.client_name.length > 100 ||
    !Array.isArray(redirectUris) ||
    redirectUris.length < 1 ||
    redirectUris.length > 10 ||
    !redirectUris.every(
      (item) =>
        typeof item === 'string' &&
        item.length <= 2_048 &&
        isSafeRedirectUri(item),
    )
  ) {
    return null;
  }
  return {
    clientId,
    clientName: parsed.client_name,
    redirectUris: redirectUris as string[],
  };
};

const readSession = async (
  request: Request,
  env: Env,
): Promise<OAuthSessionPayload | null> => {
  const raw = readCookies(request).get(OAUTH_SESSION_COOKIE);
  if (!raw) return null;
  const verified = await verifyToken<OAuthSessionPayload>(raw, {
    secret: resolveAgentTokenSecret(env),
    expectedKind: OAUTH_SESSION_KIND,
  });
  if (!verified.ok) return null;
  return verified.payload.playerKey.startsWith('agent_oauth_') &&
    verified.payload.subject
    ? verified.payload
    : null;
};

const redirectOAuth = (
  redirectUri: string,
  params: Record<string, string | null>,
  cookies: string[] = [],
): Response => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  const headers = noStoreHeaders();
  headers.set('Location', url.toString());
  for (const item of cookies) headers.append('Set-Cookie', item);
  return new Response(null, { status: 302, headers });
};

const handleAuthorizeGet = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') ?? '';
  const client = await fetchCimdClient(request, env, clientId);
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const resource = url.searchParams.get('resource') ?? '';
  const scope = url.searchParams.get('scope') ?? '';
  const scopes = scope.split(/\s+/).filter(Boolean);
  const codeChallenge = url.searchParams.get('code_challenge') ?? '';
  if (
    !client ||
    url.searchParams.get('response_type') !== 'code' ||
    !client.redirectUris.includes(redirectUri) ||
    resource !== oauthResource(request) ||
    scopes.length !== 1 ||
    scopes[0] !== OAUTH_SCOPE ||
    url.searchParams.get('code_challenge_method') !== 'S256' ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)
  ) {
    return new Response(
      renderOAuthErrorPage(
        'The client, redirect URL, resource, scope, or PKCE parameters are invalid.',
      ),
      { status: 400, headers: noStoreHeaders('text/html; charset=utf-8') },
    );
  }
  const state = url.searchParams.get('state');
  if ((state?.length ?? 0) > 2_048) {
    return oauthError(400, 'invalid_request', 'state is too long.');
  }
  const rawRequest = randomOAuthSecret();
  const record: StoredAuthorizationRequest = {
    v: 1,
    clientId,
    clientName: client.clientName,
    redirectUri,
    resource,
    scope: OAUTH_SCOPE,
    state,
    codeChallenge,
    expiresAt: Date.now() + OAUTH_REQUEST_TTL_MS,
    expiryKey: '',
  };
  const stored = await storeFetch(env, '/request/create', {
    hash: await sha256Hex(rawRequest),
    record,
  });
  if (!stored.ok) {
    return oauthError(503, 'temporarily_unavailable', 'Try again.');
  }
  const session = await readSession(request, env);
  return consentResponse(
    renderOAuthConsentPage({
      request: record,
      requestToken: rawRequest,
      username: session?.username,
    }),
    rawRequest,
    new URL(request.url).protocol === 'https:',
  );
};

const getStoredRequest = async (
  env: Env,
  requestToken: string,
): Promise<StoredAuthorizationRequest | null> => {
  const response = await storeFetch(env, '/request/get', {
    hash: await sha256Hex(requestToken),
  });
  if (!response.ok) return null;
  return (
    ((await response.json()) as { record?: StoredAuthorizationRequest })
      .record ?? null
  );
};

const handleAuthorizePost = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  if (!isAllowedConsentOrigin(request, env)) {
    return oauthError(403, 'access_denied', 'Invalid consent origin.');
  }
  const form = await parseForm(request);
  const requestToken = form?.get('request') ?? '';
  if (
    !form ||
    !requestToken ||
    readCookies(request).get(OAUTH_CSRF_COOKIE) !== requestToken
  ) {
    return oauthError(403, 'access_denied', 'Invalid or expired consent.');
  }
  const stored = await getStoredRequest(env, requestToken);
  if (!stored) return oauthError(400, 'invalid_request', 'Consent expired.');
  const consume = async (): Promise<boolean> =>
    (
      await storeFetch(env, '/request/consume', {
        hash: await sha256Hex(requestToken),
      })
    ).ok;

  if (form.get('decision') === 'deny') {
    await consume();
    const secure = new URL(request.url).protocol === 'https:';
    return redirectOAuth(
      stored.redirectUri,
      { error: 'access_denied', state: stored.state },
      [clearCookie(OAUTH_CSRF_COOKIE, '/oauth/authorize', secure)],
    );
  }

  const checked = validateUsername(form.get('callsign'));
  if (!checked.ok) {
    return consentResponse(
      renderOAuthConsentPage({
        request: stored,
        requestToken,
        username: form.get('callsign') ?? '',
        error: `Choose a valid callsign (${checked.error}).`,
      }),
    );
  }
  const existing = await readSession(request, env);
  const subject = existing?.subject ?? randomOAuthSecret(18);
  const playerKey =
    existing?.playerKey ?? `agent_oauth_${randomOAuthSecret(12)}`;
  const claimed = await claimPlayerName({
    db: env.DB,
    playerKey,
    username: checked.normalised,
    isAgent: true,
    now: Date.now(),
    identityKind: 'agent',
  });
  if (!claimed.ok) {
    return consentResponse(
      renderOAuthConsentPage({
        request: stored,
        requestToken,
        username: checked.normalised,
        error: 'That callsign is already taken. Choose another.',
      }),
    );
  }
  if (!(await consume())) {
    return oauthError(400, 'invalid_request', 'Consent was already used.');
  }

  const code = randomOAuthSecret();
  const grantId = randomOAuthSecret(18);
  const record: StoredAuthorizationCode = {
    v: 1,
    clientId: stored.clientId,
    redirectUri: stored.redirectUri,
    resource: stored.resource,
    scope: stored.scope,
    codeChallenge: stored.codeChallenge,
    subject,
    playerKey,
    username: checked.normalised,
    grantId,
    expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
    expiryKey: '',
  };
  const codeStored = await storeFetch(env, '/code/create', {
    hash: await sha256Hex(code),
    record,
  });
  if (!codeStored.ok) {
    return oauthError(503, 'temporarily_unavailable', 'Try again.');
  }
  const sessionToken = await signToken({
    secret: resolveAgentTokenSecret(env),
    ttlMs: OAUTH_SESSION_TTL_MS,
    payload: {
      kind: OAUTH_SESSION_KIND,
      subject,
      playerKey,
      username: checked.normalised,
    },
  });
  return redirectOAuth(stored.redirectUri, { code, state: stored.state }, [
    clearCookie(
      OAUTH_CSRF_COOKIE,
      '/oauth/authorize',
      new URL(request.url).protocol === 'https:',
    ),
    secureCookie(
      OAUTH_SESSION_COOKIE,
      sessionToken,
      OAUTH_SESSION_TTL_MS / 1_000,
      '/oauth/authorize',
      new URL(request.url).protocol === 'https:',
    ),
  ]);
};

const issueTokenResponse = async (
  request: Request,
  env: Env,
  grant: OAuthGrant,
  refreshToken: string,
): Promise<Response> => {
  const access = await issueOAuthAccessToken({
    secret: resolveAgentTokenSecret(env),
    issuer: oauthOrigin(request),
    audience: grant.resource,
    scope: grant.scope,
    clientId: grant.clientId,
    grantId: grant.grantId,
    subject: grant.subject,
    playerKey: grant.playerKey,
    username: grant.username,
  });
  return oauthJson({
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1_000),
    refresh_token: refreshToken,
    scope: grant.scope,
  });
};

const handleToken = async (request: Request, env: Env): Promise<Response> => {
  const form = await parseForm(request);
  if (!form) return oauthError(400, 'invalid_request', 'Invalid form body.');
  const clientId = form.get('client_id') ?? '';
  const resource = form.get('resource') ?? '';
  if (!clientId || resource !== oauthResource(request)) {
    return oauthError(
      400,
      'invalid_request',
      'client_id and resource are required.',
    );
  }

  if (form.get('grant_type') === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    if (!code || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !redirectUri) {
      return oauthError(400, 'invalid_grant', 'Invalid authorization code.');
    }
    const response = await storeFetch(env, '/code/redeem', {
      hash: await sha256Hex(code),
      clientId,
      redirectUri,
      resource,
      derivedChallenge: await sha256Base64Url(verifier),
    });
    if (!response.ok) {
      return oauthError(400, 'invalid_grant', 'Invalid authorization code.');
    }
    const record = (
      (await response.json()) as { record: StoredAuthorizationCode }
    ).record;
    const grant: OAuthGrant = {
      clientId: record.clientId,
      resource: record.resource,
      scope: record.scope,
      subject: record.subject,
      playerKey: record.playerKey,
      username: record.username,
      grantId: record.grantId,
    };
    const refreshToken = randomOAuthSecret();
    const refreshStored = await storeFetch(env, '/refresh/create', {
      familyId: grant.grantId,
      refreshHash: await sha256Hex(refreshToken),
      expiresAt: Date.now() + OAUTH_REFRESH_TTL_MS,
      grant,
    });
    if (!refreshStored.ok) {
      return oauthError(503, 'temporarily_unavailable', 'Try again.');
    }
    return issueTokenResponse(request, env, grant, refreshToken);
  }

  if (form.get('grant_type') === 'refresh_token') {
    const refreshToken = form.get('refresh_token') ?? '';
    if (!refreshToken) {
      return oauthError(400, 'invalid_grant', 'Invalid refresh token.');
    }
    const nextRefresh = randomOAuthSecret();
    const response = await storeFetch(env, '/refresh/rotate', {
      oldHash: await sha256Hex(refreshToken),
      newHash: await sha256Hex(nextRefresh),
      clientId,
      resource,
    });
    if (!response.ok) {
      return oauthError(400, 'invalid_grant', 'Invalid refresh token.');
    }
    const grant = ((await response.json()) as { grant: OAuthGrant }).grant;
    return issueTokenResponse(request, env, grant, nextRefresh);
  }

  return oauthError(400, 'unsupported_grant_type', 'Unsupported grant type.');
};

const handleRevoke = async (request: Request, env: Env): Promise<Response> => {
  const token = (await parseForm(request))?.get('token') ?? '';
  if (token) {
    await storeFetch(env, '/refresh/revoke', {
      hash: await sha256Hex(token),
    });
  }
  return new Response(null, { status: 200, headers: noStoreHeaders() });
};

export const handleOAuthRoute = async (
  request: Request,
  env: Env,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const origin = url.origin;
  if (
    request.method === 'GET' &&
    (url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname === '/.well-known/oauth-protected-resource/mcp')
  ) {
    return oauthJson({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [OAUTH_SCOPE],
      resource_name: 'Delta-V',
      resource_documentation: `${origin}/agents`,
    });
  }
  if (
    request.method === 'GET' &&
    url.pathname === '/.well-known/oauth-authorization-server'
  ) {
    return oauthJson({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      response_types_supported: ['code'],
      scopes_supported: [OAUTH_SCOPE],
    });
  }
  if (
    request.method === 'GET' &&
    url.pathname === '/oauth/test-client.json' &&
    env.DEV_MODE === '1'
  ) {
    return oauthJson({
      client_id: `${origin}/oauth/test-client.json`,
      client_name: 'Delta-V OAuth test client',
      redirect_uris: ['https://client.test/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  }
  if (url.pathname === '/oauth/authorize') {
    if (request.method === 'GET') return handleAuthorizeGet(request, env);
    if (request.method === 'POST') return handleAuthorizePost(request, env);
    return oauthError(405, 'invalid_request', 'Use GET or POST.');
  }
  if (url.pathname === '/oauth/token') {
    return request.method === 'POST'
      ? handleToken(request, env)
      : oauthError(405, 'invalid_request', 'Use POST.');
  }
  if (url.pathname === '/oauth/revoke') {
    return request.method === 'POST'
      ? handleRevoke(request, env)
      : oauthError(405, 'invalid_request', 'Use POST.');
  }
  return null;
};
