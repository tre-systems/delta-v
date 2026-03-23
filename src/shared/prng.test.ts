import { describe, expect, it } from 'vitest';
import { deriveActionRng, mulberry32 } from './prng';

describe('mulberry32', () => {
  it('produces deterministic output for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const valuesA = Array.from({ length: 100 }, () => a());
    const valuesB = Array.from({ length: 100 }, () => b());

    expect(valuesA).toEqual(valuesB);
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(1);
    const values = Array.from({ length: 10_000 }, () => rng());

    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('has roughly uniform distribution', () => {
    const rng = mulberry32(7);
    const values = Array.from({ length: 10_000 }, () => rng());
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it('different seeds produce different sequences', () => {
    const a = mulberry32(0);
    const b = mulberry32(1);

    expect(a()).not.toBe(b());
  });

  it('has very few collisions over 10k values', () => {
    const rng = mulberry32(1);
    const seen = new Set<number>();

    for (let i = 0; i < 10_000; i++) {
      seen.add(rng());
    }

    // Allow a handful of float collisions but not many
    expect(seen.size).toBeGreaterThan(9_900);
  });

  it('snapshot: first 5 values for seed 42', () => {
    const rng = mulberry32(42);
    const values = Array.from({ length: 5 }, () => rng());

    // Lock down the sequence so algorithm changes are
    // caught immediately.
    expect(values).toMatchInlineSnapshot(`
      [
        0.6011037519201636,
        0.44829055899754167,
        0.8524657934904099,
        0.6697340414393693,
        0.17481389874592423,
      ]
    `);
  });
});

describe('deriveActionRng', () => {
  it('same seed + seq produces identical sequence', () => {
    const a = deriveActionRng(12345, 7);
    const b = deriveActionRng(12345, 7);

    expect(Array.from({ length: 20 }, () => a())).toEqual(
      Array.from({ length: 20 }, () => b()),
    );
  });

  it('different seq produces different sequence', () => {
    const a = deriveActionRng(12345, 1);
    const b = deriveActionRng(12345, 2);

    expect(a()).not.toBe(b());
  });

  it('adjacent seqs diverge immediately', () => {
    for (let seq = 0; seq < 100; seq++) {
      const a = deriveActionRng(99999, seq);
      const b = deriveActionRng(99999, seq + 1);

      expect(a()).not.toBe(b());
    }
  });

  it('different seeds with same seq diverge', () => {
    const a = deriveActionRng(0, 5);
    const b = deriveActionRng(1, 5);

    expect(a()).not.toBe(b());
  });
});
