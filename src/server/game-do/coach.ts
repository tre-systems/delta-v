// Mid-game coach directive handling. See AGENT_SPEC §9.
//
// A human coach sends `/coach <text>` in chat; the server strips the
// prefix and stores the directive for the OPPOSITE seat (so a seat-0
// human coaches the seat-1 agent, and vice versa). The coached agent
// receives the directive in every subsequent observation until:
//   - a new /coach lands (replacement), or
//   - the match ends (storage cleared on archive — out of scope here)
//
// The /coach chat message itself is NOT rebroadcast as a normal chat
// message. It is a private whisper from the coach to their own agent;
// spectators and the other seat do not see it. This matches the §9
// "WHISPER" semantics and avoids leaking strategy in agent-vs-agent
// coached matches.
//
// Kept deliberately small and transport-agnostic: the only DurableObject
// surface these helpers touch is `get`/`put`/`delete` on storage.

import type { CoachDirective } from '../../shared/agent';
import type { PlayerId } from '../../shared/types/domain';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';

export const COACH_PREFIX = '/coach ';

const storageKeyForSeat = (seat: PlayerId): string =>
  seat === 0
    ? GAME_DO_STORAGE_KEYS.coachDirectiveSeat0
    : GAME_DO_STORAGE_KEYS.coachDirectiveSeat1;

// Strict chat-length bound so a runaway coach message can't bloat storage.
// Mirrors the 200-char chat limit the protocol already enforces.
const MAX_COACH_TEXT_LENGTH = 500;

export interface ParsedCoachMessage {
  // Text after the "/coach " prefix, trimmed.
  text: string;
}

// Parse a raw chat text. Returns a ParsedCoachMessage when the text starts
// with the exact "/coach " prefix and has non-empty remainder; null when
// the text is a normal chat or has no payload.
export const parseCoachMessage = (raw: string): ParsedCoachMessage | null => {
  if (!raw.startsWith(COACH_PREFIX)) return null;
  const body = raw.slice(COACH_PREFIX.length).trim();
  if (body.length === 0) return null;
  const text = body.slice(0, MAX_COACH_TEXT_LENGTH);
  return { text };
};

export const getCoachDirective = async (
  storage: DurableObjectStorage,
  seat: PlayerId,
): Promise<CoachDirective | null> =>
  (await storage.get<CoachDirective>(storageKeyForSeat(seat))) ?? null;

// Store a directive for the given seat. Replaces any prior directive for
// that seat — "most recent coach intent wins". Also sets the match-level
// coached flag (one-way — cleared only on archive, which is deliberate:
// uncoached Elo cannot be retroactively achieved from a coached game).
export const setCoachDirective = async (
  storage: DurableObjectStorage,
  seat: PlayerId,
  directive: CoachDirective,
): Promise<void> => {
  await storage.put(storageKeyForSeat(seat), directive);
  await storage.put(GAME_DO_STORAGE_KEYS.matchCoached, true);
};

// Called when the match is archived so fresh matches in the same room
// start with a clean slate.
export const clearCoachDirectives = async (
  storage: DurableObjectStorage,
): Promise<void> => {
  await Promise.all([
    storage.delete(GAME_DO_STORAGE_KEYS.coachDirectiveSeat0),
    storage.delete(GAME_DO_STORAGE_KEYS.coachDirectiveSeat1),
  ]);
};

export const isMatchCoached = async (
  storage: DurableObjectStorage,
): Promise<boolean> =>
  (await storage.get<boolean>(GAME_DO_STORAGE_KEYS.matchCoached)) === true;
