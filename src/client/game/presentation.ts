import { SHIP_STATS } from '../../shared/constants';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { HexCoord } from '../../shared/hex';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  ShipMovement,
} from '../../shared/types/domain';
import {
  playCombat,
  playDefeat,
  playExplosion,
  playThrust,
  playVictory,
} from '../audio';
import { deriveGameOverPlan } from './endgame';
import type { GameOverStats } from './helpers';
import { deriveLandingLogEntries } from './landings';

export interface PresentationDeps {
  applyGameState: (state: GameState) => void;
  setState: (newState: string) => void;
  resetCombatState: () => void;
  getGameState: () => GameState | null;
  getPlayerId: () => number;
  renderer: {
    showMovementEvents: (events: MovementEvent[]) => void;
    animateMovements: (
      movements: ShipMovement[],
      ordnanceMovements: OrdnanceMovement[],
      onComplete: () => void,
    ) => void;
    showCombatResults: (
      results: CombatResult[],
      previousState?: GameState | null,
    ) => void;
    triggerGameOverEffect: (won: boolean) => number;
    showLandingEffect: (hex: HexCoord) => void;
  };
  ui: {
    log: {
      logMovementEvents: (
        events: MovementEvent[],
        ships: GameState['ships'],
      ) => void;
      logCombatResults: (
        results: CombatResult[],
        ships: GameState['ships'],
      ) => void;
      logText: (text: string, cssClass?: string) => void;
      logLanding: (shipName: string, bodyName: string) => void;
    };
    overlay: {
      showToast: (message: string, type: 'error' | 'info' | 'success') => void;
      showGameOver: (
        won: boolean,
        reason: string,
        stats?: GameOverStats,
      ) => void;
      setReplayControls: (view: {
        available: boolean;
        active: boolean;
        loading: boolean;
        statusText: string;
        selectedGameId: string;
        canSelectPrevMatch: boolean;
        canSelectNextMatch: boolean;
        canStart: boolean;
        canPrev: boolean;
        canNext: boolean;
        canEnd: boolean;
      }) => void;
    };
  };
  onGameOverShown?: () => void;
}

const logLandings = (deps: PresentationDeps, movements: ShipMovement[]) => {
  const gameState = deps.getGameState();

  if (!gameState) return;
  for (const entry of deriveLandingLogEntries(gameState, movements)) {
    deps.ui.log.logLanding(entry.shipName, entry.bodyName);
    deps.renderer.showLandingEffect(entry.destination);

    if (entry.resupplyText) {
      deps.ui.log.logText(entry.resupplyText);
    }
  }
};

export const presentMovementResult = (
  deps: PresentationDeps,
  state: GameState,
  movements: MovementResult['movements'],
  ordnanceMovements: MovementResult['ordnanceMovements'],
  events: MovementResult['events'],
  onComplete: () => void,
) => {
  deps.applyGameState(state);
  deps.setState('playing_movementAnim');
  playThrust();

  if (events.length > 0) {
    deps.renderer.showMovementEvents(events);
    deps.ui.log.logMovementEvents(events, state.ships);

    if (
      events.some(
        (event) => event.damageType === 'eliminated' || event.type === 'crash',
      )
    ) {
      setTimeout(() => playExplosion(), 500);
    }
  }

  logLandings(deps, movements);
  deps.renderer.animateMovements(movements, ordnanceMovements, onComplete);
};

export const presentCombatResults = (
  deps: PresentationDeps,
  previousState: GameState,
  state: GameState,
  results: CombatResult[],
  resetCombat = true,
) => {
  deps.applyGameState(state);
  deps.renderer.showCombatResults(results, previousState);
  deps.ui.log.logCombatResults(results, state.ships);
  for (const [i, result] of results.entries()) {
    const target =
      result.targetType === 'ship'
        ? state.ships.find((s) => s.id === result.targetId)
        : null;
    const targetName = target
      ? (SHIP_STATS[target.type]?.name ?? target.type)
      : 'nuke';
    const outcome =
      result.damageType === 'eliminated'
        ? 'DESTROYED'
        : result.damageType === 'disabled'
          ? `Disabled ${result.disabledTurns}T`
          : 'Miss';
    const toastType =
      result.damageType === 'eliminated'
        ? 'error'
        : result.damageType === 'disabled'
          ? 'info'
          : 'info';
    setTimeout(
      () => deps.ui.overlay.showToast(`${targetName}: ${outcome}`, toastType),
      i * 400,
    );
  }

  if (resetCombat) {
    deps.resetCombatState();
  }

  playCombat();

  if (results.some((result) => result.damageType === 'eliminated')) {
    setTimeout(() => playExplosion(), 300);
  }
};

export const showGameOverOutcome = (
  deps: PresentationDeps,
  won: boolean,
  reason: string,
) => {
  deps.setState('gameOver');
  const gameState = deps.getGameState();
  const playerId = deps.getPlayerId();
  const plan = deriveGameOverPlan(gameState, playerId, won, reason);
  deps.ui.log.logText(plan.logText, plan.logClass);

  const effectDuration = deps.renderer.triggerGameOverEffect(won);

  setTimeout(() => {
    deps.ui.overlay.showGameOver(won, reason, plan.stats);
    deps.ui.overlay.setReplayControls({
      available: false,
      active: false,
      loading: false,
      statusText: '',
      selectedGameId: '',
      canSelectPrevMatch: false,
      canSelectNextMatch: false,
      canStart: false,
      canPrev: false,
      canNext: false,
      canEnd: false,
    });
    deps.onGameOverShown?.();

    if (plan.resultSound === 'victory') {
      playVictory();
    } else {
      playDefeat();
    }
  }, effectDuration);
};
