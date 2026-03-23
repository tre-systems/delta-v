import type { GameState } from '../../shared/types/domain';
import { type GameOverStats, getGameOverStats } from './helpers';

export interface GameOverPlan {
  stats: GameOverStats | undefined;
  logText: string;
  logClass: 'log-landed' | 'log-eliminated';
  resultSound: 'victory' | 'defeat';
}

export const deriveGameOverPlan = (
  state: GameState | null,
  playerId: number,
  won: boolean,
  reason: string,
): GameOverPlan => ({
  stats: state ? getGameOverStats(state, playerId) : undefined,
  logText: `${won ? 'VICTORY' : 'DEFEAT'}: ${reason}`,
  logClass: won ? 'log-landed' : 'log-eliminated',
  resultSound: won ? 'victory' : 'defeat',
});
