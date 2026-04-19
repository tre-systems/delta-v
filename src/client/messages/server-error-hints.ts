import { ErrorCode } from '../../shared/types/domain';

/** Friendly clause prepended to server error toasts when the code is known. */
export const SERVER_ERROR_USER_HINT: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.INVALID_PHASE]: 'Action not available in this phase',
  [ErrorCode.NOT_YOUR_TURN]: "It's not your turn",
  [ErrorCode.INVALID_INPUT]: 'Invalid action — please try again',
  [ErrorCode.RESOURCE_LIMIT]: 'Too many requests',
  [ErrorCode.STATE_CONFLICT]: 'Action conflicts with current game state',
  [ErrorCode.NOT_ALLOWED]: 'That action is not allowed right now',
  [ErrorCode.INVALID_SELECTION]: 'Invalid selection — please try again',
  [ErrorCode.INVALID_TARGET]: 'Invalid target for this action',
  [ErrorCode.INVALID_SHIP]: 'Invalid ship for this action',
  [ErrorCode.INVALID_PLAYER]: 'Invalid player',
  [ErrorCode.ROOM_NOT_FOUND]: 'No game found with that code',
  [ErrorCode.ROOM_FULL]: 'That game is already full',
  [ErrorCode.GAME_IN_PROGRESS]: 'That game has already started',
  [ErrorCode.GAME_COMPLETED]: 'That game has already completed',
};
