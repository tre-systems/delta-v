import type { GameState } from '../../shared/types/domain';
import { type Dispose, effect, type Signal, signal } from '../reactive';
import type { ClientState } from './phase';

/** Mirrors `ClientSession.gameState` and `.state` for reactive subscribers (kept in sync with `ctx`). */
export type SessionReactiveMirror = {
  gameState: Signal<GameState | null>;
  clientState: Signal<ClientState>;
};

export const createSessionReactiveMirror = (initial: {
  gameState: GameState | null;
  state: ClientState;
}): SessionReactiveMirror => ({
  gameState: signal(initial.gameState),
  clientState: signal(initial.state),
});

/** Runs `hud.updateHUD` whenever mirrored game or client phase state changes. Planning-only updates still use explicit `updateHUD()` calls. */
export const attachSessionMirrorHudEffect = (
  mirror: SessionReactiveMirror,
  hud: { updateHUD: () => void },
): Dispose =>
  effect(() => {
    mirror.gameState.value;
    mirror.clientState.value;
    hud.updateHUD();
  });
