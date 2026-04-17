// Glicko-2 rating system — Mark Glickman's 2013 paper
// ("Example of the Glicko-2 system"). We use the one-opponent
// per rating-period specialisation, which fits a head-to-head
// online game where both players' ratings should update as soon
// as a ranked match ends.
//
// Ratings and RDs are stored and returned in the display scale
// (default 1500 / 350). The algorithm converts to the internal
// μ / φ log scale for the update and back at the end.
//
// The one subtle piece is the volatility update, which requires
// a bracketed root-find ("Illinois algorithm") on f(x) defined
// in the paper. This implementation follows the pseudocode from
// the 2013 example verbatim.

export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOLATILITY = 0.06;

// System constant τ. Controls how much the volatility of a
// rating is allowed to drift per period. 0.3–1.2 is the
// documented range; 0.5 is Glickman's default.
const TAU = 0.5;

// Convergence tolerance for the volatility root-find.
const CONVERGENCE_EPSILON = 0.000001;

// Safety cap on root-find iterations in case of pathological
// inputs. Real convergence is typically under 10 iterations.
const MAX_ITERATIONS = 100;

// 400 / ln(10) — scale factor between display ratings (Elo-like)
// and the internal Glicko-2 scale.
const SCALE = 173.7178;

export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

// Outcome from player A's perspective: 1 = win, 0 = loss, 0.5 = draw.
export type Outcome = 0 | 0.5 | 1;

export interface RatingUpdate {
  a: Rating;
  b: Rating;
}

export const newRating = (): Rating => ({
  rating: DEFAULT_RATING,
  rd: DEFAULT_RD,
  volatility: DEFAULT_VOLATILITY,
});

const g = (phi: number): number =>
  1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

const expected = (mu: number, muOpp: number, phiOpp: number): number =>
  1 / (1 + Math.exp(-g(phiOpp) * (mu - muOpp)));

// Bracketed root-find for the new volatility. See step 5 of the
// 2013 paper. Returns σ' in the natural (not log) scale.
const updateVolatility = (
  sigma: number,
  phi: number,
  v: number,
  delta: number,
): number => {
  const a = Math.log(sigma * sigma);
  const tauSq = TAU * TAU;
  const phiSq = phi * phi;
  const deltaSq = delta * delta;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (deltaSq - phiSq - v - ex);
    const den = 2 * (phiSq + v + ex) * (phiSq + v + ex);
    return num / den - (x - a) / tauSq;
  };

  let A = a;
  let B: number;
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) {
      k += 1;
      if (k > MAX_ITERATIONS) break;
    }
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  for (
    let iter = 0;
    iter < MAX_ITERATIONS && Math.abs(B - A) > CONVERGENCE_EPSILON;
    iter += 1
  ) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
};

// Compute one player's new rating given a single opponent and
// the outcome from this player's perspective.
const stepOnce = (
  mu: number,
  phi: number,
  sigma: number,
  muOpp: number,
  phiOpp: number,
  outcome: Outcome,
): Rating => {
  const gOpp = g(phiOpp);
  const e = expected(mu, muOpp, phiOpp);
  const v = 1 / (gOpp * gOpp * e * (1 - e));
  const delta = v * gOpp * (outcome - e);

  const sigmaNew = updateVolatility(sigma, phi, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gOpp * (outcome - e);

  return {
    rating: SCALE * muNew + 1500,
    rd: SCALE * phiNew,
    volatility: sigmaNew,
  };
};

// Update both players' ratings given the outcome from A's
// perspective. The returned update is flipped automatically for B.
export const updateRating = (
  a: Rating,
  b: Rating,
  outcome: Outcome,
): RatingUpdate => {
  const muA = (a.rating - 1500) / SCALE;
  const phiA = a.rd / SCALE;
  const muB = (b.rating - 1500) / SCALE;
  const phiB = b.rd / SCALE;

  const flipped: Outcome = outcome === 1 ? 0 : outcome === 0 ? 1 : 0.5;

  return {
    a: stepOnce(muA, phiA, a.volatility, muB, phiB, outcome),
    b: stepOnce(muB, phiB, b.volatility, muA, phiA, flipped),
  };
};

// Inactivity step for a player who did not play in a rating
// period. Grows RD toward DEFAULT_RD without touching rating.
// Not used in the per-match online flow but available for batch
// jobs or future rating-period models.
export const applyInactivity = (r: Rating): Rating => {
  const phi = r.rd / SCALE;
  const phiStar = Math.sqrt(phi * phi + r.volatility * r.volatility);
  return {
    rating: r.rating,
    rd: Math.min(SCALE * phiStar, DEFAULT_RD),
    volatility: r.volatility,
  };
};
