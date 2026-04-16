// Tiny helpers for logging a class of failure at most once per session.
//
// The client wraps many browser-capability calls (localStorage access,
// telemetry POSTs) in bare try/catch to keep the app running in private
// browsing, blocked-storage, or offline modes. Full silence makes those
// failures invisible to developers. These helpers emit a single
// `console.warn` per category so the dev console shows *something* without
// spamming the log on every access.

const warned = new Set<string>();

export const warnOnce = (
  key: string,
  message: string,
  error?: unknown,
): void => {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    if (error !== undefined) {
      console.warn(`[delta-v] ${message}`, error);
    } else {
      console.warn(`[delta-v] ${message}`);
    }
  }
};

// Test-only: reset the warn-once memo so the next warning will fire.
export const resetWarnOnceForTests = (): void => {
  warned.clear();
};
