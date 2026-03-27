import type { GameState, PlayerId } from '../../shared/types/domain';
import { getScenarioBriefingLines } from './helpers';

export interface BriefingLogEntry {
  text: string;
  cssClass: string;
}

const getBriefingCssClass = (line: string): string => {
  if (
    line.startsWith('Objective: Escape') ||
    line.startsWith('Objective: Get') ||
    line.startsWith('Objective: Land')
  ) {
    return 'log-landed';
  }

  if (
    line.startsWith('Objective: Inspect') ||
    line.startsWith('Objective: Destroy')
  ) {
    return 'log-damage';
  }

  return '';
};

export const deriveScenarioBriefingEntries = (
  state: GameState,
  playerId: PlayerId,
): BriefingLogEntry[] => {
  return getScenarioBriefingLines(state, playerId).map((line) => ({
    text: line,
    cssClass: getBriefingCssClass(line),
  }));
};
