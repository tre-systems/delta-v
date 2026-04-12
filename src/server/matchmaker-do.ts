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
}

const MATCHMAKER_STORAGE_KEY = 'quickMatchQueue';
const HEARTBEAT_TTL_MS = 15_000;
const MATCH_RESULT_TTL_MS = 60_000;
const BOT_FILL_DELAY_MS = 10_000;
const BOT_NAMES = [
  'Rowan Vale',
  'Mira Sol',
  'Jonah Kade',
  'Ari Mercer',
  'Tessa Quill',
  'Nico Stern',
] as const;

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

const buildBotProfile = (seed: string): PublicPlayerProfile => {
  const name = BOT_NAMES[seed.charCodeAt(0) % BOT_NAMES.length] ?? BOT_NAMES[0];
  const suffix = seed.slice(0, 10).toLowerCase();

  return {
    playerKey: `agent_${suffix}`,
    username: name,
  };
};

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
                kind: 'human',
              },
              {
                ...players[1],
                kind: players[1].playerKey.startsWith('agent_')
                  ? 'agent'
                  : 'human',
              },
            ],
          }),
        }),
      );

      if (response.ok) {
        return {
          code,
          playerTokens: [playerTokens[0], playerTokens[1]],
        };
      }

      if (response.status !== 409) {
        return null;
      }
    }

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

  private async matchEntries(
    entries: QueueEntry[],
    leftIndex: number,
    rightIndex: number,
    rightPlayerOverride?: PublicPlayerProfile,
  ): Promise<QueueEntry[] | null> {
    const left = entries[leftIndex];
    const right = rightPlayerOverride
      ? {
          ticket: entries[leftIndex]?.ticket ?? ticketFromEntropy(),
          scenario: left.scenario,
          player: rightPlayerOverride,
        }
      : entries[rightIndex];

    if (!left) {
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

    if (!rightPlayerOverride && entries[rightIndex]) {
      const existing = entries[rightIndex];
      entries[rightIndex] = {
        ...existing,
        status: 'matched',
        lastSeenAt: now,
        matched: this.buildMatchedResponse(
          existing.ticket,
          existing.scenario,
          room.code,
          room.playerTokens[1],
        ),
      };
    }

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
    let entries = this.pruneQueue(await this.readQueue(), now);
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

    if (now - current.queuedAt >= BOT_FILL_DELAY_MS) {
      const matchedEntries = await this.matchEntries(
        entries,
        index,
        index,
        buildBotProfile(ticket),
      );

      if (!matchedEntries) {
        return new Response('Failed to allocate quick match', { status: 503 });
      }

      entries = matchedEntries;
    }

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
