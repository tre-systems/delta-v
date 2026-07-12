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
  playCapture,
  playCollision,
  playCombat,
  playDamage,
  playDefeat,
  playExplosion,
  playLanding,
  playOrdnanceImpact,
  playThrust,
  playTrajectory,
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
  getClientState: () => ClientState;
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
  entries.forEach((entry, index) => {
    deps.ui.log.logLanding(entry.shipName, entry.bodyName);
    deps.renderer.showLandingEffect(entry.destination);
    deps.ui.log.logText(entry.reasonText, entry.reasonClass);
    setTimeout(
      () => playLanding(entry.reasonClass === 'log-info'),
      index * 180,
    );
  });
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

const flattenCombatResults = (results: CombatResult[]): CombatResult[] => {
  const out: CombatResult[] = [];

  for (const result of results) {
    out.push(result);
    if (result.counterattack) {
      out.push(...flattenCombatResults([result.counterattack]));
    }
  }

  return out;
};

const mostSevereMovementDamage = (
  events: MovementEvent[],
): MovementEvent['damageType'] => {
  if (events.some((event) => event.damageType === 'eliminated')) {
    return 'eliminated';
  }

  if (events.some((event) => event.damageType === 'captured')) {
    return 'captured';
  }

  if (events.some((event) => event.damageType === 'disabled')) {
    return 'disabled';
  }

  return 'none';
};

const isOrdnanceImpactEvent = (
  event: MovementEvent,
): event is MovementEvent & {
  type: 'mineDetonation' | 'torpedoHit' | 'nukeDetonation';
} =>
  event.type === 'nukeDetonation' ||
  event.type === 'torpedoHit' ||
  event.type === 'mineDetonation';

const playMovementEventSounds = (events: MovementEvent[]): void => {
  if (events.length === 0) return;

  const damageType = mostSevereMovementDamage(events);
  const ordnanceImpact = events.find(isOrdnanceImpactEvent);

  if (ordnanceImpact) {
    setTimeout(
      () => playOrdnanceImpact(ordnanceImpact.type, damageType),
      ordnanceImpact.type === 'nukeDetonation' ? 120 : 180,
    );
  } else if (
    events.some(
      (event) =>
        event.type === 'crash' ||
        event.type === 'ramming' ||
        event.type === 'asteroidHit',
    )
  ) {
    setTimeout(() => playCollision(), 160);
  }

  if (events.some((event) => event.type === 'capture')) {
    setTimeout(() => playCapture(), 320);
    return;
  }

  if (damageType === 'disabled' && !ordnanceImpact) {
    setTimeout(() => playDamage('disabled'), 260);
  }

  if (
    damageType === 'eliminated' &&
    ordnanceImpact?.type !== 'nukeDetonation'
  ) {
    setTimeout(() => playExplosion(), 500);
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

  const hasMovement = movements.length > 0 || ordnanceMovements.length > 0;
  const hasPoweredMovement =
    movements.some((movement) => movement.fuelSpent > 0) ||
    ordnanceMovements.length > 0;

  if (hasPoweredMovement) {
    playThrust();
  } else if (hasMovement) {
    playTrajectory();
  }

  if (events.length > 0) {
    deps.renderer.showMovementEvents(events);
    deps.ui.log.logMovementEvents(events, state.ships);
    playMovementEventSounds(events);
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

  const allResults = flattenCombatResults(results);
  playCombat();

  if (allResults.some((result) => result.damageType === 'disabled')) {
    setTimeout(() => playDamage('disabled'), 220);
  }

  if (allResults.some((result) => result.damageType === 'eliminated')) {
    setTimeout(() => playExplosion(), 300);
  }
};

export const showGameOverOutcome = (
  deps: PresentationDeps,
  won: boolean,
  reason: string,
  ratingDelta?: number,
  options: { trainingComplete?: boolean } = {},
) => {
  deps.setState('gameOver');
  const gameState = deps.getGameState();
  const playerId = deps.getPlayerId();
  const isSpectator = playerId < 0;
  const baseStats = gameState
    ? getGameOverStats(gameState, isSpectator ? -1 : (playerId as PlayerId))
    : undefined;
  const statsWithRating =
    baseStats && ratingDelta !== undefined && !isSpectator
      ? { ...baseStats, ratingDelta }
      : baseStats;
  const stats =
    statsWithRating && options.trainingComplete
      ? { ...statsWithRating, trainingComplete: true }
      : statsWithRating;
  const logText = isSpectator
    ? `GAME OVER: ${reason}`
    : `${won ? 'VICTORY' : 'DEFEAT'}: ${reason}`;
  const logClass: 'log-landed' | 'log-eliminated' =
    isSpectator || won ? 'log-landed' : 'log-eliminated';
  deps.ui.log.logText(logText, logClass);

  const effectDuration = deps.renderer.triggerGameOverEffect(won);

  setTimeout(() => {
    // The reveal delay can outlive the session: if the player exited to the
    // menu (or started another game) before it fires, showing the modal now
    // would strand it over a non-game screen with no state change left to
    // hide it.
    if (deps.getClientState() !== 'gameOver') {
      return;
    }
    deps.ui.overlay.showGameOver(won, reason, stats);
    deps.onGameOverShown?.();

    if (!isSpectator && won) {
      playVictory();
    } else {
      playDefeat();
    }
  }, effectDuration);
};
