import type { GameState } from '../shared/types';
import { type GameOverStats, getGameOverStats } from './game-client-helpers';

export interface GameOverPlan {
  stats: GameOverStats | undefined;
  logText: string;
  logClass: 'log-landed' | 'log-eliminated';
  loserShipIds: string[];
  resultSound: 'victory' | 'defeat';
}

export const deriveGameOverPlan = (
  state: GameState | null,
  playerId: number,
  won: boolean,
  reason: string,
): GameOverPlan => {
  const loserId = won ? 1 - playerId : playerId;
  const loserShipIds =
    state?.ships.filter((ship) => ship.owner === loserId && !ship.destroyed).map((ship) => ship.id) ?? [];
  return {
    stats: state ? getGameOverStats(state, playerId) : undefined,
    logText: `${won ? 'VICTORY' : 'DEFEAT'}: ${reason}`,
    logClass: won ? 'log-landed' : 'log-eliminated',
    loserShipIds,
    resultSound: won ? 'victory' : 'defeat',
  };
};
