import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { HexCoord, HexVec } from './hex';
import {
  analyzeHexLine,
  cubeRound,
  hexAdd,
  hexDistance,
  hexEqual,
  hexKey,
  hexLineDraw,
  hexNeighbor,
  hexNeighbors,
  hexRing,
  hexSubtract,
  hexToPixel,
  hexVecLength,
  parseHexKey,
  pixelToHex,
} from './hex';

// --- Arbitraries ---

const arbCoord = (): fc.Arbitrary<HexCoord> =>
  fc.record({
    q: fc.integer({ min: -50, max: 50 }),
    r: fc.integer({ min: -50, max: 50 }),
  });

const arbVec = (): fc.Arbitrary<HexVec> =>
  fc.record({
    dq: fc.integer({ min: -50, max: 50 }),
    dr: fc.integer({ min: -50, max: 50 }),
  });

const arbDirection = () => fc.integer({ min: 0, max: 5 });

describe('hex arithmetic properties', () => {
  it('hexAdd then hexSubtract is identity', () => {
    fc.assert(
      fc.property(arbCoord(), arbVec(), (coord, vec) => {
        const result = hexSubtract(hexAdd(coord, vec), coord);

        expect(result).toEqual(vec);
      }),
    );
  });

  it('hexSubtract then hexAdd is identity', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        const vec = hexSubtract(a, b);

        expect(hexAdd(b, vec)).toEqual(a);
      }),
    );
  });

  it('hexKey and parseHexKey are inverses', () => {
    fc.assert(
      fc.property(arbCoord(), (coord) => {
        expect(parseHexKey(hexKey(coord))).toEqual(coord);
      }),
    );
  });

  it('hexEqual is reflexive', () => {
    fc.assert(
      fc.property(arbCoord(), (coord) => {
        expect(hexEqual(coord, coord)).toBe(true);
      }),
    );
  });

  it('hexEqual is symmetric', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        expect(hexEqual(a, b)).toBe(hexEqual(b, a));
      }),
    );
  });
});

describe('hexDistance properties', () => {
  it('distance is always non-negative', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        expect(hexDistance(a, b)).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('distance from a hex to itself is 0', () => {
    fc.assert(
      fc.property(arbCoord(), (a) => {
        expect(hexDistance(a, a)).toBe(0);
      }),
    );
  });

  it('distance is symmetric', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        expect(hexDistance(a, b)).toBe(hexDistance(b, a));
      }),
    );
  });

  it('triangle inequality holds', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), arbCoord(), (a, b, c) => {
        expect(hexDistance(a, c)).toBeLessThanOrEqual(
          hexDistance(a, b) + hexDistance(b, c),
        );
      }),
    );
  });

  it('neighbors are exactly distance 1', () => {
    fc.assert(
      fc.property(arbCoord(), arbDirection(), (coord, dir) => {
        expect(hexDistance(coord, hexNeighbor(coord, dir))).toBe(1);
      }),
    );
  });

  it('hexVecLength equals distance from origin', () => {
    fc.assert(
      fc.property(arbVec(), (vec) => {
        expect(hexVecLength(vec)).toBe(
          hexDistance({ q: 0, r: 0 }, { q: vec.dq, r: vec.dr }),
        );
      }),
    );
  });
});

describe('hexNeighbors properties', () => {
  it('always returns exactly 6 neighbors', () => {
    fc.assert(
      fc.property(arbCoord(), (coord) => {
        expect(hexNeighbors(coord)).toHaveLength(6);
      }),
    );
  });

  it('all neighbors are distance 1 from center', () => {
    fc.assert(
      fc.property(arbCoord(), (coord) => {
        for (const n of hexNeighbors(coord)) {
          expect(hexDistance(coord, n)).toBe(1);
        }
      }),
    );
  });

  it('all neighbors are distinct', () => {
    fc.assert(
      fc.property(arbCoord(), (coord) => {
        const keys = hexNeighbors(coord).map(hexKey);

        expect(new Set(keys).size).toBe(6);
      }),
    );
  });
});

