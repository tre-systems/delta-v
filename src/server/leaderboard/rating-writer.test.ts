import { describe, expect, it, vi } from 'vitest';

import type { GameId, PlayerToken, RoomCode } from '../../shared/ids';
import type { RoomConfig } from '../protocol';
import {
  scheduleMatchRatingUpdate,
  writeMatchRatingIfEligible,
} from './rating-writer';

// In-memory D1 mock covering the SELECT / INSERT OR IGNORE / UPDATE /
// batch shapes used by rating-writer + player-store.
const buildMockDb = (seedPlayers: Record<string, Record<string, unknown>>) => {
  const byKey = new Map<string, Record<string, unknown>>(
    Object.entries(seedPlayers),
  );
  const matchRatings = new Map<string, Record<string, unknown>>();

  const makeStatement = (sql: string, args: unknown[]) => {
    const lowered = sql.toLowerCase().trim();
    return {
      sql,
      args,
      first: async <T>(): Promise<T | null> => {
        if (lowered.startsWith('select 1 from match_rating')) {
          const [aKey, bKey, thisGameId] = args as [string, string, string];
          const hit = Array.from(matchRatings.values()).find(
            (r) =>
              r.player_a_key === aKey &&
              r.player_b_key === bKey &&
              r.game_id !== thisGameId,
          );
          return (hit ? ({ '1': 1 } as unknown as T) : null) as T | null;
        }
        if (lowered.startsWith('select')) {
          const key = args[0] as string;
          return (byKey.get(key) ?? null) as T | null;
        }
        throw new Error(`unexpected first() sql: ${sql}`);
      },
      run: async () => {
        if (lowered.startsWith('insert or ignore into match_rating')) {
          const [
            gameId,
            aKey,
            bKey,
            winnerKey,
            preA,
            postA,
            preB,
            postB,
            createdAt,
          ] = args as [
            string,
            string,
            string,
            string | null,
            number,
            number,
            number,
            number,
            number,
          ];
          if (!matchRatings.has(gameId)) {
            matchRatings.set(gameId, {
              game_id: gameId,
              player_a_key: aKey,
              player_b_key: bKey,
              winner_key: winnerKey,
              pre_rating_a: preA,
              post_rating_a: postA,
              pre_rating_b: preB,
              post_rating_b: postB,
              created_at: createdAt,
            });
          }
          return { success: true };
        }
        if (lowered.startsWith('update player')) {
          const [rating, rd, volatility, distinctBump, now, playerKey] =
            args as [number, number, number, number, number, string];
          const row = byKey.get(playerKey);
          if (row) {
            row.rating = rating;
            row.rd = rd;
            row.volatility = volatility;
            row.games_played = (row.games_played as number) + 1;
            row.distinct_opponents =
              (row.distinct_opponents as number) + distinctBump;
            row.last_match_at = now;
          }
          return { success: true };
        }
        throw new Error(`unexpected run() sql: ${sql}`);
      },
    };
  };

  const prepare = vi.fn((sql: string) => {
    return {
      bind: (...args: unknown[]) => makeStatement(sql, args),
    };
  });

  const batch = vi.fn(async (stmts: { run: () => Promise<unknown> }[]) => {
    for (const s of stmts) await s.run();
    return [];
  });

  return {
    db: { prepare, batch } as unknown as D1Database,
    byKey,
    matchRatings,
  };
};

const seedPlayer = (
  key: string,
  username: string,
  isAgent: boolean,
  rating = 1500,
  rd = 350,
) => ({
  player_key: key,
  username,
  is_agent: isAgent ? 1 : 0,
  rating,
  rd,
  volatility: 0.06,
  games_played: 0,
  distinct_opponents: 0,
  last_match_at: null,
  created_at: 0,
});

const makeRoom = (players: [string, string], paired: boolean): RoomConfig => ({
  code: 'ABCDE' as RoomCode,
  scenario: 'duel',
  playerTokens: [
    'token1' as PlayerToken,
    paired ? ('token2' as PlayerToken) : null,
  ],
  players: [
    { playerKey: players[0], username: players[0], kind: 'human' },
    { playerKey: players[1], username: players[1], kind: 'human' },
  ],
});

