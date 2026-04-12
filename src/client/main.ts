import { showErrorScreen } from './error-screen';
import { createGameClient, type GameClient } from './game/client-kernel';
import { setupServiceWorkerReload } from './game/client-runtime';
import { installGlobalErrorHandlers } from './telemetry';
import { installViewportSizing } from './viewport';

export type { GameClient };

// --- Bootstrap ---
document.getElementById('jsRequiredMsg')?.remove();
installGlobalErrorHandlers();
installViewportSizing();
setupServiceWorkerReload();

try {
  const game = createGameClient();
  (window as Window & { game?: GameClient }).game = game;
} catch (error) {
  showErrorScreen(error);
}
