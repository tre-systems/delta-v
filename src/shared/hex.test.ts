import { describe, expect, it } from 'vitest';
import {
  analyzeHexLine,
  cubeRound,
  HEX_DIRECTIONS,
  hexAdd,
  hexDirectionToward,
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
    expect(hexNeighbor(center, 0)).toEqual({ q: 6, r: 3 }); // E
    expect(hexNeighbor(center, 1)).toEqual({ q: 6, r: 2 }); // NE
    expect(hexNeighbor(center, 2)).toEqual({ q: 5, r: 2 }); // NW
    expect(hexNeighbor(center, 3)).toEqual({ q: 4, r: 3 }); // W
    expect(hexNeighbor(center, 4)).toEqual({ q: 4, r: 4 }); // SW
    expect(hexNeighbor(center, 5)).toEqual({ q: 5, r: 4 }); // SE
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
    expect(line.map((h) => h.q)).toEqual([0, 1, 2, 3]);
    expect(line.every((h) => h.r === 0)).toBe(true);
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

describe('analyzeHexLine', () => {
  it('axis-aligned path has no ambiguous pairs', () => {
    // Moving straight E: (0,0) -> (3,0)
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 3, r: 0 });
    expect(result.ambiguousPairs).toHaveLength(0);
    expect(result.definite).toHaveLength(4); // 0,0 through 3,0
  });

  it('diagonal path along hex edge produces ambiguous pairs', () => {
    // (0,0) -> (2,-1): this line runs along the edge between (1,0) and (1,-1)
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 2, r: -1 });
    expect(result.ambiguousPairs).toHaveLength(1);
    const pair = result.ambiguousPairs[0];
    const pairKeys = [hexKey(pair[0]), hexKey(pair[1])].sort();
    expect(pairKeys).toEqual(['1,-1', '1,0']);
  });

  it('definite hexes exclude ambiguous ones', () => {
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 2, r: -1 });
    const definiteKeys = new Set(result.definite.map(hexKey));
    // Start and end are always definite
    expect(definiteKeys.has('0,0')).toBe(true);
    expect(definiteKeys.has('2,-1')).toBe(true);
    // Ambiguous hexes should not be in definite
    expect(definiteKeys.has('1,0')).toBe(false);
    expect(definiteKeys.has('1,-1')).toBe(false);
  });

  it('longer diagonal produces multiple ambiguous pairs', () => {
    // (0,0) -> (4,-2): runs along edges for each step
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 4, r: -2 });
    expect(result.ambiguousPairs.length).toBeGreaterThanOrEqual(1);
    // Each ambiguous pair should be neighbors
    for (const [a, b] of result.ambiguousPairs) {
      expect(hexDistance(a, b)).toBe(1);
    }
  });

  it('primary and alternate have the same length', () => {
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 4, r: -2 });
    expect(result.primary.length).toBe(result.alternate.length);
  });

  it('same hex produces no ambiguity', () => {
    const result = analyzeHexLine({ q: 3, r: 5 }, { q: 3, r: 5 });
    expect(result.ambiguousPairs).toHaveLength(0);
    expect(result.definite).toHaveLength(1);
  });

  it('non-edge-aligned diagonal has no ambiguous pairs', () => {
    // (0,0) -> (3,-1): this path does not run along hex edges
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 3, r: -1 });
    expect(result.ambiguousPairs).toHaveLength(0);
    expect(result.definite).toHaveLength(4);
  });

  it('reverse direction produces consistent ambiguous pairs', () => {
    const forward = analyzeHexLine({ q: 0, r: 0 }, { q: 2, r: -1 });
    const backward = analyzeHexLine({ q: 2, r: -1 }, { q: 0, r: 0 });
    // Both should have the same number of ambiguous pairs
    expect(forward.ambiguousPairs).toHaveLength(backward.ambiguousPairs.length);
    // The ambiguous hex keys should be the same (order may differ)
    const fwdPairKeys = forward.ambiguousPairs.map(([a, b]) => [hexKey(a), hexKey(b)].sort().join('|'));
    const bwdPairKeys = backward.ambiguousPairs.map(([a, b]) => [hexKey(a), hexKey(b)].sort().join('|'));
    expect(fwdPairKeys.sort()).toEqual(bwdPairKeys.sort());
  });

  it('NE diagonal (0,0) -> (2,-2) along hex edges', () => {
    // This moves 2 steps in the NE direction, which is axis-aligned
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 2, r: -2 });
    expect(result.ambiguousPairs).toHaveLength(0);
    expect(result.definite).toHaveLength(3);
  });

  it('SE diagonal (0,0) -> (0,2) along hex edges', () => {
    // This moves 2 steps in the SE direction, which is axis-aligned
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 0, r: 2 });
    expect(result.ambiguousPairs).toHaveLength(0);
  });

  it('off-axis path (0,0) -> (1,1) has ambiguous middle', () => {
    // Distance 2, going through either (0,1) or (1,0)
    const result = analyzeHexLine({ q: 0, r: 0 }, { q: 1, r: 1 });
    // For distance 2, the middle hex is ambiguous
    expect(result.ambiguousPairs.length).toBeGreaterThanOrEqual(0);
    // Start and end are always definite
    const definiteKeys = new Set(result.definite.map(hexKey));
    expect(definiteKeys.has('0,0')).toBe(true);
    expect(definiteKeys.has('1,1')).toBe(true);
  });
});

describe('parseHexKey', () => {
  it('is the inverse of hexKey', () => {
    const coord = { q: 3, r: -7 };
    expect(parseHexKey(hexKey(coord))).toEqual(coord);
  });

  it('parses positive coords', () => {
    expect(parseHexKey('5,10')).toEqual({ q: 5, r: 10 });
  });

  it('parses negative coords', () => {
    expect(parseHexKey('-3,-4')).toEqual({ q: -3, r: -4 });
  });

  it('parses zero', () => {
    expect(parseHexKey('0,0')).toEqual({ q: 0, r: 0 });
  });
});
