// Lightweight client telemetry and error reporting.
//
// Both track() and reportError() fire-and-forget POST
// to server endpoints. No PII is collected. Payloads are
// structured JSON logged via console.* on the server,
// captured automatically by Cloudflare Workers Logs.

const post = (path: string, body: Record<string, unknown>): void => {
  try {
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let telemetry break the app
  }
};

// --- Telemetry ---

export const track = (event: string, props?: Record<string, unknown>): void => {
  post('/telemetry', {
    event,
    ...props,
    ts: Date.now(),
  });
};

// --- Error reporting ---

export const reportError = (
  error: string,
  context?: Record<string, unknown>,
): void => {
  post('/error', {
    error,
    ...context,
    ts: Date.now(),
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
