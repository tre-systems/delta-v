import type { GameState } from '../../shared/types/domain';
import { type Dispose, effect } from '../reactive';
import type { ClientSession } from './session-model';

/**
 * Subscribes the HUD to the session's reactive state plus planning updates:
 * a single reactive pipeline from `gameState` / `state` / planning revision
 * to `updateHUD`.
 */
export const attachSessionHudEffect = (
  session: Pick<
    ClientSession,
    'gameStateSignal' | 'stateSignal' | 'planningState'
  >,
  hud: { updateHUD: () => void },
): Dispose =>
  effect(() => {
    session.gameStateSignal.value;
    session.stateSignal.value;
    session.planningState.revisionSignal?.value;
    hud.updateHUD();
  });

/** Keeps the canvas renderer aligned with `session.gameState` (including `null` on exit). */
export const attachRendererGameStateEffect = (
  session: Pick<ClientSession, 'gameStateSignal'>,
  renderer: { setGameState: (state: GameState | null) => void },
): Dispose =>
  effect(() => {
    renderer.setGameState(session.gameStateSignal.value);
  });
