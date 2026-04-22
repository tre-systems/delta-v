import type { PlayerToken, RoomCode } from './ids';
import type { PublicPlayerProfile } from './player';

export const QUICK_MATCH_SCENARIO = 'duel';
export const OFFICIAL_QUICK_MATCH_BOT_WAIT_MS = 20_000;

export interface QuickMatchRequest {
  scenario?: string;
  rendezvousCode?: string;
  /**
   * When true, the server may convert an already-queued ticket into a
   * rated match against the platform-operated Official Bot once the
   * human-first wait threshold has elapsed.
   */
  acceptOfficialBotMatch?: boolean;
  player: PublicPlayerProfile;
}

export interface QuickMatchQueuedResponse {
  status: 'queued';
  ticket: string;
  scenario: string;
  /** Server-authored signal for whether the explicit Official Bot fallback can be shown now. */
  officialBotOfferAvailable: boolean;
  /** Milliseconds until the fallback becomes available; `null` when the feature is disabled. */
  officialBotWaitMsRemaining: number | null;
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