describe('writeMatchRatingIfEligible', () => {
  const now = 1_700_000_000_000;
  const gameId = 'game-1' as GameId;

  it('skips when the room was not matchmaker-paired (second token null)', async () => {
    const { db, matchRatings } = buildMockDb({});
    const result = await writeMatchRatingIfEligible({
      db,
      roomConfig: makeRoom(['human_aaa12345', 'human_bbb12345'], false),
      gameId,
      outcomeWinner: 0,
      now,
    });
    expect(result).toEqual({
      ok: true,
      wrote: false,
      reason: 'not_matchmaker_paired',
    });
    expect(matchRatings.size).toBe(0);
  });

  it('skips when either player lacks a player row', async () => {
    // Only one player has a row
    const { db, matchRatings } = buildMockDb({
      human_aaa12345: seedPlayer('human_aaa12345', 'A', false),
    });
    const result = await writeMatchRatingIfEligible({
      db,
      roomConfig: makeRoom(['human_aaa12345', 'human_bbb12345'], true),
      gameId,
      outcomeWinner: 0,
      now,
    });
    expect(result).toEqual({
      ok: true,
      wrote: false,
      reason: 'missing_player_rows',
    });
    expect(matchRatings.size).toBe(0);
  });

  it('writes match_rating and updates both players on a paired game_over', async () => {
    const { db, byKey, matchRatings } = buildMockDb({
      human_aaa12345: seedPlayer('human_aaa12345', 'A', false),
      human_bbb12345: seedPlayer('human_bbb12345', 'B', false),
    });
    const result = await writeMatchRatingIfEligible({
      db,
      roomConfig: makeRoom(['human_aaa12345', 'human_bbb12345'], true),
      gameId,
      outcomeWinner: 0, // player 0 = human_aaa12345
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wrote).toBe(true);

    // One match_rating row written, canonical a-then-b ordering.
    expect(matchRatings.size).toBe(1);
    const row = matchRatings.get(gameId);
    expect(row?.player_a_key).toBe('human_aaa12345');
    expect(row?.player_b_key).toBe('human_bbb12345');
    expect(row?.winner_key).toBe('human_aaa12345');

    // Winner's rating rose; loser's fell.
    const winner = byKey.get('human_aaa12345');
    const loser = byKey.get('human_bbb12345');
    expect((winner?.rating as number) > 1500).toBe(true);
    expect((loser?.rating as number) < 1500).toBe(true);
    expect(winner?.games_played).toBe(1);
    expect(loser?.games_played).toBe(1);
    // First meeting → distinct_opponents bumps to 1 on both sides.
    expect(winner?.distinct_opponents).toBe(1);
    expect(loser?.distinct_opponents).toBe(1);

    // Observability layer needs enough detail to emit a rating_applied
    // event without a follow-up DB read.
    expect(result.applied).toBeDefined();
    expect(result.applied?.aKey).toBe('human_aaa12345');
    expect(result.applied?.winnerKey).toBe('human_aaa12345');
    expect(result.applied?.newOpponent).toBe(true);
    expect(result.applied?.ratingBeforeA).toBe(1500);
    expect(result.applied?.ratingAfterA).toBeGreaterThan(1500);
  });

  it('does not bump distinct_opponents on a rematch', async () => {
    const { db, byKey, matchRatings } = buildMockDb({
      human_aaa12345: seedPlayer('human_aaa12345', 'A', false),
      human_bbb12345: seedPlayer('human_bbb12345', 'B', false),
    });
    // Pre-seed a match_rating row representing a prior encounter.
    matchRatings.set('prior-game', {
      game_id: 'prior-game',
      player_a_key: 'human_aaa12345',
      player_b_key: 'human_bbb12345',
    });

    await writeMatchRatingIfEligible({
      db,
      roomConfig: makeRoom(['human_aaa12345', 'human_bbb12345'], true),
      gameId,
      outcomeWinner: 1,
      now,
    });

    const a = byKey.get('human_aaa12345');
    const b = byKey.get('human_bbb12345');
    expect(a?.games_played).toBe(1);
    expect(b?.games_played).toBe(1);
    expect(a?.distinct_opponents).toBe(0);
    expect(b?.distinct_opponents).toBe(0);
  });

  it('handles a draw (winner=null) by treating it as 0.5/0.5', async () => {
    const { db, byKey, matchRatings } = buildMockDb({
      human_aaa12345: seedPlayer('human_aaa12345', 'A', false),
      human_bbb12345: seedPlayer('human_bbb12345', 'B', false),
    });
    await writeMatchRatingIfEligible({
      db,
      roomConfig: makeRoom(['human_aaa12345', 'human_bbb12345'], true),
      gameId,
      outcomeWinner: null,
      now,
    });
    const row = matchRatings.get(gameId);
    expect(row?.winner_key).toBeNull();
    // In an equal-rating draw both players should barely move.
    const a = byKey.get('human_aaa12345');
    const b = byKey.get('human_bbb12345');
    expect(Math.abs((a?.rating as number) - 1500)).toBeLessThan(1);
    expect(Math.abs((b?.rating as number) - 1500)).toBeLessThan(1);
  });

  it('skips when the two player keys are identical', async () => {
    const { db, matchRatings } = buildMockDb({
      human_same12345: seedPlayer('human_same12345', 'Same', false),
    });
    const result = await writeMatchRatingIfEligible({
      db,
      roomConfig: makeRoom(['human_same12345', 'human_same12345'], true),
      gameId,
      outcomeWinner: 0,
      now,
    });
    expect(result).toEqual({
      ok: true,
      wrote: false,
      reason: 'invalid_player_keys',
    });
    expect(matchRatings.size).toBe(0);
  });

  it('canonicalises (a, b) ordering by lexicographic key', async () => {
    const { db, matchRatings } = buildMockDb({
      human_zzz12345: seedPlayer('human_zzz12345', 'Z', false),
      human_aaa12345: seedPlayer('human_aaa12345', 'A', false),
    });
    // Players are in [zzz, aaa] order on the room but a < z so the
    // row should store aaa as player_a.
    await writeMatchRatingIfEligible({
      db,
      roomConfig: makeRoom(['human_zzz12345', 'human_aaa12345'], true),
      gameId,
      outcomeWinner: 0, // player 0 (zzz) wins
      now,
    });
    const row = matchRatings.get(gameId);
    expect(row?.player_a_key).toBe('human_aaa12345');
    expect(row?.player_b_key).toBe('human_zzz12345');
    expect(row?.winner_key).toBe('human_zzz12345');
  });
});

describe('scheduleMatchRatingUpdate', () => {
  const buildState = (winner: 0 | 1 | null = 0) =>
    ({
      gameId: 'game-x' as GameId,
      outcome: winner === null ? null : { winner, reason: 'Fleet eliminated' },
    }) as unknown as import('../../shared/types/domain').GameState;

  it('is a no-op when db is undefined', () => {
    const waitUntil = vi.fn();
    scheduleMatchRatingUpdate(
      {
        db: undefined,
        waitUntil,
        getRoomConfig: async () => null,
      },
      buildState(0),
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('schedules a task that bails when room config is null', async () => {
    const { db } = buildMockDb({});
    let scheduled: Promise<unknown> | null = null;
    const waitUntil = vi.fn((p: Promise<unknown>) => {
      scheduled = p;
    });
    scheduleMatchRatingUpdate(
      {
        db,
        waitUntil,
        getRoomConfig: async () => null,
      },
      buildState(0),
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await scheduled; // resolves without throwing
  });

  it('routes the task into writeMatchRatingIfEligible on success', async () => {
    const { db, matchRatings } = buildMockDb({
      human_aaa12345: seedPlayer('human_aaa12345', 'A', false),
      human_bbb12345: seedPlayer('human_bbb12345', 'B', false),
    });
    let scheduled: Promise<unknown> | null = null;
    const waitUntil = vi.fn((p: Promise<unknown>) => {
      scheduled = p;
    });
    scheduleMatchRatingUpdate(
      {
        db,
        waitUntil,
        getRoomConfig: async () =>
          makeRoom(['human_aaa12345', 'human_bbb12345'], true),
      },
      buildState(0),
    );
    await scheduled;
    expect(matchRatings.size).toBe(1);
  });
});
