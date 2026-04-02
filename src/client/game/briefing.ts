import type { GameState, PlayerId } from '../../shared/types/domain';
import { getScenarioBriefingLines } from './selection';

export interface BriefingLogEntry {
  text: string;
  cssClass: string;
}

const getBriefingCssClass = (_line: string): string => '';

export const deriveScenarioBriefingEntries = (
  state: GameState,
  playerId: PlayerId,
): BriefingLogEntry[] => {
  return getScenarioBriefingLines(state, playerId).map((line) => ({
    text: line,
    cssClass: getBriefingCssClass(line),
  }));
};