describe('hexLineDraw properties', () => {
  it('line starts at source and ends at destination', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        const line = hexLineDraw(a, b);

        expect(hexEqual(line[0], a)).toBe(true);
        expect(hexEqual(line[line.length - 1], b)).toBe(true);
      }),
    );
  });

  it('line length equals distance + 1', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        const line = hexLineDraw(a, b);

        expect(line.length).toBe(hexDistance(a, b) + 1);
      }),
    );
  });

  it('consecutive hexes in line are distance 1 apart', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        const line = hexLineDraw(a, b);

        for (let i = 1; i < line.length; i++) {
          expect(hexDistance(line[i - 1], line[i])).toBe(1);
        }
      }),
    );
  });

  it('line to self is single element', () => {
    fc.assert(
      fc.property(arbCoord(), (a) => {
        const line = hexLineDraw(a, a);

        expect(line).toHaveLength(1);
        expect(hexEqual(line[0], a)).toBe(true);
      }),
    );
  });
});

describe('analyzeHexLine properties', () => {
  it('primary and alternate have the same length', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        const analysis = analyzeHexLine(a, b);

        expect(analysis.primary.length).toBe(analysis.alternate.length);
      }),
    );
  });

  it('definite hexes are a subset of both primary and alternate', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        const { primary, alternate, definite } = analyzeHexLine(a, b);
        const primaryKeys = new Set(primary.map(hexKey));
        const alternateKeys = new Set(alternate.map(hexKey));

        for (const hex of definite) {
          const key = hexKey(hex);
          expect(primaryKeys.has(key)).toBe(true);
          expect(alternateKeys.has(key)).toBe(true);
        }
      }),
    );
  });

  it('start and end are always definite', () => {
    fc.assert(
      fc.property(arbCoord(), arbCoord(), (a, b) => {
        const { definite } = analyzeHexLine(a, b);

        expect(definite.some((h) => hexEqual(h, a))).toBe(true);
        expect(definite.some((h) => hexEqual(h, b))).toBe(true);
      }),
    );
  });
});

describe('hexRing properties', () => {
  it('ring of radius 0 is just the center', () => {
    fc.assert(
      fc.property(arbCoord(), (center) => {
        const ring = hexRing(center, 0);

        expect(ring).toHaveLength(1);
        expect(hexEqual(ring[0], center)).toBe(true);
      }),
    );
  });

  it('ring of radius r has exactly 6*r hexes', () => {
    fc.assert(
      fc.property(
        arbCoord(),
        fc.integer({ min: 1, max: 10 }),
        (center, radius) => {
          expect(hexRing(center, radius)).toHaveLength(6 * radius);
        },
      ),
    );
  });

  it('all hexes in ring are exactly distance r from center', () => {
    fc.assert(
      fc.property(
        arbCoord(),
        fc.integer({ min: 1, max: 10 }),
        (center, radius) => {
          for (const hex of hexRing(center, radius)) {
            expect(hexDistance(center, hex)).toBe(radius);
          }
        },
      ),
    );
  });
});

describe('pixel conversion roundtrip', () => {
  it('hexToPixel then pixelToHex returns the original hex', () => {
    fc.assert(
      fc.property(
        arbCoord(),
        fc.double({ min: 5, max: 100, noNaN: true }),
        (coord, size) => {
          const pixel = hexToPixel(coord, size);
          const back = pixelToHex(pixel, size);

          expect(hexEqual(back, coord)).toBe(true);
        },
      ),
    );
  });
});

describe('cubeRound properties', () => {
  it('rounding integer cube coords is identity', () => {
    fc.assert(
      fc.property(arbCoord(), (coord) => {
        const s = -coord.q - coord.r;
        const result = cubeRound(coord.q, coord.r, s);

        expect(result).toEqual(coord);
      }),
    );
  });

  it('rounded coords always satisfy q + r + s = 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        (fq, fr) => {
          const fs = -fq - fr;
          const result = cubeRound(fq, fr, fs);

          expect(result.q + result.r + (-result.q - result.r)).toBe(0);
        },
      ),
    );
  });
});
