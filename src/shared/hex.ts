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

// The 6 hex directions (flat-top, starting East, going counter-clockwise)
export const HEX_DIRECTIONS: readonly HexVec[] = [
  { dq: +1, dr: 0 },  // 0: E
  { dq: +1, dr: -1 }, // 1: NE
  { dq: 0, dr: -1 },  // 2: NW
  { dq: -1, dr: 0 },  // 3: W
  { dq: -1, dr: +1 }, // 4: SW
  { dq: 0, dr: +1 },  // 5: SE
];

// --- Basic arithmetic ---

export function hexAdd(h: HexCoord, v: HexVec): HexCoord {
  return { q: h.q + v.dq, r: h.r + v.dr };
}

export function hexSubtract(a: HexCoord, b: HexCoord): HexVec {
  return { dq: a.q - b.q, dr: a.r - b.r };
}

export function hexEqual(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexKey(h: HexCoord): string {
  return `${h.q},${h.r}`;
}

// --- Cube coordinates (q, r, s where s = -q - r) ---

interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

function axialToCube(h: HexCoord): CubeCoord {
  return { q: h.q, r: h.r, s: -h.q - h.r };
}

function cubeToAxial(c: CubeCoord): HexCoord {
  return { q: c.q, r: c.r };
}

export function cubeRound(fq: number, fr: number, fs: number): HexCoord {
  let q = Math.round(fq);
  let r = Math.round(fr);
  let s = Math.round(fs);

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
}

// --- Distance ---

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const ac = axialToCube(a);
  const bc = axialToCube(b);
  return Math.max(
    Math.abs(ac.q - bc.q),
    Math.abs(ac.r - bc.r),
    Math.abs(ac.s - bc.s)
  );
}

// --- Neighbors ---

export function hexNeighbor(h: HexCoord, direction: number): HexCoord {
  const d = HEX_DIRECTIONS[direction];
  return { q: h.q + d.dq, r: h.r + d.dr };
}

export function hexNeighbors(h: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map(d => ({ q: h.q + d.dq, r: h.r + d.dr }));
}

// --- Line drawing ---
// Returns all hexes along a straight line from a to b (inclusive).
// Uses linear interpolation in cube space with epsilon nudge for boundary consistency.

function cubeLerp(a: CubeCoord, b: CubeCoord, t: number): { q: number; r: number; s: number } {
  return {
    q: a.q + (b.q - a.q) * t,
    r: a.r + (b.r - a.r) * t,
    s: a.s + (b.s - a.s) * t,
  };
}

export function hexLineDraw(a: HexCoord, b: HexCoord): HexCoord[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];

  const ac = axialToCube(a);
  const bc = axialToCube(b);

  // Epsilon nudge to avoid landing exactly on hex boundaries
  const eps = 1e-6;
  const aNudged: CubeCoord = { q: ac.q + eps, r: ac.r + eps, s: ac.s - 2 * eps };
  const bNudged: CubeCoord = { q: bc.q + eps, r: bc.r + eps, s: bc.s - 2 * eps };

  const results: HexCoord[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lerped = cubeLerp(aNudged, bNudged, t);
    results.push(cubeRound(lerped.q, lerped.r, lerped.s));
  }
  return results;
}

// --- Pixel conversion (flat-top hex) ---

const SQRT3 = Math.sqrt(3);

export function hexToPixel(h: HexCoord, size: number): PixelCoord {
  return {
    x: size * (3 / 2) * h.q,
    y: size * (SQRT3 / 2 * h.q + SQRT3 * h.r),
  };
}

export function pixelToHex(p: PixelCoord, size: number): HexCoord {
  const q = (2 / 3) * p.x / size;
  const r = (-1 / 3 * p.x + SQRT3 / 3 * p.y) / size;
  return cubeRound(q, r, -q - r);
}

// --- Direction from one hex toward another ---
// Returns the HEX_DIRECTIONS index that best points from 'from' toward 'to'

export function hexDirectionToward(from: HexCoord, to: HexCoord): number {
  const fp = hexToPixel(from, 1);
  const tp = hexToPixel(to, 1);
  const dx = tp.x - fp.x;
  const dy = tp.y - fp.y;

  if (dx === 0 && dy === 0) return 0; // Same hex, default to E

  const angle = Math.atan2(dy, dx);

  // Compute pixel angles from the actual direction vectors (bulletproof)
  let bestDir = 0;
  let bestDist = Infinity;
  for (let d = 0; d < 6; d++) {
    const v = HEX_DIRECTIONS[d];
    const da = Math.atan2(
      SQRT3 / 2 * v.dq + SQRT3 * v.dr,
      (3 / 2) * v.dq,
    );
    let diff = Math.abs(angle - da);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff < bestDist) {
      bestDist = diff;
      bestDir = d;
    }
  }
  return bestDir;
}

// --- Hex ring (all hexes at exactly distance n from center) ---

export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius === 0) return [center];

  const results: HexCoord[] = [];
  // Start at the hex 'radius' steps in direction 4 (SW) from center
  let hex: HexCoord = center;
  for (let i = 0; i < radius; i++) {
    hex = hexNeighbor(hex, 4); // SW
  }

  // Walk around the ring: 6 sides, each 'radius' steps
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(hex);
      hex = hexNeighbor(hex, side); // directions 0-5 in order
    }
  }

  return results;
}

// --- Speed (magnitude of a hex vector) ---

export function hexVecLength(v: HexVec): number {
  return hexDistance({ q: 0, r: 0 }, { q: v.dq, r: v.dr });
}
