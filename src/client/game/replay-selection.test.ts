import { describe, expect, it } from 'vitest';

import {
  deriveReplaySelection,
  shiftReplaySelection,
} from './replay-selection';

describe('replay-selection', () => {
  it('derives the latest match selection from the current game id', () => {
    expect(deriveReplaySelection('ABCDE-m3', 'ABCDE', null)).toEqual({
      roomCode: 'ABCDE',
      selectedGameId: 'ABCDE-m3',
      latestMatchNumber: 3,
      selectedMatchNumber: 3,
    });
  });

  it('keeps explicit older match selections within room bounds', () => {
    expect(deriveReplaySelection('ABCDE-m3', 'ABCDE', 'ABCDE-m1')).toEqual({
      roomCode: 'ABCDE',
      selectedGameId: 'ABCDE-m1',
      latestMatchNumber: 3,
      selectedMatchNumber: 1,
    });
    expect(deriveReplaySelection('ABCDE-m3', 'ABCDE', 'ABCDE-m9')).toEqual({
      roomCode: 'ABCDE',
      selectedGameId: 'ABCDE-m3',
      latestMatchNumber: 3,
      selectedMatchNumber: 3,
    });
  });

  it('shifts replay selection one match at a time', () => {
    const initial = deriveReplaySelection('ABCDE-m3', 'ABCDE', 'ABCDE-m2');

    if (!initial) {
      throw new Error('expected replay selection');
    }

    expect(shiftReplaySelection(initial, 'prev').selectedGameId).toBe(
      'ABCDE-m1',
    );
    expect(shiftReplaySelection(initial, 'next').selectedGameId).toBe(
      'ABCDE-m3',
    );
  });
});
