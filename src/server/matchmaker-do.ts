import { DurableObject } from 'cloudflare:workers';
import type { PlayerToken, RoomCode } from '../shared/ids';
import { isValidScenario } from '../shared/map-data';
import {
  OFFICIAL_QUICK_MATCH_BOT_WAIT_MS,
  QUICK_MATCH_SCENARIO,
  type QuickMatchQueuedResponse,
  type QuickMatchResponse,
} from '../shared/matchmaking';
import {
  buildDefaultUsername,
  buildOfficialQuickMatchBotProfile,
  hasOfficialQuickMatchBot,
  isOfficialQuickMatchBotPlayerKey,
  normalizePlayerKey,
  normalizeUsername,
  type PublicPlayerProfile,
} from '../shared/player';
import { claimPlayerName } from './leaderboard/player-store';
import { generatePlayerToken, generateRoomCode } from './protocol';
import { QUICK_MATCH_VERIFIED_AGENT_HEADER } from './quick-match-internal';

type QueueStatus = 'queued' | 'matched';

interface QueueEntry {
  ticket: string;
  scenario: string;
  rendezvousCode: string | null;
  player: PublicPlayerProfile;
  /** Set on enqueue when the Worker verified an agent Bearer for this playerKey. */
  leaderboardAgentVerified?: boolean;
  queuedAt: number;
  lastSeenAt: number;
  officialBotDeclinedAt?: number;
  status: QueueStatus;
  matched?: Extract<QuickMatchResponse, { status: 'matched' }>;
}

interface Env {
  GAME: DurableObjectNamespace;
  LIVE_REGISTRY?: DurableObjectNamespace;
  // Optional at the type level so tests with minimal env stubs continue to
  // work. At runtime the worker always has DB bound; structured events are
  // skipped silently when it isn't available.
  DB?: D1Database;
  /** When `'1'`, lone quick-match tickets can pair with a dev-only bot after a wait (see `DEV_QUICK_MATCH_BOT_FILL_WAIT_MS`). */
  DEV_MODE?: string;
  /** Set to `'0'` to disable the production Official Bot quick-match fallback. */
  OFFICIAL_QUICK_MATCH_BOT_ENABLED?: string;
}

const participantKindForKey = (playerKey: string): 'human' | 'agent' =>
  playerKey.startsWith('agent_') ? 'agent' : 'human';

// Tiny structured logger for matchmaker events. Mirrors the pattern used by
// GameDO's `reportLifecycleEvent` / `reportSideChannelFailure` but inlined
// because MatchmakerDO doesn't import from game-do's layer.
const reportMatchmakerEvent = (
  ctx: DurableObjectState,
  env: Env,
  event:
    | 'matchmaker_paired'
    | 'matchmaker_pairing_split'
    | 'matchmaker_official_bot_filled'
    | 'matchmaker_official_bot_declined',
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

const isOfficialQuickMatchBotEnabled = (env: Env): boolean =>
  env.OFFICIAL_QUICK_MATCH_BOT_ENABLED !== '0';

const buildQueuedResponse = (
  entry: Pick<QueueEntry, 'ticket' | 'scenario' | 'queuedAt'>,
  now: number,
  env: Env,
): QuickMatchQueuedResponse => {
  const waitedMs = now - entry.queuedAt;
  const offerEnabled = isOfficialQuickMatchBotEnabled(env);
  return {
    status: 'queued',
    ticket: entry.ticket,
    scenario: entry.scenario,
    officialBotOfferAvailable:
      offerEnabled && waitedMs >= OFFICIAL_QUICK_MATCH_BOT_WAIT_MS,
    officialBotWaitMsRemaining: offerEnabled
      ? Math.max(OFFICIAL_QUICK_MATCH_BOT_WAIT_MS - waitedMs, 0)
      : null,
  };
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

/** After this wait, `DEV_MODE=1` may append a synthetic opponent for solo quick-match testing. */
const DEV_QUICK_MATCH_BOT_FILL_WAIT_MS = 10_000;

const isActiveQueueEntry = (entry: QueueEntry, now: number): boolean =>
  entry.status === 'queued' && now - entry.lastSeenAt <= HEARTBEAT_TTL_MS;

const isRetainableMatchedEntry = (entry: QueueEntry, now: number): boolean =>
  entry.status === 'matched' &&
  entry.matched !== undefined &&
  now - entry.lastSeenAt <= MATCH_RESULT_TTL_MS;

const normalizeRendezvousCode = (raw: unknown): string | null | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,16}$/.test(normalized)) {
    return null;
  }
  return normalized;
};

