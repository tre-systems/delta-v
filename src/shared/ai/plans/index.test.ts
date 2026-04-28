import { describe, expect, it } from 'vitest';
import {
  chooseBestPlan,
  comparePlanCandidates,
  comparePlanEvaluations,
  type PlanCandidate,
  type PlanEvaluation,
  planEvaluation,
} from '.';

const baseEvaluation: PlanEvaluation = {
  feasible: true,
  objective: 0,
  survival: 0,
  landing: 0,
  fuel: 0,
  combat: 0,
  formation: 0,
  tempo: 0,
  risk: 0,
  effort: 0,
};

const candidate = (
  id: string,
  evaluation: Partial<PlanEvaluation>,
  priority = 0,
): PlanCandidate<string> => ({
  id,
  intent: 'deliverPassengers',
  action: id,
  priority,
  evaluation: planEvaluation({ feasible: true, ...evaluation }),
});

describe('intent-first plan comparison', () => {
  it('fills omitted plan evaluation dimensions with neutral values', () => {
    expect(planEvaluation({ feasible: true, objective: 12 })).toEqual({
      ...baseEvaluation,
      objective: 12,
    });
  });

  it('always ranks feasible plans ahead of infeasible plans', () => {
    const feasible = { ...baseEvaluation, feasible: true };
    const infeasible = {
      ...baseEvaluation,
      feasible: false,
      objective: 999,
      survival: 999,
    };

    expect(comparePlanEvaluations(feasible, infeasible)).toBeLessThan(0);
    expect(comparePlanEvaluations(infeasible, feasible)).toBeGreaterThan(0);
  });

  it('ranks objective progress ahead of lower-priority combat score', () => {
    const objectivePlan = candidate('objective', { objective: 1 });
    const combatPlan = candidate('combat', { combat: 100 });

    expect(comparePlanCandidates(objectivePlan, combatPlan)).toBeLessThan(0);
  });

  it('uses survival and landing before fuel or tempo', () => {
    const survivalPlan = candidate('survival', { survival: 2 });
    const landingPlan = candidate('landing', { survival: 1, landing: 10 });
    const fuelPlan = candidate('fuel', { survival: 1, fuel: 50 });

    expect(
      [fuelPlan, landingPlan, survivalPlan].sort(comparePlanCandidates),
    ).toEqual([survivalPlan, landingPlan, fuelPlan]);
  });

  it('treats risk and effort as lower-is-better tie-breakers', () => {
    const safer = candidate('safer', { objective: 1, risk: 1, effort: 5 });
    const risky = candidate('risky', { objective: 1, risk: 2, effort: 0 });
    const cheaper = candidate('cheaper', { objective: 1, risk: 1, effort: 3 });

    expect([risky, safer, cheaper].sort(comparePlanCandidates)).toEqual([
      cheaper,
      safer,
      risky,
    ]);
  });

  it('falls back to explicit priority and stable ids when evaluations tie', () => {
    const lowPriority = candidate('b-low', {}, 0);
    const highPriorityB = candidate('b-high', {}, 5);
    const highPriorityA = candidate('a-high', {}, 5);

    expect(
      [lowPriority, highPriorityB, highPriorityA].sort(comparePlanCandidates),
    ).toEqual([highPriorityA, highPriorityB, lowPriority]);
  });

  it('returns the best plan with rejected alternatives in ranking order', () => {
    const chosen = candidate('chosen', { objective: 2 });
    const second = candidate('second', { objective: 1, survival: 10 });
    const third = candidate('third', { objective: 1, survival: 5 });

    expect(chooseBestPlan([third, chosen, second])).toEqual({
      chosen,
      rejected: [second, third],
    });
  });

  it('returns null for an empty candidate set', () => {
    expect(chooseBestPlan([])).toBeNull();
  });
});
