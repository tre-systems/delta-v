import { hexKey } from '../../shared/hex';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { type Dispose, effect } from '../reactive';
import { getSelectedShip } from './selection';
import type { ClientSession } from './session-model';

/**
 * Reconciles the planning store's selected ship with the derived active
 * selection so HUD updates can stay read-only.
 */
export const attachSessionPlanningSelectionEffect = (
  session: Pick<
    ClientSession,
    'gameStateSignal' | 'stateSignal' | 'planningState' | 'playerId'
  >,
): Dispose =>
  effect(() => {
    session.stateSignal.value;
    const gameState = session.gameStateSignal.value;
    const planning = session.planningState;

    planning.revisionSignal?.value;

    if (!gameState) {
      return;
    }

    const selectedShip = getSelectedShip(
      gameState,
      session.playerId as PlayerId,
      planning.selectedShipId,
    );
    const selectedId = selectedShip?.id ?? null;

    if (selectedId === planning.selectedShipId) {
      return;
    }

    if (!selectedShip) {
      planning.setSelectedShipId(null);
      return;
    }

    planning.selectShip(selectedShip.id, hexKey(selectedShip.position));
  });

/**
 * Keeps the combat attack button aligned with the reactive session state instead
 * of polling from combat action code.
 */
export const attachSessionCombatAttackButtonEffect = (
  session: Pick<ClientSession, 'stateSignal' | 'planningState'>,
  ui: { showAttackButton: (visible: boolean) => void },
): Dispose =>
  effect(() => {
    const isPlayingCombat = session.stateSignal.value === 'playing_combat';
    session.planningState.revisionSignal?.value;
    ui.showAttackButton(
      isPlayingCombat && session.planningState.combatTargetId !== null,
    );
  });

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
