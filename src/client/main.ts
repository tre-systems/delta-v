import { showErrorScreen } from './error-screen';
import { createGameClient, type GameClient } from './game/client-kernel';
import { setupServiceWorkerReload } from './game/client-runtime';
import { installHudScaleShortcuts } from './hud-scale';
import {
  configureTelemetryRuntime,
  installGlobalErrorHandlers,
} from './telemetry';
import { installViewportSizing } from './viewport';
import { getWebLocalStorage } from './web-local-storage';

export type { GameClient };

// --- Bootstrap ---
// Keep `jsRequiredMsg` in the DOM until the client has booted successfully.
// If any step in this block throws (bad bundle, storage disabled, missing
// APIs), the fallback stays visible and `showErrorScreen` renders on top of
// it rather than leaving a blank page.
try {
  const ls = getWebLocalStorage();
  installHudScaleShortcuts();

  configureTelemetryRuntime({
    fetchImpl: globalThis.fetch.bind(globalThis),
    getStorage: () => ls,
    getLocationHref: () => window.location.href,
    getUserAgent: () => navigator.userAgent,
    addGlobalListener: (type, listener) => {
      window.addEventListener(type, listener);
    },
    createUuid: () => crypto.randomUUID(),
  });
  installGlobalErrorHandlers();
  installViewportSizing();
  setupServiceWorkerReload();
  const game = createGameClient();
  (window as Window & { game?: GameClient }).game = game;
  document.getElementById('jsRequiredMsg')?.remove();
} catch (error) {
  showErrorScreen(error);
}