const normalizeQuickMatchRequest = (
  raw: unknown,
): {
  scenario: string;
  rendezvousCode: string | null;
  acceptOfficialBotMatch: boolean;
  declineOfficialBotMatch: boolean;
  player: PublicPlayerProfile;
} | null => {
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
  const rendezvousCode = normalizeRendezvousCode(
    (raw as { rendezvousCode?: unknown }).rendezvousCode,
  );

  if (!playerKey || rendezvousCode === null) {
    return null;
  }

  const requestedScenarioRaw = (raw as { scenario?: unknown }).scenario;
  // Validate against the canonical scenario registry. Unknown keys
  // (typos, stale clients) fall back to the quick-match default rather
  // than propagating into game creation, where they would have silently
  // collapsed to `biplanetary` inside normalizeScenarioKey.
  const scenario =
    typeof requestedScenarioRaw === 'string' &&
    isValidScenario(requestedScenarioRaw)
      ? requestedScenarioRaw
      : QUICK_MATCH_SCENARIO;

  return {
    scenario,
    rendezvousCode: rendezvousCode ?? null,
    acceptOfficialBotMatch:
      (raw as { acceptOfficialBotMatch?: unknown }).acceptOfficialBotMatch ===
      true,
    declineOfficialBotMatch:
      (raw as { declineOfficialBotMatch?: unknown }).declineOfficialBotMatch ===
      true,
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

const invalidQuickMatchPayload = (): Response =>
  Response.json(
    {
      ok: false,
      error: 'invalid_payload',
      message: 'Invalid quick-match payload.',
      hint: 'Send { player: { playerKey, username? }, scenario? } as JSON.',
    },
    { status: 400 },
  );

const playerAlreadyActiveResponse = (
  playerKey: string,
  active: { code: string; scenario: string } | null,
): Response =>
  Response.json(
    {
      ok: false,
      error: 'player_already_active',
      message: `Player ${playerKey} is already in an active match.`,
      ...(active
        ? {
            hint: `Reconnect to room ${active.code} (${active.scenario}) before queueing again.`,
          }
        : {}),
    },
    { status: 409 },
  );

/** Synthetic opponent profile for dev-only quick-match bot fill (`DEV_MODE=1`). */
const buildBotProfile = (humanTicket: string): PublicPlayerProfile => ({
  playerKey: `agent_devqm_${humanTicket}`,
  username: 'QM Bot',
});

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
    scenario: string,
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
            scenario,
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
    leaderboardAgentVerified: boolean,
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
          isAgent:
            participantKindForKey(player.playerKey) === 'agent' &&
            (leaderboardAgentVerified ||
              isOfficialQuickMatchBotPlayerKey(player.playerKey)),
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

  private async findActiveMatchForPlayer(
    playerKey: string,
  ): Promise<{ code: string; scenario: string } | null> {
    if (isOfficialQuickMatchBotPlayerKey(playerKey)) {
      return null;
    }

    const reg = this.env.LIVE_REGISTRY;
    if (!reg) {
      return null;
    }

    try {
      const response = await reg
        .get(reg.idFromName('global'))
        .fetch(
          new Request(
            `https://live-registry.internal/active-player/${encodeURIComponent(playerKey)}`,
            { method: 'GET' },
          ),
        );
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as
        | { active: false }
        | { active: true; code: string; scenario: string };
      return payload.active
        ? { code: payload.code, scenario: payload.scenario }
        : null;
    } catch (error) {
      console.error('[matchmaker_live_registry_lookup_failed]', {
        playerKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
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

    const [leftActive, rightActive] = await Promise.all([
      this.findActiveMatchForPlayer(left.player.playerKey),
      this.findActiveMatchForPlayer(right.player.playerKey),
    ]);
    if (leftActive || rightActive) {
      return entries.filter(
        (_entry, index) =>
          !(
            (leftActive && index === leftIndex) ||
            (rightActive && index === rightIndex)
          ),
      );
    }

    const seatZeroUsesLeft = Math.random() < 0.5;
    const seatZeroPlayer = seatZeroUsesLeft ? left.player : right.player;
    const seatOnePlayer = seatZeroUsesLeft ? right.player : left.player;

    // Both entries are matched on scenario before reaching matchEntries,
    // so left.scenario and right.scenario agree — pick either.
    const room = await this.allocateQuickMatchRoom(left.scenario, [
      seatZeroPlayer,
      seatOnePlayer,
    ]);

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
        seatZeroUsesLeft ? room.playerTokens[0] : room.playerTokens[1],
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
        seatZeroUsesLeft ? room.playerTokens[1] : room.playerTokens[0],
      ),
    };

    reportMatchmakerEvent(this.ctx, this.env, 'matchmaker_paired', {
      code: room.code,
      scenario: right.scenario,
      leftKey: left.player.playerKey,
      rightKey: right.player.playerKey,
      seat0Key: seatZeroPlayer.playerKey,
      seat1Key: seatOnePlayer.playerKey,
      waitMsLeft: now - left.queuedAt,
      waitMsRight: now - right.queuedAt,
      officialBotMatch: hasOfficialQuickMatchBot([left.player, right.player]),
    });

    this.ctx.waitUntil(
      Promise.all([
        this.ensureLeaderboardProfile(
          left.player,
          left.leaderboardAgentVerified ?? false,
        ),
        this.ensureLeaderboardProfile(
          right.player,
          right.leaderboardAgentVerified ?? false,
        ),
      ]),
    );

    return entries;
  }

  private async fillQueuedEntryWithBot(
    entries: QueueEntry[],
    humanIndex: number,
    botProfile: PublicPlayerProfile,
    now: number,
  ): Promise<QueueEntry[] | null> {
    const human = entries[humanIndex];

    if (
      !human ||
      human.status !== 'queued' ||
      entries.length >= MAX_ACTIVE_QUEUE_ENTRIES
    ) {
      return null;
    }

    const working = [...entries];
    working.push({
      ticket: `bot_${human.ticket}`,
      scenario: human.scenario,
      rendezvousCode: human.rendezvousCode,
      player: botProfile,
      queuedAt: now,
      lastSeenAt: now,
      status: 'queued',
    });

    return this.matchEntries(working, humanIndex, working.length - 1);
  }

  private async handleEnqueue(request: Request): Promise<Response> {
    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return invalidQuickMatchPayload();
    }

    const parsed = normalizeQuickMatchRequest(payload);

    if (!parsed) {
      return invalidQuickMatchPayload();
    }

    const leaderboardAgentVerified =
      request.headers.get(QUICK_MATCH_VERIFIED_AGENT_HEADER) === '1';

    const existingActiveMatch = await this.findActiveMatchForPlayer(
      parsed.player.playerKey,
    );
    if (existingActiveMatch) {
      return playerAlreadyActiveResponse(
        parsed.player.playerKey,
        existingActiveMatch,
      );
    }

    const now = Date.now();
    let entries = this.pruneQueue(await this.readQueue(), now);
    const existingIndex = entries.findIndex(
      (entry) =>
        entry.player.playerKey === parsed.player.playerKey &&
        entry.scenario === parsed.scenario &&
        entry.rendezvousCode === parsed.rendezvousCode,
    );

    if (existingIndex >= 0) {
      const existing = entries[existingIndex];
      entries[existingIndex] = {
        ...existing,
        player: parsed.player,
        leaderboardAgentVerified,
        lastSeenAt: now,
      };

      if (
        existing.status === 'queued' &&
        parsed.declineOfficialBotMatch &&
        !parsed.acceptOfficialBotMatch &&
        isOfficialQuickMatchBotEnabled(this.env) &&
        now - existing.queuedAt >= OFFICIAL_QUICK_MATCH_BOT_WAIT_MS &&
        existing.officialBotDeclinedAt == null
      ) {
        const refreshedExisting = entries[existingIndex] ?? existing;
        entries[existingIndex] = {
          ...refreshedExisting,
          officialBotDeclinedAt: now,
        };
        reportMatchmakerEvent(
          this.ctx,
          this.env,
          'matchmaker_official_bot_declined',
          {
            ticket: existing.ticket,
            scenario: existing.scenario,
            playerKey: existing.player.playerKey,
            waitedMs: now - existing.queuedAt,
          },
        );
      }

      if (
        existing.status === 'queued' &&
        parsed.acceptOfficialBotMatch &&
        isOfficialQuickMatchBotEnabled(this.env) &&
        now - existing.queuedAt >= OFFICIAL_QUICK_MATCH_BOT_WAIT_MS
      ) {
        const matchedEntries = await this.fillQueuedEntryWithBot(
          entries,
          existingIndex,
          buildOfficialQuickMatchBotProfile(),
          now,
        );

        if (!matchedEntries) {
          return new Response('Failed to allocate quick match', {
            status: 503,
          });
        }

        entries = matchedEntries;
        reportMatchmakerEvent(
          this.ctx,
          this.env,
          'matchmaker_official_bot_filled',
          {
            ticket: existing.ticket,
            scenario: existing.scenario,
            playerKey: existing.player.playerKey,
            waitedMs: now - existing.queuedAt,
          },
        );
      }

      await this.writeQueue(entries);
      return Response.json(
        entries[existingIndex]?.matched ??
          buildQueuedResponse(
            {
              ticket: entries[existingIndex]?.ticket ?? existing.ticket,
              scenario: entries[existingIndex]?.scenario ?? existing.scenario,
              queuedAt: entries[existingIndex]?.queuedAt ?? existing.queuedAt,
            },
            now,
            this.env,
          ),
      );
    }

    const humanMatchIndex = entries.findIndex(
      (entry) =>
        isActiveQueueEntry(entry, now) &&
        entry.player.playerKey !== parsed.player.playerKey &&
        entry.scenario === parsed.scenario &&
        entry.rendezvousCode === parsed.rendezvousCode,
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
      scenario: parsed.scenario,
      rendezvousCode: parsed.rendezvousCode,
      player: parsed.player,
      leaderboardAgentVerified,
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
      current.matched ?? buildQueuedResponse(current, now, this.env),
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
          // No matching ticket in the queue — we don't know the requested
          // scenario any more, so fall back to the canonical default.
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

    if (
      current.status === 'queued' &&
      this.env.DEV_MODE === '1' &&
      now - current.queuedAt >= DEV_QUICK_MATCH_BOT_FILL_WAIT_MS &&
      entries.length < MAX_ACTIVE_QUEUE_ENTRIES
    ) {
      const botTicket = `devqm_${ticket}`;
      if (!entries.some((e) => e.ticket === botTicket)) {
        const botEntry: QueueEntry = {
          ticket: botTicket,
          scenario: current.scenario,
          rendezvousCode: current.rendezvousCode,
          player: buildBotProfile(ticket),
          queuedAt: now,
          lastSeenAt: now,
          status: 'queued',
        };
        const working = [...entries];
        working.push(botEntry);
        const botIndex = working.length - 1;
        const matchedEntries = await this.matchEntries(
          working,
          index,
          botIndex,
        );

        if (!matchedEntries) {
          return new Response('Failed to allocate quick match', {
            status: 503,
          });
        }

        await this.writeQueue(matchedEntries);
        const humanRow = matchedEntries.find((e) => e.ticket === ticket);
        if (!humanRow?.matched) {
          return new Response('Failed to resolve quick match', { status: 500 });
        }
        return Response.json(humanRow.matched);
      }
    }

    await this.writeQueue(entries);

    return Response.json(
      entries[index]?.matched ??
        buildQueuedResponse(
          {
            ticket,
            scenario: entries[index]?.scenario ?? QUICK_MATCH_SCENARIO,
            queuedAt: entries[index]?.queuedAt ?? current.queuedAt,
          },
          now,
          this.env,
        ),
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
