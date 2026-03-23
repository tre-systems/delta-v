import { describe, expect, it } from 'vitest';

import {
  ACTION_BUTTON_BINDINGS,
  ACTION_BUTTON_IDS,
  STATIC_BUTTON_BINDINGS,
} from './button-bindings';

describe('ui-button-bindings', () => {
  it('keeps action button ids aligned with the action bindings', () => {
    expect(ACTION_BUTTON_IDS).toEqual(
      ACTION_BUTTON_BINDINGS.map(({ id }) => id),
    );
  });

  it('includes replay, rematch, and exit in the static button binding set', () => {
    expect(STATIC_BUTTON_BINDINGS.slice(-9)).toEqual([
      { id: 'rematchBtn', event: { type: 'rematch' } },
      { id: 'replayMatchPrevBtn', event: { type: 'replayMatchPrev' } },
      { id: 'replayMatchNextBtn', event: { type: 'replayMatchNext' } },
      { id: 'replayToggleBtn', event: { type: 'toggleReplay' } },
      { id: 'replayStartBtn', event: { type: 'replayStart' } },
      { id: 'replayPrevBtn', event: { type: 'replayPrev' } },
      { id: 'replayNextBtn', event: { type: 'replayNext' } },
      { id: 'replayEndBtn', event: { type: 'replayEnd' } },
      { id: 'exitBtn', event: { type: 'exit' } },
    ]);
  });

  it('does not duplicate bound button ids', () => {
    const ids = STATIC_BUTTON_BINDINGS.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
