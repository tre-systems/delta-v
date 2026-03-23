import { buildMatchId, parseMatchId } from '../../shared/replay';

export interface ReplaySelection {
  roomCode: string;
  selectedGameId: string;
  latestMatchNumber: number;
  selectedMatchNumber: number;
}

export const deriveReplaySelection = (
  currentGameId: string,
  roomCode: string | null,
  selectedGameId: string | null,
): ReplaySelection | null => {
  const currentMatch = parseMatchId(currentGameId);
  const resolvedRoomCode = currentMatch?.roomCode ?? roomCode;
  const latestMatchNumber = Math.max(1, currentMatch?.matchNumber ?? 1);

  if (!resolvedRoomCode) {
    return null;
  }

  const parsedSelected = parseMatchId(selectedGameId ?? currentGameId);
  const selectedMatchNumber = Math.min(
    latestMatchNumber,
    Math.max(1, parsedSelected?.matchNumber ?? latestMatchNumber),
  );

  return {
    roomCode: resolvedRoomCode,
    selectedGameId: buildMatchId(resolvedRoomCode, selectedMatchNumber),
    latestMatchNumber,
    selectedMatchNumber,
  };
};

export const shiftReplaySelection = (
  selection: ReplaySelection,
  direction: 'prev' | 'next',
): ReplaySelection => {
  const delta = direction === 'prev' ? -1 : 1;
  const selectedMatchNumber = Math.min(
    selection.latestMatchNumber,
    Math.max(1, selection.selectedMatchNumber + delta),
  );

  return {
    ...selection,
    selectedMatchNumber,
    selectedGameId: buildMatchId(selection.roomCode, selectedMatchNumber),
  };
};
