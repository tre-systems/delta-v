import { DurableObject } from 'cloudflare:workers';
import type { PlayerToken, RoomCode } from '../shared/ids';
import {
  QUICK_MATCH_SCENARIO,
  type QuickMatchResponse,
} from '../shared/matchmaking';
import {
  buildDefaultUsername,
  normalizePlayerKey,
  normalizeUsername,
  type PublicPlayerProfile,
} from '../shared/player';
import { claimPlayerName } from './leaderboard/player-store';
import { generatePlayerToken, generateRoomCode } from './protocol';

type QueueStatus = 'queued' | 'matched';

interface QueueEntry {
  ticket: string;
  scenario: string;
  player: PublicPlayerProfile;
  queuedAt: number;
  lastSeenAt: number;
  status: QueueStatus;
  matched?: Extract<QuickMatchResponse, { status: 'matched' }>;
}

interface Env {
  GAME: DurableObjectNamespace;
  // Optional at the type level so tests with minimal env stubs continue to
  // work. At runtime the worker always has DB bound; structured events are
  // skipped silently when it isn't available.
  DB?: D1Database;
}

const participantKindForKey = (playerKey: string): 'human' | 'agent' =>
  playerKey.startsWith('agent_') ? 'agent' : 'human';

// Tiny structured logger for matchmaker events. Mirrors the pattern used by
// GameDO's `reportLifecycleEvent` / `reportSideChannelFailure` but inlined
// because MatchmakerDO doesn't import from game-do's layer.
const reportMatchmakerEvent = (
  ctx: DurableObjectState,
  env: Env,
  event: 'matchmaker_paired' | 'matchmaker_pairing_split',
  props: Record<string, unknown>,
): void => {
  // matchmaker_paired is a normal signal; split is a warning-class event.
  if (event === 'matchmaker_pairing_split') {
    console.error(`[${event}]`, props);
  } else {
    console.log(`[${event}]`, props);
  }

  const db = env.DB;
  if (!db) return;
  ctx.waitUntil(
    db
      .prepare(
        'INSERT INTO events ' +
          '(ts, anon_id, event, props, ip_hash, ua) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(Date.now(), null, event, JSON.stringify(props), 'server', null)
      .run()
      .catch((e: unknown) => console.error(`[D1 ${event} insert failed]`, e)),
  );
};

const MATCHMAKER_STORAGE_KEY = 'quickMatchQueue';
const HEARTBEAT_TTL_MS = 15_000;
const MATCH_RESULT_TTL_MS = 60_000;
// Hard cap on the number of active queue entries. The legacy KV-backed
// MatchmakerDO serialises the entire queue under a single 128 KB value,
// so an unbounded enqueue path is a denial-of-service vector: an
// attacker fanning out from distinct playerKeys can inflate the queue
// until `storage.put` throws and every honest quick-match breaks. 200
// keeps typical-case latency small while leaving plenty of headroom
// above the expected concurrent-matchmaking population.
const MAX_ACTIVE_QUEUE_ENTRIES = 200;

const isActiveQueueEntry = (entry: QueueEntry, now: number): boolean =>
  entry.status === 'queued' && now - entry.lastSeenAt <= HEARTBEAT_TTL_MS;

const isRetainableMatchedEntry = (entry: QueueEntry, now: number): boolean =>
  entry.status === 'matched' &&
  entry.matched !== undefined &&
  now - entry.lastSeenAt <= MATCH_RESULT_TTL_MS;

const normalizeQuickMatchRequest = (
  raw: unknown,
): { scenario: string; player: PublicPlayerProfile } | null => {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    !('player' in raw) ||
    raw.player === null ||
    typeof raw.player !== 'object'
  ) {
    return null;
  }

  const playerRaw = raw.player as {
    playerKey?: unknown;
    username?: unknown;
  };
  const playerKey = normalizePlayerKey(playerRaw.playerKey);

  if (!playerKey) {
    return null;
  }

  return {
    scenario:
      typeof (raw as { scenario?: unknown }).scenario === 'string'
        ? ((raw as { scenario?: string }).scenario ?? QUICK_MATCH_SCENARIO)
        : QUICK_MATCH_SCENARIO,
    player: {
      playerKey,
      username:
        normalizeUsername(playerRaw.username) ??
        buildDefaultUsername(playerKey),
    },
  };
};

const ticketFromEntropy = (): string =>
  generatePlayerToken().replace(/_/g, 'A').replace(/-/g, 'B');

export class MatchmakerDO extends DurableObject<Env> {
  private get storage(): DurableObjectStorage {
    return this.ctx.storage;
  }

  private async readQueue(): Promise<QueueEntry[]> {
    return (await this.storage.get<QueueEntry[]>(MATCHMAKER_STORAGE_KEY)) ?? [];
  }

