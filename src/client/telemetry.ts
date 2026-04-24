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
  removeItem?(key: string): void;
}

type TelemetryEventType = 'error' | 'unhandledrejection';

interface TelemetryRuntime {
  fetchImpl: typeof fetch;
  getStorage: () => StorageLike | null;
  getLocationHref: () => string;
  getUserAgent: () => string;
  addGlobalListener: (
    type: TelemetryEventType,
    listener: (event: Event) => void,
  ) => void;
  createUuid: () => string;
}

const ANON_ID_KEY = 'deltav_anon_id';

const createDefaultRuntime = (): TelemetryRuntime => ({
  fetchImpl: globalThis.fetch.bind(globalThis),
  getStorage: () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
    } catch {
      /* private mode / unsupported storage */
    }

    return null;
  },
  getLocationHref: () => window.location.href,
  getUserAgent: () => navigator.userAgent,
  addGlobalListener: (type, listener) => {
    window.addEventListener(type, listener);
  },
  createUuid: () => crypto.randomUUID(),
});

let telemetryRuntime = createDefaultRuntime();

export const configureTelemetryRuntime = (
  overrides: Partial<TelemetryRuntime>,
): void => {
  telemetryRuntime = {
    ...telemetryRuntime,
    ...overrides,
  };
};

export const resetTelemetryRuntimeForTests = (): void => {
  telemetryRuntime = createDefaultRuntime();
  cachedAnonId = null;
};

export const getOrCreateAnonId = (storage: StorageLike): string => {
  try {
    const existing = storage.getItem(ANON_ID_KEY);

    if (existing) return existing;

    const id = telemetryRuntime.createUuid();
    storage.setItem(ANON_ID_KEY, id);
    return id;
  } catch {
    // Fallback for incognito / storage disabled
    return telemetryRuntime.createUuid();
  }
};

let cachedAnonId: string | null = null;

export const rotateAnonId = (): void => {
  cachedAnonId = null;

  const storage = telemetryRuntime.getStorage();
  if (!storage?.removeItem) return;

  try {
    storage.removeItem(ANON_ID_KEY);
  } catch {
    /* storage unavailable; next telemetry event will use a fresh in-memory ID */
  }
};

const resolveAnonId = (): string => {
  if (cachedAnonId) {
    return cachedAnonId;
  }

  const storage = telemetryRuntime.getStorage();
  if (storage) {
    cachedAnonId = getOrCreateAnonId(storage);
    return cachedAnonId;
  }

  cachedAnonId = telemetryRuntime.createUuid();
  return cachedAnonId;
};

const post = (path: string, body: Record<string, unknown>): void => {
  try {
    telemetryRuntime
      .fetchImpl(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          anonId: resolveAnonId(),
          ts: Date.now(),
        }),
        keepalive: true,
      })
      .catch((err) => {
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
    url: telemetryRuntime.getLocationHref(),
    ua: telemetryRuntime.getUserAgent(),
  });
};

export const installGlobalErrorHandlers = (): void => {
  telemetryRuntime.addGlobalListener('error', (e) => {
    const errorEvent = e as ErrorEvent;
    reportError(errorEvent.message, {
      source: errorEvent.filename,
      line: errorEvent.lineno,
      col: errorEvent.colno,
    });
  });

  telemetryRuntime.addGlobalListener('unhandledrejection', (e) => {
    const rejectionEvent = e as PromiseRejectionEvent;
    const msg =
      rejectionEvent.reason instanceof Error
        ? rejectionEvent.reason.message
        : String(rejectionEvent.reason);
    reportError(msg, { type: 'unhandledrejection' });
  });
};
