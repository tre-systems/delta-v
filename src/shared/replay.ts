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

export interface ReplayArchive {
  gameId: string;
  roomCode: string;
  matchNumber: number;
  scenario: string;
  createdAt: number;
  entries: ReplayEntry[];
}

export const buildMatchId = (roomCode: string, matchNumber: number): string =>
  `${roomCode}-m${matchNumber}`;

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

export const createReplayArchive = (
  roomCode: string,
  matchNumber: number,
  message: ReplayMessage,
  recordedAt: number,
): ReplayArchive => ({
  gameId: message.state.gameId,
  roomCode,
  matchNumber,
  scenario: message.state.scenario,
  createdAt: recordedAt,
  entries: [toReplayEntry(1, message, recordedAt)],
});
