import type { GameState } from '../shared/types';
import { getScenarioBriefingLines } from './game-client-helpers';

export interface BriefingLogEntry {
  text: string;
  cssClass: string;
}

const getBriefingCssClass = (line: string): string => {
  if (line.startsWith('Objective: Escape') || line.startsWith('Objective: Get') || line.startsWith('Objective: Land')) {
    return 'log-landed';
  }
  if (line.startsWith('Objective: Inspect') || line.startsWith('Objective: Destroy')) {
    return 'log-damage';
  }
  return '';
};

export const deriveScenarioBriefingEntries = (state: GameState, playerId: number): BriefingLogEntry[] => {
  return getScenarioBriefingLines(state, playerId).map((line) => ({
    text: line,
    cssClass: getBriefingCssClass(line),
  }));
};
