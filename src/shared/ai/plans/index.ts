export type PlanIntent =
  | 'deliverPassengers'
  | 'preserveLandingLine'
  | 'escortCarrier'
  | 'interceptPassengerCarrier'
  | 'supportPassengerCarrier'
  | 'refuelAtReachableBase'
  | 'postCarrierLossPursuit'
  | 'completeCheckpointRoute'
  | 'screenObjectiveRunner'
  | 'finishAttrition'
  | 'defendAgainstOrdnance'
  | 'attackThreat';

export interface PlanEvaluation {
  feasible: boolean;
  objective: number;
  survival: number;
  landing: number;
  fuel: number;
  combat: number;
  formation: number;
  tempo: number;
  risk: number;
  effort: number;
}

export interface PlanDiagnostic {
  reason: string;
  detail?: string;
}

export interface PlanCandidate<TAction> {
  id: string;
  intent: PlanIntent;
  action: TAction;
  evaluation: PlanEvaluation;
  priority?: number;
  diagnostics?: readonly PlanDiagnostic[];
}

export interface PlanDecision<TAction> {
  chosen: PlanCandidate<TAction>;
  rejected: readonly PlanCandidate<TAction>[];
}

type EvaluationScoreKey = Exclude<keyof PlanEvaluation, 'feasible'>;

const HIGHER_IS_BETTER: readonly EvaluationScoreKey[] = [
  'objective',
  'survival',
  'landing',
  'fuel',
  'combat',
  'formation',
  'tempo',
];

const LOWER_IS_BETTER: readonly EvaluationScoreKey[] = ['risk', 'effort'];

const compareNumberDescending = (left: number, right: number): number =>
  right - left;

const compareNumberAscending = (left: number, right: number): number =>
  left - right;

// Standard Array.sort comparator: negative means `left` ranks ahead of `right`.
export const comparePlanEvaluations = (
  left: PlanEvaluation,
  right: PlanEvaluation,
): number => {
  if (left.feasible !== right.feasible) {
    return left.feasible ? -1 : 1;
  }

  for (const key of HIGHER_IS_BETTER) {
    const diff = compareNumberDescending(left[key], right[key]);

    if (diff !== 0) return diff;
  }

  for (const key of LOWER_IS_BETTER) {
    const diff = compareNumberAscending(left[key], right[key]);

    if (diff !== 0) return diff;
  }

  return 0;
};

export const comparePlanCandidates = <TAction>(
  left: PlanCandidate<TAction>,
  right: PlanCandidate<TAction>,
): number => {
  const evaluationDiff = comparePlanEvaluations(
    left.evaluation,
    right.evaluation,
  );

  if (evaluationDiff !== 0) return evaluationDiff;

  const priorityDiff = compareNumberDescending(
    left.priority ?? 0,
    right.priority ?? 0,
  );

  if (priorityDiff !== 0) return priorityDiff;

  return left.id.localeCompare(right.id);
};

export const chooseBestPlan = <TAction>(
  candidates: readonly PlanCandidate<TAction>[],
): PlanDecision<TAction> | null => {
  if (candidates.length === 0) return null;

  const ordered = [...candidates].sort(comparePlanCandidates);
  const [chosen, ...rejected] = ordered;

  return { chosen, rejected };
};
