// Lightweight client telemetry and error reporting.
//
// Both track() and reportError() fire-and-forget POST
// to server endpoints. No PII is collected. Payloads are
// structured JSON logged via console.* on the server
// and stored in D1 for querying.

import { warnOnce } from './log-once';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ANON_ID_KEY = 'deltav_anon_id';

export const getOrCreateAnonId = (storage: StorageLike): string => {
  try {
    const existing = storage.getItem(ANON_ID_KEY);

    if (existing) return existing;

    const id = crypto.randomUUID();
    storage.setItem(ANON_ID_KEY, id);
    return id;
  } catch {
    // Fallback for incognito / storage disabled
    return crypto.randomUUID();
  }
};

let cachedAnonId: string | null = null;

const resolveAnonId = (): string => {
  if (cachedAnonId) {
    return cachedAnonId;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      cachedAnonId = getOrCreateAnonId(window.localStorage);
      return cachedAnonId;
    }
  } catch {
    /* private mode / unsupported storage */
  }
  cachedAnonId = crypto.randomUUID();
  return cachedAnonId;
};

const post = (path: string, body: Record<string, unknown>): void => {
  try {
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        anonId: resolveAnonId(),
        ts: Date.now(),
      }),
      keepalive: true,
    }).catch((err) => {
      warnOnce(
        `telemetry.post.${path}`,
        `telemetry delivery failed for ${path} (further failures suppressed)`,
        err,
      );
    });
  } catch (err) {
    // Never let telemetry break the app; surface the first occurrence so
    // developers can diagnose bundle/network issues instead of a silent void.
    warnOnce(
      `telemetry.synchronous.${path}`,
      `telemetry post threw synchronously for ${path}`,
      err,
    );
  }
};

// --- Telemetry ---

export const track = (event: string, props?: Record<string, unknown>): void => {
  post('/telemetry', { event, ...props });
};

// --- Error reporting ---

export const reportError = (
  error: string,
  context?: Record<string, unknown>,
): void => {
  post('/error', {
    error,
    ...context,
    url: window.location.href,
    ua: navigator.userAgent,
  });
};

export const installGlobalErrorHandlers = (): void => {
  window.addEventListener('error', (e) => {
    reportError(e.message, {
      source: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
    reportError(msg, { type: 'unhandledrejection' });
  });
};
