import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  applyResponseHeaders,
  buildContentSecurityPolicy,
} from './response-headers';

const STATIC_HEADERS_PATH = resolve(process.cwd(), 'static/_headers');

const parseStaticHeaderBlock = (): Map<string, string> => {
  const text = readFileSync(STATIC_HEADERS_PATH, 'utf8');
  const lines = text.split(/\r?\n/);
  const headers = new Map<string, string>();
  let inWildcardBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    if (!inWildcardBlock) {
      if (trimmed === '/*') {
        inWildcardBlock = true;
      }
      continue;
    }

    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    headers.set(key, value);
  }

  return headers;
};

describe('static asset security headers', () => {
  it('keep the Cloudflare Assets _headers file aligned with worker security headers', () => {
    const request = new Request('https://delta-v.tre.systems/');
    const response = applyResponseHeaders(request, new Response('ok'));
    const staticHeaders = parseStaticHeaderBlock();

    expect(staticHeaders.get('X-Frame-Options')).toBe(
      response.headers.get('X-Frame-Options'),
    );
    expect(staticHeaders.get('X-Content-Type-Options')).toBe(
      response.headers.get('X-Content-Type-Options'),
    );
    expect(staticHeaders.get('Strict-Transport-Security')).toBe(
      response.headers.get('Strict-Transport-Security'),
    );
    expect(staticHeaders.get('Referrer-Policy')).toBe(
      response.headers.get('Referrer-Policy'),
    );
    expect(staticHeaders.get('Permissions-Policy')).toBe(
      response.headers.get('Permissions-Policy'),
    );
    expect(staticHeaders.get('Content-Security-Policy')).toBe(
      buildContentSecurityPolicy(request),
    );
  });
});
