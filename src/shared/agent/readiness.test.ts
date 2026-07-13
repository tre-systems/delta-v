import { describe, expect, it } from 'vitest';
import { createGameOrThrow } from '../engine/game-engine';
import { asGameId } from '../ids';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from '../map-data';
import {
  AGENT_AUTOPLAY_TIMEOUT_MS,
  AGENT_DEADLINE_ESTIMATE_SAFETY_MS,
  buildEstimatedAgentReadyInfo,
} from './readiness';

const buildState = () =>
  createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    asGameId('READY-m1'),
    findBaseHex,
  );

describe('buildEstimatedAgentReadyInfo', () => {
  it('gives an actionable local agent a conservative fallback budget', () => {
    const state = buildState();
    state.activePlayer = 0;

    expect(
      buildEstimatedAgentReadyInfo({
        state,
        playerId: 0,
        stateObservedAt: 10_000,
        now: 20_000,
      }),
    ).toEqual({
      actionable: true,
      reason: 'your_turn',
      actionDeadlineAt:
        10_000 + AGENT_AUTOPLAY_TIMEOUT_MS - AGENT_DEADLINE_ESTIMATE_SAFETY_MS,
      msUntilAutoplay:
        AGENT_AUTOPLAY_TIMEOUT_MS - AGENT_DEADLINE_ESTIMATE_SAFETY_MS - 10_000,
      fallbackAutoplayPending: true,
    });
  });

  it('still warns about fallback when the bridge lacks a timestamp', () => {
    const state = buildState();
    state.activePlayer = 0;

    expect(
      buildEstimatedAgentReadyInfo({
        state,
        playerId: 0,
        stateObservedAt: null,
        now: 20_000,
      }),
    ).toMatchObject({
      actionable: true,
      actionDeadlineAt: null,
      msUntilAutoplay: null,
      fallbackAutoplayPending: true,
    });
  });

  it('does not advertise fallback while waiting for the opponent', () => {
    const state = buildState();
    state.activePlayer = 1;

    expect(
      buildEstimatedAgentReadyInfo({
        state,
        playerId: 0,
        stateObservedAt: 10_000,
        now: 20_000,
      }),
    ).toEqual({
      actionable: false,
      reason: 'waiting_for_opponent',
      actionDeadlineAt: null,
      msUntilAutoplay: null,
      fallbackAutoplayPending: false,
    });
  });
});
