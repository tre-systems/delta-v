import { SHIP_STATS } from '../../shared/constants';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { HexCoord } from '../../shared/hex';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  Ship,
  ShipMovement,
} from '../../shared/types';
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
    triggerGameOverExplosions: (ships: Ship[]) => number;
    showLandingEffect: (hex: HexCoord) => void;
  };
  ui: {
    logMovementEvents: (events: MovementEvent[], ships: Ship[]) => void;
    logCombatResults: (results: CombatResult[], ships: Ship[]) => void;
    showToast: (message: string, type: 'error' | 'info' | 'success') => void;
    logText: (text: string, cssClass?: string) => void;
    logLanding: (shipName: string, bodyName: string) => void;
    showGameOver: (won: boolean, reason: string, stats?: GameOverStats) => void;
  };
}

const logLandings = (deps: PresentationDeps, movements: ShipMovement[]) => {
  const gameState = deps.getGameState();
  if (!gameState) return;
  for (const entry of deriveLandingLogEntries(gameState, movements)) {
    deps.ui.logLanding(entry.shipName, entry.bodyName);
    deps.renderer.showLandingEffect(entry.destination);
    if (entry.resupplyText) {
      deps.ui.logText(entry.resupplyText);
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
    deps.ui.logMovementEvents(events, state.ships);
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
  deps.ui.logCombatResults(results, state.ships);
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
      () => deps.ui.showToast(`${targetName}: ${outcome}`, toastType),
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
  deps.ui.logText(plan.logText, plan.logClass);
  const loserShips =
    gameState?.ships.filter((ship: Ship) =>
      plan.loserShipIds.includes(ship.id),
    ) ?? [];
  if (loserShips.length === 0) {
    deps.ui.showGameOver(won, reason, plan.stats);
    if (plan.resultSound === 'victory') {
      playVictory();
    } else {
      playDefeat();
    }
    return;
  }
  playExplosion();
  const animDuration = deps.renderer.triggerGameOverExplosions(loserShips);
  setTimeout(() => {
    deps.ui.showGameOver(won, reason, plan.stats);
    if (plan.resultSound === 'victory') {
      playVictory();
    } else {
      playDefeat();
    }
  }, animDuration);
};
