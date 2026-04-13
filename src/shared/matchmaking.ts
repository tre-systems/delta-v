import type { PlayerToken, RoomCode } from './ids';
import type { PublicPlayerProfile } from './player';

export const QUICK_MATCH_SCENARIO = 'duel';

export interface QuickMatchRequest {
  scenario?: string;
  player: PublicPlayerProfile;
}

export interface QuickMatchQueuedResponse {
  status: 'queued';
  ticket: string;
  scenario: string;
}

export interface QuickMatchMatchedResponse {
  status: 'matched';
  ticket: string;
  scenario: string;
  code: RoomCode;
  playerToken: PlayerToken;
}

export interface QuickMatchExpiredResponse {
  status: 'expired';
  ticket: string;
  scenario: string;
  reason: string;
}

export type QuickMatchResponse =
  | QuickMatchQueuedResponse
  | QuickMatchMatchedResponse
  | QuickMatchExpiredResponse;
