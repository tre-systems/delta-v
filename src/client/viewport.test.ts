import { describe, expect, it } from 'vitest';

import { measureViewportSize } from './viewport';

describe('measureViewportSize', () => {
  it('uses the largest reported viewport dimensions', () => {
    expect(
      measureViewportSize({
        innerWidth: 390,
        innerHeight: 740,
        clientWidth: 393,
        clientHeight: 744,
        visualViewport: { width: 402.4, height: 756.8 },
      }),
    ).toEqual({
      width: 402,
      height: 757,
    });
  });

  it('falls back cleanly when visualViewport is unavailable', () => {
    expect(
      measureViewportSize({
        innerWidth: 390,
        innerHeight: 844,
        clientWidth: 0,
        clientHeight: 0,
        visualViewport: null,
      }),
    ).toEqual({
      width: 390,
      height: 844,
    });
  });

  it('never returns negative sizes', () => {
    expect(
      measureViewportSize({
        innerWidth: -1,
        innerHeight: -10,
        clientWidth: -5,
        clientHeight: -12,
        visualViewport: { width: -3, height: -7 },
      }),
    ).toEqual({
      width: 0,
      height: 0,
    });
  });
});
