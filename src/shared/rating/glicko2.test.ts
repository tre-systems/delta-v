import { describe, expect, it } from 'vitest';

import {
  applyInactivity,
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOLATILITY,
  newRating,
  type Rating,
  updateRating,
} from './glicko2';

const fresh = (overrides: Partial<Rating> = {}): Rating => ({
  rating: DEFAULT_RATING,
  rd: DEFAULT_RD,
  volatility: DEFAULT_VOLATILITY,
  ...overrides,
});

describe('newRating', () => {
  it('returns the Glicko-2 defaults', () => {
    expect(newRating()).toEqual({
      rating: DEFAULT_RATING,
      rd: DEFAULT_RD,
      volatility: DEFAULT_VOLATILITY,
    });
  });
});

describe('updateRating', () => {
  it('is deterministic for the same inputs', () => {
    const a = fresh({ rating: 1600, rd: 200 });
    const b = fresh({ rating: 1500, rd: 250 });
    const first = updateRating(a, b, 1);
    const second = updateRating(a, b, 1);
    expect(first).toEqual(second);
  });

  it('awards rating to the winner and removes from the loser', () => {
    const winner = fresh();
    const loser = fresh();
    const { a, b } = updateRating(winner, loser, 1);
    expect(a.rating).toBeGreaterThan(winner.rating);
    expect(b.rating).toBeLessThan(loser.rating);
  });

  it('is symmetric when the roles are swapped', () => {
    const p = fresh({ rating: 1600, rd: 200 });
    const q = fresh({ rating: 1500, rd: 250 });
    const forward = updateRating(p, q, 1);
    const reverse = updateRating(q, p, 0);
    // p-wins-vs-q and q-loses-vs-p must give identical new ratings
    // for both players.
    expect(forward.a.rating).toBeCloseTo(reverse.b.rating, 6);
    expect(forward.b.rating).toBeCloseTo(reverse.a.rating, 6);
    expect(forward.a.rd).toBeCloseTo(reverse.b.rd, 6);
    expect(forward.b.rd).toBeCloseTo(reverse.a.rd, 6);
  });

  it('a draw between equal players barely moves the rating', () => {
    const a = fresh();
    const b = fresh();
    const result = updateRating(a, b, 0.5);
    expect(Math.abs(result.a.rating - a.rating)).toBeLessThan(0.5);
    expect(Math.abs(result.b.rating - b.rating)).toBeLessThan(0.5);
  });

  it('shrinks RD after a match', () => {
    const a = fresh();
    const b = fresh();
    const result = updateRating(a, b, 1);
    expect(result.a.rd).toBeLessThan(a.rd);
    expect(result.b.rd).toBeLessThan(b.rd);
  });

  it('an upset (low beats high) gives the winner a large rating jump', () => {
    const low = fresh({ rating: 1300, rd: 80 });
    const high = fresh({ rating: 1800, rd: 80 });

    const upset = updateRating(low, high, 1);
    const expectedWin = updateRating(high, low, 1);

    const upsetGain = upset.a.rating - low.rating;
    const expectedGain = expectedWin.a.rating - high.rating;

    // The upset winner should gain far more than the favourite
    // winning as expected.
    expect(upsetGain).toBeGreaterThan(expectedGain * 3);
  });

  it('a high-RD player is more volatile than a low-RD player', () => {
    const freshPlayer = fresh({ rating: 1500, rd: 350 });
    const settledPlayer = fresh({ rating: 1500, rd: 80 });
    const opp = fresh({ rating: 1500, rd: 80 });

    const freshResult = updateRating(freshPlayer, opp, 1);
    const settledResult = updateRating(settledPlayer, opp, 1);

    // Fresh (high-RD) player swings further after one match.
    expect(freshResult.a.rating - freshPlayer.rating).toBeGreaterThan(
      settledResult.a.rating - settledPlayer.rating,
    );
  });

  it('volatility stays in a plausible range after a normal match', () => {
    const a = fresh();
    const b = fresh();
    const result = updateRating(a, b, 1);
    // Glicko-2 volatility should stay close to the prior unless the
    // match is a big surprise. Guard against runaway values.
    expect(result.a.volatility).toBeGreaterThan(0.01);
    expect(result.a.volatility).toBeLessThan(0.2);
    expect(result.b.volatility).toBeGreaterThan(0.01);
    expect(result.b.volatility).toBeLessThan(0.2);
  });

  it('snapshot: locks in numeric behaviour for a known input', () => {
    // Regression anchor. If the algorithm constants or implementation
    // change, this snapshot will flag it. Inputs: equal-strength
    // defaults, A wins.
    const result = updateRating(fresh(), fresh(), 1);
    const rounded = {
      a: {
        rating: Math.round(result.a.rating * 100) / 100,
        rd: Math.round(result.a.rd * 100) / 100,
        volatility: Math.round(result.a.volatility * 1_000_000) / 1_000_000,
      },
      b: {
        rating: Math.round(result.b.rating * 100) / 100,
        rd: Math.round(result.b.rd * 100) / 100,
        volatility: Math.round(result.b.volatility * 1_000_000) / 1_000_000,
      },
    };
    expect(rounded).toMatchInlineSnapshot(`
      {
        "a": {
          "rating": 1662.31,
          "rd": 290.32,
          "volatility": 0.06,
        },
        "b": {
          "rating": 1337.69,
          "rd": 290.32,
          "volatility": 0.06,
        },
      }
    `);
  });
});

describe('applyInactivity', () => {
  it('does not change rating', () => {
    const r = fresh({ rating: 1650, rd: 120 });
    const after = applyInactivity(r);
    expect(after.rating).toBe(r.rating);
  });

  it('grows RD when below the default ceiling', () => {
    const r = fresh({ rating: 1500, rd: 100 });
    const after = applyInactivity(r);
    expect(after.rd).toBeGreaterThan(r.rd);
  });

  it('caps RD at the default ceiling', () => {
    const r = fresh({ rating: 1500, rd: DEFAULT_RD });
    const after = applyInactivity(r);
    expect(after.rd).toBeLessThanOrEqual(DEFAULT_RD);
  });

  it('leaves volatility untouched', () => {
    const r = fresh({ rating: 1500, rd: 120, volatility: 0.08 });
    const after = applyInactivity(r);
    expect(after.volatility).toBe(r.volatility);
  });
});
