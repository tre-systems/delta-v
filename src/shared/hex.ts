// Axial hex coordinate system (flat-top orientation)
// Reference: Red Blob Games hex grid guide

export interface HexCoord {
  q: number;
  r: number;
}

export interface HexVec {
  dq: number;
  dr: number;
}

export interface PixelCoord {
  x: number;
  y: number;
}

// The 6 hex directions
// (flat-top, starting East, going counter-clockwise)
export const HEX_DIRECTIONS: readonly HexVec[] = [
  { dq: +1, dr: 0 }, // 0: E
  { dq: +1, dr: -1 }, // 1: NE
  { dq: 0, dr: -1 }, // 2: NW
  { dq: -1, dr: 0 }, // 3: W
  { dq: -1, dr: +1 }, // 4: SW
  { dq: 0, dr: +1 }, // 5: SE
];

// --- Basic arithmetic ---

export const hexAdd = ({ q, r }: HexCoord, { dq, dr }: HexVec): HexCoord => ({
  q: q + dq,
  r: r + dr,
});

export const hexSubtract = (a: HexCoord, b: HexCoord): HexVec => ({
  dq: a.q - b.q,
  dr: a.r - b.r,
});

export const hexEqual = (a: HexCoord, b: HexCoord): boolean =>
  a.q === b.q && a.r === b.r;

declare const __hexKeyBrand: unique symbol;
/** Serialized hex coordinate in `"q,r"` format. Branded to prevent mixing with arbitrary strings. */
export type HexKey = string & { readonly [__hexKeyBrand]: never };

export const hexKey = ({ q, r }: HexCoord): HexKey => `${q},${r}` as HexKey;

/** Cast a trusted `"q,r"` string literal to HexKey. Use only at serialization boundaries and in tests. */
export const asHexKey = (key: string): HexKey => key as HexKey;

const HEX_KEY_PATTERN = /^-?\d+,-?\d+$/;

/** Type-guard for strings that match the `"q,r"` hex-key format. */
export const isHexKey = (value: unknown): value is HexKey =>
  typeof value === 'string' && HEX_KEY_PATTERN.test(value);

// Inverse of hexKey: parse "q,r" string back.
export const parseHexKey = (key: HexKey): HexCoord => {
  const [q, r] = key.split(',').map(Number);

  return { q, r };
};

// --- Cube coordinates (q, r, s where s = -q - r) ---

interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

const axialToCube = ({ q, r }: HexCoord): CubeCoord => ({
  q,
  r,
  s: -q - r,
});

export const cubeRound = (fq: number, fr: number, fs: number): HexCoord => {
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);

  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);

  // Fix the component with the largest rounding error
  if (dq > dr && dq > ds) {
    q = -r - s;
  } else if (dr > ds) {
    r = -q - s;
  }

  // else s = -q - r (implicit, we only need q and r)

  return { q, r };
};

// --- Distance ---

export const hexDistance = (a: HexCoord, b: HexCoord): number => {
  const ac = axialToCube(a);
  const bc = axialToCube(b);

  return Math.max(
    Math.abs(ac.q - bc.q),
    Math.abs(ac.r - bc.r),
    Math.abs(ac.s - bc.s),
  );
};

// --- Neighbors ---

export const hexNeighbor = (h: HexCoord, direction: number): HexCoord => {
  const { dq, dr } = HEX_DIRECTIONS[direction];

  return { q: h.q + dq, r: h.r + dr };
};

export const hexNeighbors = ({ q, r }: HexCoord): HexCoord[] =>
  HEX_DIRECTIONS.map(({ dq, dr }) => ({
    q: q + dq,
    r: r + dr,
  }));

// --- Line drawing ---
// Returns all hexes along a straight line from a to b
// (inclusive). Uses linear interpolation in cube space
// with epsilon nudge for boundary consistency.

const cubeLerp = (
  a: CubeCoord,
  b: CubeCoord,
  t: number,
): { q: number; r: number; s: number } => ({
  q: a.q + (b.q - a.q) * t,
  r: a.r + (b.r - a.r) * t,
  s: a.s + (b.s - a.s) * t,
});

const HEX_LINE_NUDGE_EPS = 1e-6;

const hexLineDrawWithNudge = (
  a: HexCoord,
  b: HexCoord,
  eps: number,
): HexCoord[] => {
  const n = hexDistance(a, b);

  if (n === 0) return [a];

  const ac = axialToCube(a);
  const bc = axialToCube(b);

  // Epsilon nudge to avoid landing exactly on hex
  // boundaries
  const aNudged: CubeCoord = {
    q: ac.q + eps,
    r: ac.r + eps,
    s: ac.s - 2 * eps,
  };

  const bNudged: CubeCoord = {
    q: bc.q + eps,
    r: bc.r + eps,
    s: bc.s - 2 * eps,
  };

  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const lerped = cubeLerp(aNudged, bNudged, t);

    return cubeRound(lerped.q, lerped.r, lerped.s);
  });
};

