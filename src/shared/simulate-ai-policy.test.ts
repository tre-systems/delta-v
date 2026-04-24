import { describe, expect, it } from 'vitest';
import {
  buildScenarioScorecard,
  evaluateSimulationPolicies,
  type SimulationMetrics,
} from '../../scripts/simulate-ai';

const metrics = (
  overrides: Partial<SimulationMetrics> & Pick<SimulationMetrics, 'scenario'>,
): SimulationMetrics => {
  const base: Omit<SimulationMetrics, 'scorecard'> = {
    scenario: overrides.scenario,
    totalGames: 20,
    player0Wins: 10,
    player1Wins: 10,
    draws: 0,
    totalTurns: 100,
    crashes: 0,
    crashSeeds: [],
    aiInvalidActions: 0,
    invalidActionSeeds: [],
    failureCounters: {
      invalidActions: 0,
      invalidActionPhases: {},
      fuelStalls: 0,
    },
    reasons: { 'Landed on Terra with colonists!': 20 },
  };
  const merged = { ...base, ...overrides };

  return {
    ...merged,
    scorecard: buildScenarioScorecard(merged),
  };
};

describe('evaluateSimulationPolicies', () => {
  it('builds scenario scorecards from simulation outcomes', () => {
    const scorecard = buildScenarioScorecard({
      scenario: 'convoy',
      totalGames: 20,
      player0Wins: 12,
      player1Wins: 6,
      draws: 2,
      totalTurns: 200,
      crashes: 0,
      crashSeeds: [],
      aiInvalidActions: 0,
      invalidActionSeeds: [],
      failureCounters: {
        invalidActions: 1,
        invalidActionPhases: { astrogation: 1 },
        fuelStalls: 5,
      },
      reasons: {
        'Landed on Venus with colonists!': 6,
        'Fleet eliminated!': 10,
        timeout: 2,
        unknown: 2,
      },
    });

    expect(scorecard.decidedGames).toBe(18);
    expect(scorecard.player0DecidedRate).toBeCloseTo(12 / 18);
    expect(scorecard.averageTurns).toBe(10);
    expect(scorecard.objectiveResolutions).toBe(6);
    expect(scorecard.objectiveShare).toBe(0.3);
    expect(scorecard.fleetEliminations).toBe(10);
    expect(scorecard.fleetEliminationShare).toBe(0.5);
    expect(scorecard.timeouts).toBe(2);
    expect(scorecard.timeoutShare).toBe(0.1);
    expect(scorecard.passengerDeliveries).toBe(6);
    expect(scorecard.passengerDeliveryShare).toBe(0.3);
    expect(scorecard.invalidActions).toBe(1);
    expect(scorecard.invalidActionShare).toBe(0.05);
    expect(scorecard.fuelStalls).toBe(5);
    expect(scorecard.fuelStallsPerGame).toBe(0.25);
  });

  it('fails CI policy evaluation when AI actions are rejected', () => {
    const evaluation = evaluateSimulationPolicies([
      metrics({
        scenario: 'duel',
        aiInvalidActions: 1,
        failureCounters: {
          invalidActions: 1,
          invalidActionPhases: { combat: 1 },
          fuelStalls: 0,
        },
      }),
    ]);

    expect(evaluation.failed).toBe(true);
  });

  it('warns when passenger scenarios fall below objective-resolution floors', () => {
    const evaluation = evaluateSimulationPolicies([
      metrics({
        scenario: 'evacuation',
        player0Wins: 1,
        player1Wins: 19,
        reasons: { 'Fleet eliminated!': 20 },
      }),
    ]);

    expect(evaluation.failed).toBe(false);
    expect(evaluation.warnings).toContainEqual({
      scenario: 'evacuation',
      kind: 'objective',
      message: 'objective resolutions 0.0% below 5%',
    });
    expect(evaluation.warnings).toContainEqual({
      scenario: 'evacuation',
      kind: 'objective',
      message: 'fleet-elimination share 100.0% above 90%',
    });
  });

  it('warns when Grand Tour objective-seat balance skews too far', () => {
    const evaluation = evaluateSimulationPolicies([
      metrics({
        scenario: 'grandTour',
        player0Wins: 0,
        player1Wins: 20,
        reasons: {
          'Grand Tour complete! Visited all 8 bodies.': 20,
        },
      }),
    ]);

    expect(evaluation.failed).toBe(false);
    expect(evaluation.warnings).toEqual([
      {
        scenario: 'grandTour',
        kind: 'objective',
        message: 'objective-seat balance P0 decided rate 0.0% outside [35-65%]',
      },
    ]);
  });

  it('fails only on engine crashes', () => {
    const evaluation = evaluateSimulationPolicies([
      metrics({
        scenario: 'convoy',
        crashes: 2,
        crashSeeds: [123, 456],
      }),
    ]);

    expect(evaluation.failed).toBe(true);
  });
});
