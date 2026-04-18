import { showErrorScreen } from './error-screen';
import { createGameClient, type GameClient } from './game/client-kernel';
import { setupServiceWorkerReload } from './game/client-runtime';
import { installGlobalErrorHandlers } from './telemetry';
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
  const hudScale = ls?.getItem('deltav_hud_scale');
  document.documentElement.dataset.hudScale =
    hudScale === 'large' ? 'large' : 'default';

  installGlobalErrorHandlers();
  installViewportSizing();
  setupServiceWorkerReload();
  const game = createGameClient();
  (window as Window & { game?: GameClient }).game = game;
  document.getElementById('jsRequiredMsg')?.remove();
} catch (error) {
  showErrorScreen(error);
}
