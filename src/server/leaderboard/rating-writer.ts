// Glicko-2 rating writer for completed matches.
//
// Triggered at match-end (alongside the R2/D1 match-archive write).
// Skips the rating update when any of these hold:
//   - the room was created via POST /create (private room; second
//     playerToken is null), i.e. not matchmaker-paired
//   - D1 is unbound
//   - either participant lacks a `player` row (they never claimed a
//     username)
//   - winner is null and both players are unresolved (edge case —
//     treat as a draw)
//
// On success writes one `match_rating` row (INSERT OR IGNORE keyed on
// game_id so a retry is a no-op) and UPDATEs both player rows with
// new rating / rd / volatility, games_played, distinct_opponents, and
// last_match_at.
//
// The "opponent is new" check fires a single SELECT against
// match_rating with canonical (aKey, bKey) ordering. Cheap at beta
// scale; revisit with a per-player hash-set if it becomes hot.

import type { GameId } from '../../shared/ids';
import { hasOfficialQuickMatchBot } from '../../shared/player';
import { type Rating, updateRating } from '../../shared/rating/glicko2';
import type { GameState } from '../../shared/types/domain';
import { reportLifecycleEvent } from '../game-do/telemetry';
import type { RoomConfig } from '../protocol';
import { type PlayerRecord, selectPlayerByKey } from './player-store';

type Outcome = 0 | 0.5 | 1;

const isPairedRoom = (config: RoomConfig): boolean =>
  config.playerTokens[1] !== null;

const recordToRating = (p: PlayerRecord): Rating => ({
  rating: p.rating,
  rd: p.rd,
  volatility: p.volatility,
});

interface CanonicalPair {
  aKey: string;
  bKey: string;
  aPlayer: PlayerRecord;
  bPlayer: PlayerRecord;
  outcomeA: Outcome;
  winnerKey: string | null;
}

const canonicalise = (
  players: [PlayerRecord, PlayerRecord],
  winner: 0 | 1 | null,
): CanonicalPair => {
  const [p0, p1] = players;
  // Canonical order: lexicographically smaller key goes to "a".
  const swap = p1.playerKey < p0.playerKey;
  const aPlayer = swap ? p1 : p0;
  const bPlayer = swap ? p0 : p1;

  let outcomeA: Outcome;
  let winnerKey: string | null;
  if (winner === null) {
    outcomeA = 0.5;
    winnerKey = null;
  } else {
    const winnerIdx = winner;
    const winnerOrig = winnerIdx === 0 ? p0 : p1;
    winnerKey = winnerOrig.playerKey;
    outcomeA = winnerOrig.playerKey === aPlayer.playerKey ? 1 : 0;
  }

  return {
    aKey: aPlayer.playerKey,
    bKey: bPlayer.playerKey,
    aPlayer,
    bPlayer,
    outcomeA,
    winnerKey,
  };
};

const isNewOpponent = async (
  db: D1Database,
  aKey: string,
  bKey: string,
  thisGameId: string,
): Promise<boolean> => {
  const row = await db
    .prepare(
      'SELECT 1 FROM match_rating ' +
        'WHERE player_a_key = ? AND player_b_key = ? AND game_id != ? ' +
        'LIMIT 1',
    )
    .bind(aKey, bKey, thisGameId)
    .first<{ 1: number }>();
  return row === null;
};

export interface WriteMatchRatingOpts {
  db: D1Database;
  roomConfig: RoomConfig;
  gameId: GameId;
  outcomeWinner: 0 | 1 | null;
  now: number;
}

export interface AppliedRatingSummary {
  aKey: string;
  bKey: string;
  winnerKey: string | null;
  ratingBeforeA: number;
  ratingAfterA: number;
  ratingBeforeB: number;
  ratingAfterB: number;
  rdBeforeA: number;
  rdAfterA: number;
  rdBeforeB: number;
  rdAfterB: number;
  newOpponent: boolean;
  officialBotMatch: boolean;
}

export type WriteMatchRatingResult =
  | {
      ok: true;
      wrote: boolean;
      reason?: string;
      applied?: AppliedRatingSummary;
    }
  | { ok: false; error: string };

