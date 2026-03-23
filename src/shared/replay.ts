import type { GameState, Phase } from './types/domain';
import type { S2C } from './types/protocol';

export type ReplayMessage = Extract<
  S2C,
  {
    state: GameState;
  }
>;

export interface ReplayEntry {
  sequence: number;
  recordedAt: number;
  turn: number;
  phase: Phase;
  message: ReplayMessage;
}

export interface ReplayTimeline {
  gameId: string;
  roomCode: string;
  matchNumber: number;
  scenario: string;
  createdAt: number;
  entries: ReplayEntry[];
}

export const buildMatchId = (roomCode: string, matchNumber: number): string =>
  `${roomCode}-m${matchNumber}`;

export const parseMatchId = (
  gameId: string,
): {
  roomCode: string;
  matchNumber: number;
} | null => {
  const match = /^([A-Z0-9]{5})-m(\d+)$/.exec(gameId);

  if (!match) {
    return null;
  }

  return {
    roomCode: match[1],
    matchNumber: Number(match[2]),
  };
};

export const toReplayEntry = (
  sequence: number,
  message: ReplayMessage,
  recordedAt: number,
): ReplayEntry => ({
  sequence,
  recordedAt,
  turn: message.state.turnNumber,
  phase: message.state.phase,
  message: structuredClone(message),
});
