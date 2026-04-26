import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareSeedSweepSummaries,
  type SeedSweepRow,
  summarizeSeedSweepRows,
  validateSeedSweepBaseline,
} from '../../scripts/duel-seed-sweep';
import {
  buildFailureCaptureManifestEntry,
  buildScenarioScorecard,
  evaluateSimulationPolicies,
  runSimulation,
  type SimulationFailureCapture,
  type SimulationMetrics,
  shouldCaptureFailureKind,
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
      passengerTransferMistakes: 0,
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
        passengerTransferMistakes: 2,
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
    expect(scorecard.passengerTransferMistakes).toBe(2);
    expect(scorecard.passengerTransferMistakesPerGame).toBe(0.1);
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
          passengerTransferMistakes: 0,
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

  it('warns when fuel stalls per game exceed the scenario threshold', () => {
    const evaluation = evaluateSimulationPolicies([
      metrics({
        scenario: 'fleetAction',
        totalGames: 10,
        player0Wins: 5,
        player1Wins: 5,
        reasons: { 'Fleet eliminated!': 10 },
        failureCounters: {
          invalidActions: 0,
          invalidActionPhases: {},
          // 720 stalls / 10 games = 72.0/game — matches the 2026-04-24
          // hard-vs-hard fleetAction observation.
          fuelStalls: 720,
          passengerTransferMistakes: 0,
        },
      }),
    ]);

    expect(evaluation.failed).toBe(false);
    expect(evaluation.warnings).toContainEqual({
      scenario: 'fleetAction',
      kind: 'objective',
      message:
        'fuel stalls/game 72.0 above 30 (fueled ships coasting instead of ' +
        'burning — see BACKLOG fleet-scale entry)',
    });
  });

  it('does not warn on healthy fuel-stall density', () => {
    const evaluation = evaluateSimulationPolicies([
      metrics({
        scenario: 'convoy',
        totalGames: 30,
        player0Wins: 15,
        player1Wins: 15,
        reasons: { 'Landed on Venus with colonists!': 30 },
        failureCounters: {
          invalidActions: 0,
          invalidActionPhases: {},
          // 19.3/game — convoy's observed steady-state.
          fuelStalls: 579,
          passengerTransferMistakes: 0,
        },
      }),
    ]);

    expect(
      evaluation.warnings.find((w) => w.message.startsWith('fuel stalls/game')),
    ).toBeUndefined();
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

describe('summarizeSeedSweepRows', () => {
  it('aggregates scorecard signals across paired seed rows', () => {
    const rows: SeedSweepRow[] = [
      {
        ...metrics({
          scenario: 'convoy',
          totalGames: 10,
          player0Wins: 4,
          player1Wins: 4,
          draws: 2,
          totalTurns: 120,
          reasons: {
            'Landed on Venus with colonists!': 3,
            'Fleet eliminated!': 5,
            timeout: 2,
          },
          failureCounters: {
            invalidActions: 0,
            invalidActionPhases: {},
            fuelStalls: 20,
            passengerTransferMistakes: 1,
          },
        }),
        baseSeed: 0,
        p0DecidedPct: 50,
        avgTurns: 12,
      },
      {
        ...metrics({
          scenario: 'convoy',
          totalGames: 10,
          player0Wins: 6,
          player1Wins: 4,
          draws: 0,
          totalTurns: 80,
          reasons: {
            'Landed on Venus with colonists!': 7,
            'Fleet eliminated!': 3,
          },
          failureCounters: {
            invalidActions: 1,
            invalidActionPhases: { astrogation: 1 },
            fuelStalls: 10,
            passengerTransferMistakes: 3,
          },
        }),
        baseSeed: 1,
        p0DecidedPct: 60,
        avgTurns: 8,
      },
    ];

    expect(summarizeSeedSweepRows(rows)).toMatchObject({
      seedCount: 2,
      avgTurnsMean: 10,
      avgTurnsMin: 8,
      avgTurnsMax: 12,
      meanP0DecidedPct: 55,
      meanObjectiveShare: 0.5,
      meanFleetEliminationShare: 0.4,
      meanTimeoutShare: 0.1,
      meanFuelStallsPerGame: 1.5,
      meanPassengerDeliveryShare: 0.5,
      meanInvalidActionShare: 0.05,
      meanPassengerTransferMistakesPerGame: 0.2,
      totalCrashes: 0,
    });
  });

  it('computes summary deltas for before/after seed-sweep reports', () => {
    const before = summarizeSeedSweepRows([
      {
        ...metrics({
          scenario: 'convoy',
          totalGames: 10,
          player0Wins: 4,
          player1Wins: 4,
          draws: 2,
          totalTurns: 120,
          reasons: {
            'Landed on Venus with colonists!': 3,
            'Fleet eliminated!': 5,
            timeout: 2,
          },
          failureCounters: {
            invalidActions: 0,
            invalidActionPhases: {},
            fuelStalls: 20,
            passengerTransferMistakes: 1,
          },
        }),
        baseSeed: 0,
        p0DecidedPct: 50,
        avgTurns: 12,
      },
    ]);
    const after = summarizeSeedSweepRows([
      {
        ...metrics({
          scenario: 'convoy',
          totalGames: 10,
          player0Wins: 5,
          player1Wins: 5,
          draws: 0,
          totalTurns: 100,
          reasons: {
            'Landed on Venus with colonists!': 6,
            'Fleet eliminated!': 4,
          },
          failureCounters: {
            invalidActions: 0,
            invalidActionPhases: {},
            fuelStalls: 12,
            passengerTransferMistakes: 0,
          },
        }),
        baseSeed: 0,
        p0DecidedPct: 50,
        avgTurns: 10,
      },
    ]);

    const comparison = compareSeedSweepSummaries(before, after);

    expect(comparison).toMatchObject({
      avgTurnsMeanDelta: -2,
      meanP0DecidedPctDelta: 0,
      meanInvalidActionShareDelta: 0,
      totalCrashesDelta: 0,
    });
    expect(comparison.meanObjectiveShareDelta).toBeCloseTo(0.3);
    expect(comparison.meanFleetEliminationShareDelta).toBeCloseTo(-0.1);
    expect(comparison.meanTimeoutShareDelta).toBeCloseTo(-0.2);
    expect(comparison.meanFuelStallsPerGameDelta).toBeCloseTo(-0.8);
    expect(comparison.meanPassengerDeliveryShareDelta).toBeCloseTo(0.3);
    expect(comparison.meanPassengerTransferMistakesPerGameDelta).toBeCloseTo(
      -0.1,
    );
  });

  it('rejects baseline comparisons for mismatched seed sweeps', () => {
    const baseline = {
      scenario: 'convoy',
      iterations: 30,
      seeds: [0, 1],
      summary: summarizeSeedSweepRows([
        {
          ...metrics({ scenario: 'convoy' }),
          baseSeed: 0,
          p0DecidedPct: 50,
          avgTurns: 5,
        },
      ]),
    };

    expect(() =>
      validateSeedSweepBaseline(baseline, {
        scenario: 'evacuation',
        iterations: 30,
        seeds: [0, 1],
      }),
    ).toThrow('Baseline scenario mismatch');
    expect(() =>
      validateSeedSweepBaseline(baseline, {
        scenario: 'convoy',
        iterations: 20,
        seeds: [0, 1],
      }),
    ).toThrow('Baseline iteration mismatch');
    expect(() =>
      validateSeedSweepBaseline(baseline, {
        scenario: 'convoy',
        iterations: 30,
        seeds: [1, 0],
      }),
    ).toThrow('Baseline seed mismatch');
  });
});

describe('buildFailureCaptureManifestEntry', () => {
  it('summarizes captured failure files without embedding full GameState', () => {
    const capture: SimulationFailureCapture = {
      schemaVersion: 1,
      kind: 'fuelStall',
      scenario: 'grandTour',
      seed: 123,
      gameIndex: 4,
      turnNumber: 12,
      phase: 'astrogation',
      activePlayer: 1,
      difficulty: 'hard',
      playerDifficulties: { p0: 'hard', p1: 'hard' },
      state: {} as SimulationFailureCapture['state'],
      action: { type: 'astrogation' },
      stalledShipIds: ['ship-a', 'ship-b'],
      message: 'stationary fueled ships coasted',
    };

    expect(
      buildFailureCaptureManifestEntry(
        '001-grandTour-123-fuelStall-turn-12-p1.json',
        capture,
      ),
    ).toEqual({
      path: '001-grandTour-123-fuelStall-turn-12-p1.json',
      kind: 'fuelStall',
      scenario: 'grandTour',
      seed: 123,
      gameIndex: 4,
      turnNumber: 12,
      phase: 'astrogation',
      activePlayer: 1,
      difficulty: 'hard',
      message: 'stationary fueled ships coasted',
      stalledShipIds: ['ship-a', 'ship-b'],
    });
  });

  it('writes a capture manifest sidecar when captures are enabled', async () => {
    const captureDir = await mkdtemp(path.join(tmpdir(), 'delta-v-captures-'));

    try {
      await runSimulation('convoy', 1, {
        p0Diff: 'hard',
        p1Diff: 'hard',
        randomizeStart: false,
        forcedStart: null,
        baseSeed: 0,
        json: false,
        captureFailuresDir: captureDir,
        captureFailuresLimit: 0,
        quiet: true,
      });

      const manifest = JSON.parse(
        await readFile(path.join(captureDir, 'capture-manifest.json'), 'utf8'),
      );

      expect(manifest).toMatchObject({
        schemaVersion: 1,
        scenario: 'convoy',
        captureLimit: 0,
        captureKinds: null,
        captured: 0,
        entries: [],
      });
    } finally {
      await rm(captureDir, { recursive: true, force: true });
    }
  });

  it('filters capture kinds before spending the capture limit', () => {
    expect(shouldCaptureFailureKind('fuelStall', null)).toBe(true);
    expect(shouldCaptureFailureKind('fuelStall', [])).toBe(true);
    expect(shouldCaptureFailureKind('fuelStall', ['fuelStall'])).toBe(true);
    expect(shouldCaptureFailureKind('fuelStall', ['objectiveDrift'])).toBe(
      false,
    );
  });
});
