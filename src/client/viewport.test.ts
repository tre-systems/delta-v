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

  it('expands to the physical screen height in standalone mode', () => {
    expect(
      measureViewportSize({
        innerWidth: 390,
        innerHeight: 810,
        clientWidth: 390,
        clientHeight: 810,
        isStandalone: true,
        screenWidth: 390,
        screenHeight: 844,
        availScreenWidth: 390,
        availScreenHeight: 844,
        visualViewport: { width: 390, height: 810 },
      }),
    ).toEqual({
      width: 390,
      height: 844,
    });
  });

  it('does not treat keyboard-sized reductions as a safe-area gap', () => {
    expect(
      measureViewportSize({
        innerWidth: 390,
        innerHeight: 520,
        clientWidth: 390,
        clientHeight: 520,
        isStandalone: true,
        screenWidth: 390,
        screenHeight: 844,
        availScreenWidth: 390,
        availScreenHeight: 844,
        visualViewport: { width: 390, height: 520 },
      }),
    ).toEqual({
      width: 390,
      height: 520,
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
