import { SHIP_STATS } from '../../shared/constants';
import type { MovementResult } from '../../shared/engine/game-engine';
import type { HexCoord } from '../../shared/hex';
import type {
  CombatResult,
  GameState,
  MovementEvent,
  OrdnanceMovement,
  PlayerId,
  ShipMovement,
  SolarSystemMap,
} from '../../shared/types/domain';
import {
  playCombat,
  playDefeat,
  playExplosion,
  playThrust,
  playVictory,
} from '../audio';
import { deriveLandingLogEntries } from './landings';
import type { ClientState } from './phase';
import { getGameOverStats } from './selection';
import type { GameOverStats } from './types';

export interface PresentationDeps {
  applyGameState: (state: GameState) => void;
  setState: (newState: ClientState) => void;
  resetCombatState: () => void;
  getGameState: () => GameState | null;
  getPlayerId: () => PlayerId;
  getMap: () => SolarSystemMap | null;
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
    };
  };
  onGameOverShown?: () => void;
}

const logLandings = (deps: PresentationDeps, movements: ShipMovement[]) => {
  const gameState = deps.getGameState();

  if (!gameState) return;
  const entries = deriveLandingLogEntries(gameState, movements, deps.getMap());
  for (const entry of entries) {
    deps.ui.log.logLanding(entry.shipName, entry.bodyName);
    deps.renderer.showLandingEffect(entry.destination);
    deps.ui.log.logText(entry.reasonText, entry.reasonClass);
  }
};

// Surface the silent "queued a burn while disabled" case as an explicit
// log line so the tester does not wonder why the ship drifted instead of
// firing. The engine already nulls burn + overload at resolution time;
// this helper only *reports* that suppression.
const logDisabledBurnCancellations = (
  deps: PresentationDeps,
  state: GameState,
  movements: ShipMovement[],
) => {
  for (const movement of movements) {
    if (!movement.burnCancelledByDisable) continue;
    const ship = state.ships.find((s) => s.id === movement.shipId);
    if (!ship) continue;
    const name = SHIP_STATS[ship.type]?.name ?? ship.type;
    const remaining = ship.damage.disabledTurns;
    const suffix =
      remaining > 0
        ? ` (${remaining} turn${remaining === 1 ? '' : 's'} remaining)`
        : '';
    deps.ui.log.logText(
      `  ${name} disabled — burn cancelled${suffix}`,
      'log-damage',
    );
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

  logDisabledBurnCancellations(deps, state, movements);
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
  ratingDelta?: number,
) => {
  deps.setState('gameOver');
  const gameState = deps.getGameState();
  const playerId = deps.getPlayerId();
  const isSpectator = playerId < 0;
  const baseStats = gameState
    ? getGameOverStats(gameState, isSpectator ? -1 : (playerId as PlayerId))
    : undefined;
  const stats =
    baseStats && ratingDelta !== undefined && !isSpectator
      ? { ...baseStats, ratingDelta }
      : baseStats;
  const logText = isSpectator
    ? `GAME OVER: ${reason}`
    : `${won ? 'VICTORY' : 'DEFEAT'}: ${reason}`;
  const logClass: 'log-landed' | 'log-eliminated' =
    isSpectator || won ? 'log-landed' : 'log-eliminated';
  deps.ui.log.logText(logText, logClass);

  const effectDuration = deps.renderer.triggerGameOverEffect(won);

  setTimeout(() => {
    deps.ui.overlay.showGameOver(won, reason, stats);
    deps.onGameOverShown?.();

    if (!isSpectator && won) {
      playVictory();
    } else {
      playDefeat();
    }
  }, effectDuration);
};
