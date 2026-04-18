import { ErrorCode } from '../../shared/types/domain';
import { SERVER_ERROR_USER_HINT } from './server-error-hints';
import { TOAST } from './toasts';

export const getServerErrorToastMessage = (
  message: string,
  code?: ErrorCode,
): string => {
  if (code === ErrorCode.RESOURCE_LIMIT) {
    return TOAST.connection.rateLimited;
  }

  const friendlyMessage = code ? SERVER_ERROR_USER_HINT[code] : null;
  return friendlyMessage ? `${friendlyMessage}: ${message}` : message;
};

export const getConnectCloseToastMessage = (
  code: number | null,
  reason: string | null,
): string => {
  if (code === 1006) {
    return TOAST.connection.couldNotReachServer;
  }
  if (code === 1008) {
    return TOAST.connection.rateLimited;
  }
  if (code === 1011) {
    return TOAST.connection.serverErrorRetryShortly;
  }
  if (code !== null && reason && /rate limit/i.test(reason)) {
    return TOAST.connection.rateLimited;
  }
  return TOAST.connection.couldNotConnect;
};