  private async writeQueue(entries: QueueEntry[]): Promise<void> {
    await this.storage.put(MATCHMAKER_STORAGE_KEY, entries);
  }

  private pruneQueue(entries: QueueEntry[], now: number): QueueEntry[] {
    return entries.filter(
      (entry) =>
        isActiveQueueEntry(entry, now) || isRetainableMatchedEntry(entry, now),
    );
  }

  private async allocateQuickMatchRoom(
    players: [PublicPlayerProfile, PublicPlayerProfile],
  ): Promise<{
    code: RoomCode;
    playerTokens: [PlayerToken, PlayerToken];
  } | null> {
    let conflicts = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateRoomCode();
      const playerTokens = [
        generatePlayerToken(),
        generatePlayerToken(),
      ] as const;
      const stub = this.env.GAME.get(this.env.GAME.idFromName(code));
      const response = await stub.fetch(
        new Request('https://room.internal/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code,
            scenario: QUICK_MATCH_SCENARIO,
            playerToken: playerTokens[0],
            guestPlayerToken: playerTokens[1],
            players: [
              {
                ...players[0],
                kind: participantKindForKey(players[0].playerKey),
              },
              {
                ...players[1],
                kind: participantKindForKey(players[1].playerKey),
              },
            ],
          }),
        }),
      );

      if (response.ok) {
        // Signal split recovery so the rate is visible in production D1.
        // A `conflicts` > 0 means the first room code collided, forcing us
        // to retry. Operators can query `event = 'matchmaker_pairing_split'`
        // to decide whether to invest in coalesced pairing.
        if (conflicts > 0) {
          reportMatchmakerEvent(
            this.ctx,
            this.env,
            'matchmaker_pairing_split',
            {
              code,
              conflicts,
              reason: 'room_code_collision',
            },
          );
        }
        return {
          code,
          playerTokens: [playerTokens[0], playerTokens[1]],
        };
      }

      if (response.status !== 409) {
        reportMatchmakerEvent(this.ctx, this.env, 'matchmaker_pairing_split', {
          code,
          reason: 'allocation_failed',
          status: response.status,
        });
        return null;
      }

      conflicts++;
    }

    reportMatchmakerEvent(this.ctx, this.env, 'matchmaker_pairing_split', {
      reason: 'max_retries_exceeded',
      attempts: 12,
    });
    return null;
  }

  private buildMatchedResponse(
    ticket: string,
    scenario: string,
    code: RoomCode,
    playerToken: PlayerToken,
  ): Extract<QuickMatchResponse, { status: 'matched' }> {
    return {
      status: 'matched',
      ticket,
      scenario,
      code,
      playerToken,
    };
  }

  private async ensureLeaderboardProfile(
    player: PublicPlayerProfile,
  ): Promise<void> {
    const db = this.env.DB;
    if (!db) return;

    const usernameCandidates = Array.from(
      new Set([
        normalizeUsername(player.username) ??
          buildDefaultUsername(player.playerKey),
        buildDefaultUsername(player.playerKey),
      ]),
    );
    for (const username of usernameCandidates) {
      try {
        const outcome = await claimPlayerName({
          db,
          playerKey: player.playerKey,
          username,
          isAgent: participantKindForKey(player.playerKey) === 'agent',
          now: Date.now(),
        });
        if (outcome.ok) {
          return;
        }
      } catch (error) {
        console.error('[matchmaker_claim_failed]', {
          playerKey: player.playerKey,
          username,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    console.warn('[matchmaker_claim_skipped_name_taken]', {
      playerKey: player.playerKey,
      username: player.username,
    });
  }

  private async matchEntries(
    entries: QueueEntry[],
    leftIndex: number,
    rightIndex: number,
  ): Promise<QueueEntry[] | null> {
    const left = entries[leftIndex];
    const right = entries[rightIndex];

    if (!left || !right) {
      return null;
    }

    const room = await this.allocateQuickMatchRoom([left.player, right.player]);

    if (!room) {
      return null;
    }

    const now = Date.now();
    entries[leftIndex] = {
      ...left,
      status: 'matched',
      lastSeenAt: now,
      matched: this.buildMatchedResponse(
        left.ticket,
        left.scenario,
        room.code,
        room.playerTokens[0],
      ),
    };

    entries[rightIndex] = {
      ...right,
      status: 'matched',
      lastSeenAt: now,
      matched: this.buildMatchedResponse(
        right.ticket,
        right.scenario,
        room.code,
        room.playerTokens[1],
      ),
    };

    reportMatchmakerEvent(this.ctx, this.env, 'matchmaker_paired', {
      code: room.code,
      scenario: right.scenario,
      leftKey: left.player.playerKey,
      rightKey: right.player.playerKey,
      waitMsLeft: now - left.queuedAt,
      waitMsRight: now - right.queuedAt,
    });

    this.ctx.waitUntil(
      Promise.all([
        this.ensureLeaderboardProfile(left.player),
        this.ensureLeaderboardProfile(right.player),
      ]),
    );

    return entries;
  }

  private async handleEnqueue(request: Request): Promise<Response> {
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid quick match payload', { status: 400 });
    }

    const parsed = normalizeQuickMatchRequest(payload);

    if (!parsed) {
      return new Response('Invalid quick match payload', { status: 400 });
    }

    const now = Date.now();
    let entries = this.pruneQueue(await this.readQueue(), now);
    const existingIndex = entries.findIndex(
      (entry) =>
        entry.player.playerKey === parsed.player.playerKey &&
        entry.scenario === QUICK_MATCH_SCENARIO,
    );

    if (existingIndex >= 0) {
      const existing = entries[existingIndex];
      entries[existingIndex] = {
        ...existing,
        player: parsed.player,
        lastSeenAt: now,
      };
      await this.writeQueue(entries);
      return Response.json(
        existing.matched ?? {
          status: 'queued',
          ticket: existing.ticket,
          scenario: QUICK_MATCH_SCENARIO,
        },
      );
    }

    const humanMatchIndex = entries.findIndex(
      (entry) =>
        isActiveQueueEntry(entry, now) &&
        entry.player.playerKey !== parsed.player.playerKey &&
        entry.scenario === QUICK_MATCH_SCENARIO,
    );

    // Reject new enqueues once storage is saturated. The cap counts
    // every retained entry (active queued + recently matched retained
    // for MATCH_RESULT_TTL_MS) because storage.put serialises the whole
    // array under one key and throws once the value exceeds the legacy
    // KV 128 KB ceiling. Only new rows pay this cost — in-place updates
    // for the same playerKey stay cheap, which is why the cap lives
    // after the existing-index branch.
    if (entries.length >= MAX_ACTIVE_QUEUE_ENTRIES) {
      return new Response('Quick match queue is saturated', {
        status: 503,
        headers: { 'Retry-After': '30' },
      });
    }

    const ticket = ticketFromEntropy();
    entries.push({
      ticket,
      scenario: QUICK_MATCH_SCENARIO,
      player: parsed.player,
      queuedAt: now,
      lastSeenAt: now,
      status: 'queued',
    });

    if (humanMatchIndex >= 0) {
      const matchedEntries = await this.matchEntries(
        entries,
        entries.length - 1,
        humanMatchIndex,
      );

      if (!matchedEntries) {
        return new Response('Failed to allocate quick match', { status: 503 });
      }

      entries = matchedEntries;
    }

    await this.writeQueue(entries);
    const current = entries.at(-1);

    if (!current) {
      return new Response('Failed to allocate quick match', { status: 503 });
    }

    return Response.json(
      current.matched ?? {
        status: 'queued',
        ticket: current.ticket,
        scenario: QUICK_MATCH_SCENARIO,
      },
    );
  }

  private async handleStatus(ticket: string): Promise<Response> {
    const now = Date.now();
    const entries = this.pruneQueue(await this.readQueue(), now);
    const index = entries.findIndex((entry) => entry.ticket === ticket);

    if (index < 0) {
      await this.writeQueue(entries);
      return Response.json(
        {
          status: 'expired',
          ticket,
          scenario: QUICK_MATCH_SCENARIO,
          reason: 'Queue expired',
        } satisfies Extract<QuickMatchResponse, { status: 'expired' }>,
        { status: 410 },
      );
    }

    const current = entries[index];

    if (current.status === 'matched' && current.matched) {
      entries[index] = {
        ...current,
        lastSeenAt: now,
      };
      await this.writeQueue(entries);
      return Response.json(entries[index].matched);
    }

    entries[index] = {
      ...current,
      lastSeenAt: now,
    };

    // Intentionally disabled for now: quick match should wait for another
    // real queued player rather than silently filling with a heuristic bot.
    // Previous behavior:
    // if (now - current.queuedAt >= 10_000) {
    //   const matchedEntries = await this.matchEntries(
    //     entries,
    //     index,
    //     index,
    //     buildBotProfile(ticket),
    //   );
    //
    //   if (!matchedEntries) {
    //     return new Response('Failed to allocate quick match', {
    //       status: 503,
    //     });
    //   }
    //
    //   entries = matchedEntries;
    // }

    await this.writeQueue(entries);

    return Response.json(
      entries[index]?.matched ?? {
        status: 'queued',
        ticket,
        scenario: QUICK_MATCH_SCENARIO,
      },
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/enqueue' && request.method === 'POST') {
      return this.handleEnqueue(request);
    }

    const ticketMatch = url.pathname.match(/^\/ticket\/([A-Za-z0-9]+)$/);

    if (ticketMatch && request.method === 'GET') {
      return this.handleStatus(ticketMatch[1]);
    }

    return new Response('Not found', { status: 404 });
  }
}