export const hexLineDraw = (a: HexCoord, b: HexCoord): HexCoord[] =>
  hexLineDrawWithNudge(a, b, HEX_LINE_NUDGE_EPS);

export interface HexLineAnalysis {
  primary: HexCoord[];
  alternate: HexCoord[];
  definite: HexCoord[];
  ambiguousPairs: Array<[HexCoord, HexCoord]>;
}

// Dual-nudge hex line analysis.
//
// A straight line between two hex centres can land exactly
// on a hexside boundary, making it ambiguous which hex the
// path actually enters. This matters for LOS (does a body
// block the shot?), asteroid hazards (does the ship cross
// the asteroid hex?), and gravity (does the ship enter the
// gravity ring?).
//
// We trace the line twice with opposite epsilon nudges
// (+eps, -eps), pushing it slightly to each side of any
// boundary. Hexes that appear in *both* traces are
// "definite" — the path unambiguously crosses them. Hexes
// that differ between traces form "ambiguous pairs" — the
// path runs along the hexside between them. Callers decide
// the rule: LOS treats ambiguous hexes as non-blocking,
// asteroid hazards queue both, gravity ignores edge-grazes.
export const analyzeHexLine = (a: HexCoord, b: HexCoord): HexLineAnalysis => {
  const primary = hexLineDrawWithNudge(a, b, HEX_LINE_NUDGE_EPS);
  const alternate = hexLineDrawWithNudge(a, b, -HEX_LINE_NUDGE_EPS);
  const alternateKeys = new Set(alternate.map(hexKey));
  const seenDefinite = new Set<string>();
  const definite: HexCoord[] = [];

  for (const hex of primary) {
    const key = hexKey(hex);

    if (!alternateKeys.has(key) || seenDefinite.has(key)) {
      continue;
    }
    definite.push(hex);
    seenDefinite.add(key);
  }

  const seenPairs = new Set<string>();
  const ambiguousPairs: Array<[HexCoord, HexCoord]> = [];
  const length = Math.min(primary.length, alternate.length);

  for (let i = 0; i < length; i++) {
    if (hexEqual(primary[i], alternate[i])) continue;

    const firstKey = hexKey(primary[i]);
    const secondKey = hexKey(alternate[i]);
    const pairKey =
      firstKey < secondKey
        ? `${firstKey}|${secondKey}`
        : `${secondKey}|${firstKey}`;

    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    ambiguousPairs.push([primary[i], alternate[i]]);
  }

  return { primary, alternate, definite, ambiguousPairs };
};

// --- Pixel conversion (flat-top hex) ---

const SQRT3 = Math.sqrt(3);

export const hexToPixel = ({ q, r }: HexCoord, size: number): PixelCoord => ({
  x: size * (3 / 2) * q,
  y: size * ((SQRT3 / 2) * q + SQRT3 * r),
});

export const pixelToHex = ({ x, y }: PixelCoord, size: number): HexCoord => {
  const q = ((2 / 3) * x) / size;
  const r = ((-1 / 3) * x + (SQRT3 / 3) * y) / size;

  return cubeRound(q, r, -q - r);
};

// --- Direction from one hex toward another ---
// Returns the HEX_DIRECTIONS index that best points
// from 'from' toward 'to'

export const hexDirectionToward = (from: HexCoord, to: HexCoord): number => {
  const fp = hexToPixel(from, 1);
  const tp = hexToPixel(to, 1);
  const dx = tp.x - fp.x;
  const dy = tp.y - fp.y;

  // Same hex, default to E
  if (dx === 0 && dy === 0) return 0;

  const angle = Math.atan2(dy, dx);

  // Find direction with smallest angular distance
  const { dir } = HEX_DIRECTIONS.reduce(
    (best, { dq, dr }, d) => {
      const da = Math.atan2((SQRT3 / 2) * dq + SQRT3 * dr, (3 / 2) * dq);
      const raw = Math.abs(angle - da);
      const diff = raw > Math.PI ? 2 * Math.PI - raw : raw;

      return diff < best.dist ? { dist: diff, dir: d } : best;
    },
    { dist: Infinity, dir: 0 },
  );

  return dir;
};

// --- Hex ring ---
// All hexes at exactly distance n from center

export const hexRing = (center: HexCoord, radius: number): HexCoord[] => {
  if (radius === 0) return [center];

  const results: HexCoord[] = [];

  // Start at the hex 'radius' steps in direction 4 (SW)
  let hex: HexCoord = Array.from({ length: radius }).reduce<HexCoord>(
    (h) => hexNeighbor(h, 4),
    center,
  );

  // Walk around: 6 sides, each 'radius' steps
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(hex);
      hex = hexNeighbor(hex, side);
    }
  }

  return results;
};

// --- Speed (magnitude of a hex vector) ---

export const hexVecLength = ({ dq, dr }: HexVec): number =>
  hexDistance({ q: 0, r: 0 }, { q: dq, r: dr });
