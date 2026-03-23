// mulberry32 — fast 32-bit PRNG with full 2^32 period.
// Returns () => number producing values in [0, 1).
export const mulberry32 = (seed: number): (() => number) => {
  let s = seed | 0;

  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
};

// Knuth multiplicative hash constant (golden ratio
// scaled to 32 bits) — spreads adjacent seq numbers
// into well-separated seed space.
const KNUTH = 0x9e3779b9;

// Derive a per-action RNG from a match seed and the
// current event sequence number. Each action gets a
// fresh, deterministic PRNG stream.
export const deriveActionRng = (
  matchSeed: number,
  actionSeq: number,
): (() => number) => mulberry32((matchSeed ^ Math.imul(actionSeq, KNUTH)) | 0);
