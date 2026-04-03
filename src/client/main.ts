import { createGameClient, type GameClient } from './game/client-kernel';
import { setupServiceWorkerReload } from './game/client-runtime';
import { installGlobalErrorHandlers } from './telemetry';
import { installViewportSizing } from './viewport';

export type { GameClient };

// --- Bootstrap ---
installGlobalErrorHandlers();
installViewportSizing();
setupServiceWorkerReload();

const game = createGameClient();
(window as Window & { game?: GameClient }).game = game;
