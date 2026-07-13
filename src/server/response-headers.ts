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
    // The three static pages contain small, fixed inline boot scripts. Exact
    // hashes preserve those scripts without granting every injected inline
    // script/event handler permission to execute. Keep in sync with
    // static/_headers and recalculate when one of those blocks changes.
    "script-src 'self' 'sha256-7sYbyU0oFZ+vKvThIJEE2hoVADu43/hbaI51QZmwk9w=' 'sha256-exWhJQ1fybZXsDnEiJEoEzengAWD16d46nJWk6oqAZg=' 'sha256-SFPxWtEMa/gXgiPgsNP9wGSagwHfYNg6IpyRQwTaPjA=' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `connect-src ${buildConnectSrc(request)} https://cloudflareinsights.com`,
    "img-src 'self' data:",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');

const PUBLIC_CORS_PATH_PATTERNS = [
  /^\/\.well-known\/oauth-authorization-server$/,
  /^\/\.well-known\/oauth-protected-resource(?:\/mcp)?$/,
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

const resolveCacheControlOverride = (pathname: string): string | null => {
  if (
    pathname === '/version.json' ||
    pathname === '/health' ||
    pathname === '/healthz' ||
    pathname === '/status'
  ) {
    return 'no-store';
  }

  if (
    pathname === '/' ||
    pathname === '/agents' ||
    pathname === '/agents/' ||
    pathname === '/matches' ||
    pathname === '/matches/' ||
    pathname === '/leaderboard' ||
    pathname === '/leaderboard/'
  ) {
    return 'no-store';
  }

  return null;
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

  const cacheControlOverride = resolveCacheControlOverride(url.pathname);
  if (cacheControlOverride !== null) {
    headers.set('Cache-Control', cacheControlOverride);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
