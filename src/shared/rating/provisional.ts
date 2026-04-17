// Provisional-gating rules for the public leaderboard. A player is
// *provisional* — hidden from the default leaderboard view — until
// enough of their rating uncertainty has been wrung out. All three
// thresholds must clear before a player appears on the main board.
//
// Thresholds are deliberately named so operators can tune one lever
// at a time without hunting through query code. Defaults target the
// beta-scale matchmaker: a fresh account needs ~10 games against at
// least 5 distinct opponents before ranking publicly.

export const MIN_GAMES_PLAYED = 10;
export const MIN_DISTINCT_OPPONENTS = 5;
// Glicko-2 RD: starts at 350 for new players and decays as they play.
// RD ≤ 100 roughly corresponds to "rating is stable within ±200 with
// 95% confidence" — the point at which a public ranking is meaningful.
export const MAX_RD_FOR_RANKED = 100;

export interface ProvisionalInput {
  gamesPlayed: number;
  distinctOpponents: number;
  rd: number;
}

export const isProvisional = (input: ProvisionalInput): boolean =>
  input.gamesPlayed < MIN_GAMES_PLAYED ||
  input.distinctOpponents < MIN_DISTINCT_OPPONENTS ||
  input.rd > MAX_RD_FOR_RANKED;
