import { describe, expect, it } from 'vitest';

import {
  isProvisional,
  MAX_RD_FOR_RANKED,
  MIN_DISTINCT_OPPONENTS,
  MIN_GAMES_PLAYED,
} from './provisional';

describe('isProvisional', () => {
  const ranked = {
    gamesPlayed: MIN_GAMES_PLAYED,
    distinctOpponents: MIN_DISTINCT_OPPONENTS,
    rd: MAX_RD_FOR_RANKED,
  };

  it('returns false when all thresholds are met exactly', () => {
    expect(isProvisional(ranked)).toBe(false);
  });

  it('returns true when below games-played threshold', () => {
    expect(
      isProvisional({ ...ranked, gamesPlayed: MIN_GAMES_PLAYED - 1 }),
    ).toBe(true);
  });

  it('returns true when below distinct-opponents threshold', () => {
    expect(
      isProvisional({
        ...ranked,
        distinctOpponents: MIN_DISTINCT_OPPONENTS - 1,
      }),
    ).toBe(true);
  });

  it('returns true when RD is above the ranked ceiling', () => {
    expect(isProvisional({ ...ranked, rd: MAX_RD_FOR_RANKED + 0.1 })).toBe(
      true,
    );
  });

  it('returns true for a brand-new player with defaults', () => {
    expect(
      isProvisional({ gamesPlayed: 0, distinctOpponents: 0, rd: 350 }),
    ).toBe(true);
  });
});