export const writeMatchRatingIfEligible = async (
  opts: WriteMatchRatingOpts,
): Promise<WriteMatchRatingResult> => {
  const { db, roomConfig, gameId, outcomeWinner, now } = opts;

  if (!isPairedRoom(roomConfig)) {
    return { ok: true, wrote: false, reason: 'not_matchmaker_paired' };
  }

  const [key0, key1] = [
    roomConfig.players[0].playerKey,
    roomConfig.players[1].playerKey,
  ];
  if (!key0 || !key1 || key0 === key1) {
    return { ok: true, wrote: false, reason: 'invalid_player_keys' };
  }

  const [p0, p1] = await Promise.all([
    selectPlayerByKey(db, key0),
    selectPlayerByKey(db, key1),
  ]);
  if (!p0 || !p1) {
    return { ok: true, wrote: false, reason: 'missing_player_rows' };
  }

  const pair = canonicalise([p0, p1], outcomeWinner);
  const newA = updateRating(
    recordToRating(pair.aPlayer),
    recordToRating(pair.bPlayer),
    pair.outcomeA,
  );
  const newOpponent = await isNewOpponent(db, pair.aKey, pair.bKey, gameId);
  const officialBotMatch = hasOfficialQuickMatchBot(roomConfig.players);

  // Four statements, all batched so either the whole rating update
  // lands or none does. INSERT OR IGNORE on match_rating keeps the
  // whole batch idempotent on game_id.
  const insertRating = db
    .prepare(
      'INSERT OR IGNORE INTO match_rating ' +
        '(game_id, player_a_key, player_b_key, winner_key, ' +
        'pre_rating_a, post_rating_a, pre_rating_b, post_rating_b, ' +
        'created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      gameId,
      pair.aKey,
      pair.bKey,
      pair.winnerKey,
      pair.aPlayer.rating,
      newA.a.rating,
      pair.bPlayer.rating,
      newA.b.rating,
      now,
    );

  const distinctBump = newOpponent ? 1 : 0;
  const updateA = db
    .prepare(
      'UPDATE player SET rating = ?, rd = ?, volatility = ?, ' +
        'games_played = games_played + 1, ' +
        'distinct_opponents = distinct_opponents + ?, ' +
        'last_match_at = ? WHERE player_key = ?',
    )
    .bind(
      newA.a.rating,
      newA.a.rd,
      newA.a.volatility,
      distinctBump,
      now,
      pair.aKey,
    );

  const updateB = db
    .prepare(
      'UPDATE player SET rating = ?, rd = ?, volatility = ?, ' +
        'games_played = games_played + 1, ' +
        'distinct_opponents = distinct_opponents + ?, ' +
        'last_match_at = ? WHERE player_key = ?',
    )
    .bind(
      newA.b.rating,
      newA.b.rd,
      newA.b.volatility,
      distinctBump,
      now,
      pair.bKey,
    );

  try {
    await db.batch([insertRating, updateA, updateB]);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'batch_failed',
    };
  }
  return {
    ok: true,
    wrote: true,
    applied: {
      aKey: pair.aKey,
      bKey: pair.bKey,
      winnerKey: pair.winnerKey,
      ratingBeforeA: pair.aPlayer.rating,
      ratingAfterA: newA.a.rating,
      ratingBeforeB: pair.bPlayer.rating,
      ratingAfterB: newA.b.rating,
      rdBeforeA: pair.aPlayer.rd,
      rdAfterA: newA.a.rd,
      rdBeforeB: pair.bPlayer.rd,
      rdAfterB: newA.b.rd,
      newOpponent,
      officialBotMatch,
    },
  };
};

// Scheduler helper that mirrors scheduleArchiveCompletedMatch — used
// inside the DO publication pipeline. Fire-and-forget via waitUntil;
// errors log to the D1 `events` table via reportLifecycleEvent so
// operators can see the conversion rate (applied / skipped / failed)
// in production without tailing logs.
export const scheduleMatchRatingUpdate = (
  deps: {
    db: D1Database | undefined;
    waitUntil: (p: Promise<unknown>) => void;
    getRoomConfig: () => Promise<RoomConfig | null>;
  },
  state: GameState,
): void => {
  if (!deps.db) return;

  deps.waitUntil(
    (async () => {
      const roomConfig = await deps.getRoomConfig();
      if (!roomConfig) return;
      const db = deps.db;
      if (!db) return;
      const winner = state.outcome?.winner ?? null;
      const result = await writeMatchRatingIfEligible({
        db,
        roomConfig,
        gameId: state.gameId,
        outcomeWinner: winner === 0 || winner === 1 ? winner : null,
        now: Date.now(),
      });
      const eventDeps = { db, waitUntil: deps.waitUntil };
      if (!result.ok) {
        reportLifecycleEvent(eventDeps, 'rating_failed', {
          gameId: state.gameId,
          error: result.error,
        });
        return;
      }
      if (!result.wrote) {
        reportLifecycleEvent(eventDeps, 'rating_skipped', {
          gameId: state.gameId,
          reason: result.reason ?? 'unknown',
        });
        return;
      }
      const a = result.applied;
      if (!a) return;
      reportLifecycleEvent(eventDeps, 'rating_applied', {
        gameId: state.gameId,
        scenario: state.scenario,
        aKey: a.aKey,
        bKey: a.bKey,
        winnerKey: a.winnerKey,
        ratingDeltaA:
          Math.round((a.ratingAfterA - a.ratingBeforeA) * 100) / 100,
        ratingDeltaB:
          Math.round((a.ratingAfterB - a.ratingBeforeB) * 100) / 100,
        rdAfterA: Math.round(a.rdAfterA),
        rdAfterB: Math.round(a.rdAfterB),
        newOpponent: a.newOpponent,
      });
    })(),
  );
};
