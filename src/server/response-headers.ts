const buildConnectSrc = (request: Request): string => {
  const url = new URL(request.url);
  return [
    `'self'`,
    `https://${url.host}`,
    `wss://${url.host}`,
    `ws://${url.host}`,
  ].join(' ');
};

export const buildContentSecurityPolicy = (request: Request): string =>
  [
    "default-src 'self'",
    // `'unsafe-inline'` here because matches.html / leaderboard.html /
    // index.html each have one inline <script> for page boot — see
    // static/_headers for the matching rationale. Externalise those
    // scripts to drop the directive.
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src ${buildConnectSrc(request)} https://cloudflareinsights.com`,
    "img-src 'self' data: https://storage.ko-fi.com",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');

const PUBLIC_CORS_PATH_PATTERNS = [
  /^\/\.well-known\/agent\.json$/,
  /^\/api\/leaderboard$/,
  /^\/api\/leaderboard\/me$/,
  /^\/api\/matches$/,
  /^\/health$/,
  /^\/healthz$/,
  /^\/replay\/[A-Z0-9]{5}$/,
  /^\/status$/,
] as const;

export const isPublicCorsRoute = (
  pathname: string,
  method: string,
): boolean => {
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    return false;
  }

  return PUBLIC_CORS_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
};

export const buildPublicCorsHeaders = (): Record<string, string> => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export const buildPublicCorsPreflightResponse = (
  request: Request,
): Response | null => {
  const url = new URL(request.url);
  if (
    request.method !== 'OPTIONS' ||
    !isPublicCorsRoute(url.pathname, 'OPTIONS')
  ) {
    return null;
  }

  return new Response(null, {
    status: 204,
    headers: buildPublicCorsHeaders(),
  });
};

export const applyResponseHeaders = (
  request: Request,
  response: Response,
): Response => {
  if (response.status === 101) {
    return response;
  }

  const url = new URL(request.url);
  const headers = new Headers(response.headers);

  if (!headers.has('Content-Security-Policy')) {
    headers.set('Content-Security-Policy', buildContentSecurityPolicy(request));
  }
  if (!headers.has('Strict-Transport-Security')) {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }
  if (!headers.has('X-Frame-Options')) {
    headers.set('X-Frame-Options', 'DENY');
  }
  if (!headers.has('X-Content-Type-Options')) {
    headers.set('X-Content-Type-Options', 'nosniff');
  }
  if (!headers.has('Referrer-Policy')) {
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  if (!headers.has('Permissions-Policy')) {
    headers.set(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()',
    );
  }

  if (isPublicCorsRoute(url.pathname, request.method)) {
    const publicCorsHeaders = buildPublicCorsHeaders();
    for (const [key, value] of Object.entries(publicCorsHeaders)) {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
