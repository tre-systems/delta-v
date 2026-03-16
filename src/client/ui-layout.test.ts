import { describe, expect, it } from 'vitest';
import { deriveHudLayoutOffsets } from './ui-layout';

describe('deriveHudLayoutOffsets', () => {
  it('returns stable fallbacks when HUD bounds are unavailable', () => {
    expect(deriveHudLayoutOffsets(800, null, null)).toEqual({
      hudTopOffsetPx: 90,
      hudBottomOffsetPx: 140,
    });
  });

  it('expands offsets to match measured HUD bounds', () => {
    expect(deriveHudLayoutOffsets(844, { bottom: 118 }, { top: 690 })).toEqual({
      hudTopOffsetPx: 130,
      hudBottomOffsetPx: 166,
    });
  });

  it('never shrinks below the desktop-safe fallbacks', () => {
    expect(deriveHudLayoutOffsets(720, { bottom: 44 }, { top: 640 })).toEqual({
      hudTopOffsetPx: 90,
      hudBottomOffsetPx: 140,
    });
  });
});
