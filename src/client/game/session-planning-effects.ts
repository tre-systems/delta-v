import { hexKey } from '../../shared/hex';
import type { GameState, PlayerId } from '../../shared/types/domain';
import { type Dispose, effect } from '../reactive';
import { deriveHudViewModel } from './hud-view-model';
import { deriveInteractionMode } from './interaction-fsm';
import { getSelectedShip } from './selection';
import type { ClientSession } from './session-model';

export type SessionCombatButtonsUI = {
  showAttackButton: (visible: boolean) => void;
  showFireButton: (visible: boolean, count: number) => void;
};

export type SessionHudConsumer = {
  updateHUD: () => void;
};

export type SessionFleetPanelUI = {
  updateFleetStatus: (status: string, ariaLabel?: string) => void;
  updateShipList: (
    ships: GameState['ships'],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ) => void;
};

/**
 * Reconciles the planning store's selected ship with the derived active
 * selection so HUD updates can stay read-only.
 */
export const attachSessionPlanningSelectionEffect = (
  session: Pick<
    ClientSession,
    'gameStateSignal' | 'stateSignal' | 'planningState' | 'playerIdSignal'
  >,
): Dispose =>
  effect(() => {
    session.stateSignal.value;
    const gameState = session.gameStateSignal.value;
    const playerId = session.playerIdSignal.value;
    const planning = session.planningState;

    planning.revisionSignal?.value;

    if (!gameState) {
      if (planning.selectedShipId !== null) {
        planning.setSelectedShipId(null);
      }
      return;
    }

    const selectedShip = getSelectedShip(
      gameState,
      playerId,
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
 * Keeps combat action buttons aligned with reactive session/planning state
 * instead of imperative updates from combat action code.
 */
export const attachSessionCombatButtonsEffect = (
  session: Pick<ClientSession, 'stateSignal' | 'planningState'>,
  ui: SessionCombatButtonsUI,
): Dispose =>
  effect(() => {
    const isCombatMode =
      deriveInteractionMode(session.stateSignal.value) === 'combat';
    session.planningState.revisionSignal?.value;

    const hasTarget = session.planningState.combatTargetId !== null;
    const hasSelection = session.planningState.selectedShipId !== null;
    const queuedCombat = session.planningState.queuedAttacks.length;
    ui.showAttackButton(isCombatMode && hasTarget);
    ui.showFireButton(
      isCombatMode && (hasTarget || hasSelection),
      queuedCombat,
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
    'gameStateSignal' | 'stateSignal' | 'planningState' | 'playerIdSignal'
  >,
  hud: SessionHudConsumer,
): Dispose =>
  effect(() => {
    session.gameStateSignal.value;
    session.stateSignal.value;
    session.playerIdSignal.value;
    session.planningState.revisionSignal?.value;
    hud.updateHUD();
  });

/** Keeps fleet status and ship list aligned with reactive session/planning state. */
export const attachSessionFleetPanelEffect = (
  session: Pick<
    ClientSession,
    'gameStateSignal' | 'playerIdSignal' | 'planningState'
  >,
  ui: SessionFleetPanelUI,
): Dispose =>
  effect(() => {
    const gameState = session.gameStateSignal.value;
    const playerId = session.playerIdSignal.value;

    session.planningState.revisionSignal?.value;

    if (!gameState) {
      ui.updateFleetStatus('');
      ui.updateShipList([], null, new Map<string, number | null>());
      return;
    }

    const hud = deriveHudViewModel(gameState, playerId, session.planningState);

    ui.updateFleetStatus(hud.fleetStatus, hud.fleetStatusAriaLabel);
    ui.updateShipList(hud.myShips, hud.selectedId, session.planningState.burns);
  });

export type SessionPlanningEffectsUI = SessionCombatButtonsUI &
  SessionFleetPanelUI;

export type SessionPlanningEffectsSession = Pick<
  ClientSession,
  'gameStateSignal' | 'stateSignal' | 'planningState' | 'playerIdSignal'
>;

export type SessionIdentityPlayerId = PlayerId | -1;
