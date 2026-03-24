import type { GameState } from '../../shared/types/domain';
import { type Dispose, effect, type Signal, signal } from '../reactive';
import type { ClientState } from './phase';

/** Mirrors `ClientSession.gameState` and `.state` for reactive subscribers (kept in sync with `ctx`). */
export type SessionReactiveMirror = {
  gameState: Signal<GameState | null>;
  clientState: Signal<ClientState>;
  /** Incremented from `planning-store` via `setPlanningHudBump` so HUD reflects planning without scattered `updateHUD`. */
  planningRevision: Signal<number>;
};

export const createSessionReactiveMirror = (initial: {
  gameState: GameState | null;
  state: ClientState;
}): SessionReactiveMirror => ({
  gameState: signal(initial.gameState),
  clientState: signal(initial.state),
  planningRevision: signal(0),
});

/** Runs `hud.updateHUD` when mirrored game/client state or planning revision changes. */
export const attachSessionMirrorHudEffect = (
  mirror: SessionReactiveMirror,
  hud: { updateHUD: () => void },
): Dispose =>
  effect(() => {
    mirror.gameState.value;
    mirror.clientState.value;
    mirror.planningRevision.value;
    hud.updateHUD();
  });
