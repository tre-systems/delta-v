import { describe, expect, it } from 'vitest';
import {
  evaluateSimulationPolicies,
  type SimulationMetrics,
} from '../../scripts/simulate-ai';

const metrics = (
  overrides: Partial<SimulationMetrics> & Pick<SimulationMetrics, 'scenario'>,
): SimulationMetrics => {
  const base: SimulationMetrics = {
    scenario: overrides.scenario,
    totalGames: 20,
    player0Wins: 10,
    player1Wins: 10,
    draws: 0,
    totalTurns: 100,
    crashes: 0,
    crashSeeds: [],
    reasons: { 'Landed on Terra with colonists!': 20 },
  };

  return { ...base, ...overrides };
};

describe('evaluateSimulationPolicies', () => {
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
