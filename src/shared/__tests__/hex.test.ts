import { describe, it, expect } from 'vitest';
import {
  hexAdd, hexSubtract, hexEqual, hexKey,
  hexDistance, hexNeighbor, hexNeighbors,
  hexLineDraw, hexToPixel, pixelToHex,
  hexDirectionToward, hexRing, hexVecLength,
  HEX_DIRECTIONS, cubeRound,
} from '../hex';

describe('hex arithmetic', () => {
  it('hexAdd adds vector to coordinate', () => {
    expect(hexAdd({ q: 1, r: 2 }, { dq: 3, dr: -1 })).toEqual({ q: 4, r: 1 });
  });

  it('hexSubtract computes displacement', () => {
    expect(hexSubtract({ q: 5, r: 3 }, { q: 2, r: 1 })).toEqual({ dq: 3, dr: 2 });
  });

  it('hexEqual compares coordinates', () => {
    expect(hexEqual({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true);
    expect(hexEqual({ q: 1, r: 2 }, { q: 1, r: 3 })).toBe(false);
  });

  it('hexKey produces consistent string keys', () => {
    expect(hexKey({ q: 3, r: -5 })).toBe('3,-5');
  });
});

describe('hexDistance', () => {
  it('same hex is distance 0', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
  });

  it('adjacent hex is distance 1', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(1);
  });

  it('computes correct distance for non-adjacent hexes', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
    expect(hexDistance({ q: 2, r: 3 }, { q: -1, r: 5 })).toBe(3);
  });
});

describe('hexNeighbor / hexNeighbors', () => {
  it('returns correct neighbor for each direction', () => {
    const center = { q: 5, r: 3 };
    expect(hexNeighbor(center, 0)).toEqual({ q: 6, r: 3 });  // E
    expect(hexNeighbor(center, 1)).toEqual({ q: 6, r: 2 });  // NE
    expect(hexNeighbor(center, 2)).toEqual({ q: 5, r: 2 });  // NW
    expect(hexNeighbor(center, 3)).toEqual({ q: 4, r: 3 });  // W
    expect(hexNeighbor(center, 4)).toEqual({ q: 4, r: 4 });  // SW
    expect(hexNeighbor(center, 5)).toEqual({ q: 5, r: 4 });  // SE
  });

  it('hexNeighbors returns all 6 neighbors', () => {
    const neighbors = hexNeighbors({ q: 0, r: 0 });
    expect(neighbors).toHaveLength(6);
    expect(neighbors).toContainEqual({ q: 1, r: 0 });
    expect(neighbors).toContainEqual({ q: -1, r: 0 });
  });
});

describe('hexLineDraw', () => {
  it('same hex returns single element', () => {
    const line = hexLineDraw({ q: 3, r: 5 }, { q: 3, r: 5 });
    expect(line).toHaveLength(1);
    expect(line[0]).toEqual({ q: 3, r: 5 });
  });

  it('adjacent hexes returns two elements', () => {
    const line = hexLineDraw({ q: 0, r: 0 }, { q: 1, r: 0 });
    expect(line).toHaveLength(2);
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line[1]).toEqual({ q: 1, r: 0 });
  });

  it('straight line E direction', () => {
    const line = hexLineDraw({ q: 0, r: 0 }, { q: 3, r: 0 });
    expect(line).toHaveLength(4);
    expect(line.map(h => h.q)).toEqual([0, 1, 2, 3]);
    expect(line.every(h => h.r === 0)).toBe(true);
  });

  it('line length matches hex distance + 1', () => {
    const a = { q: 2, r: -3 };
    const b = { q: -1, r: 4 };
    const line = hexLineDraw(a, b);
    expect(line).toHaveLength(hexDistance(a, b) + 1);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
  });
});

describe('hexToPixel / pixelToHex', () => {
  it('origin maps to pixel origin', () => {
    const p = hexToPixel({ q: 0, r: 0 }, 10);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it('round-trips through pixelToHex', () => {
    const original = { q: 3, r: -2 };
    const pixel = hexToPixel(original, 10);
    const back = pixelToHex(pixel, 10);
    expect(back).toEqual(original);
  });
});

describe('hexDirectionToward', () => {
  it('returns 0 (E) for hex to the east', () => {
    expect(hexDirectionToward({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(0);
  });

  it('returns 3 (W) for hex to the west', () => {
    expect(hexDirectionToward({ q: 0, r: 0 }, { q: -3, r: 0 })).toBe(3);
  });

  it('returns correct direction for each of the 6 directions', () => {
    const center = { q: 5, r: 5 };
    for (let d = 0; d < 6; d++) {
      const dir = HEX_DIRECTIONS[d];
      const target = { q: center.q + dir.dq * 3, r: center.r + dir.dr * 3 };
      expect(hexDirectionToward(center, target)).toBe(d);
    }
  });
});

describe('hexRing', () => {
  it('ring 0 returns just the center', () => {
    expect(hexRing({ q: 0, r: 0 }, 0)).toEqual([{ q: 0, r: 0 }]);
  });

  it('ring 1 returns 6 hexes', () => {
    const ring = hexRing({ q: 0, r: 0 }, 1);
    expect(ring).toHaveLength(6);
    // All should be distance 1 from center
    for (const h of ring) {
      expect(hexDistance({ q: 0, r: 0 }, h)).toBe(1);
    }
  });

  it('ring 2 returns 12 hexes', () => {
    const ring = hexRing({ q: 0, r: 0 }, 2);
    expect(ring).toHaveLength(12);
    for (const h of ring) {
      expect(hexDistance({ q: 0, r: 0 }, h)).toBe(2);
    }
  });
});

describe('hexVecLength', () => {
  it('zero vector has length 0', () => {
    expect(hexVecLength({ dq: 0, dr: 0 })).toBe(0);
  });

  it('unit vectors have length 1', () => {
    for (const d of HEX_DIRECTIONS) {
      expect(hexVecLength(d)).toBe(1);
    }
  });

  it('computes correct magnitude', () => {
    expect(hexVecLength({ dq: 3, dr: 0 })).toBe(3);
    expect(hexVecLength({ dq: 2, dr: -2 })).toBe(2);
  });
});

describe('cubeRound', () => {
  it('rounds to nearest hex', () => {
    const r1 = cubeRound(0.3, -0.1, -0.2);
    expect(r1.q).toBe(0);
    expect(Object.is(r1.r, -0) ? 0 : r1.r).toBe(0); // JS -0 quirk
    expect(cubeRound(0.9, 0.1, -1.0).q).toBe(1);
  });
});
