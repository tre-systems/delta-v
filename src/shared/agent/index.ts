// Shared agent observation builder. Both the stdin/HTTP bridge and the MCP
// servers use this module so there is one source of truth for candidates,
// legal-action metadata, and the prose summary agents see.

export {
  type ActionEffect,
  type ActionEffectsResult,
  computeActionEffects,
} from './action-effects';
export {
  type ApplyActionFailure,
  type ApplyActionResult,
  type ApplyActionSuccess,
  applyAgentAction,
} from './apply-action';
export {
  type LabeledCandidate,
  labelCandidate,
  labelCandidates,
} from './candidate-labels';
export {
  allowedActionTypesForPhase,
  buildActionForDifficulty,
  buildCandidates,
  buildIdleAstrogationOrders,
} from './candidates';
export {
  DIRECTION_NAMES,
  describeCandidate,
  describePosition,
  describeShip,
  describeVelocity,
  nearestBody,
} from './describe';
export { buildLegalActionInfo } from './legal-actions';
export {
  type BuildObservationOptions,
  buildObservation,
  buildStateSummary,
  withCompactObservationState,
} from './observation';
export {
  normalizeQuickMatchServerUrl,
  type QuickMatchArgs,
  type QuickMatchResult,
  queueForMatch,
} from './quick-match';
export {
  renderSpatialGrid,
  type SpatialGridOptions,
} from './spatial-grid';
export { buildTacticalFeatures, type TacticalFeatures } from './tactical';
export type {
  AgentTurnInput,
  AgentTurnResponse,
  CoachDirective,
  LegalActionEnemyInfo,
  LegalActionInfo,
  LegalActionShipInfo,
} from './types';
