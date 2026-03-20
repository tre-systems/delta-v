import { describe, expect, it } from 'vitest';

import { deriveHudLayoutOffsets } from './layout';

describe('deriveHudLayoutOffsets', () => {
  it('returns stable fallbacks when HUD bounds are unavailable', () => {
    expect(deriveHudLayoutOffsets(800, null, null)).toEqual({
      hudTopOffsetPx: 72,
      hudBottomOffsetPx: 80,
    });
  });

  it('expands offsets to match measured HUD bounds', () => {
    expect(deriveHudLayoutOffsets(844, { bottom: 118 }, { top: 690 })).toEqual({
      hudTopOffsetPx: 130,
      hudBottomOffsetPx: 166,
    });
  });

  it('uses measured values even when smaller than fallback', () => {
    expect(deriveHudLayoutOffsets(720, { bottom: 44 }, { top: 640 })).toEqual({
      hudTopOffsetPx: 56,
      hudBottomOffsetPx: 92,
    });
  });

  it('never goes below absolute minimum', () => {
    expect(deriveHudLayoutOffsets(500, { bottom: 10 }, { top: 490 })).toEqual({
      hudTopOffsetPx: 32,
      hudBottomOffsetPx: 32,
    });
  });
});
