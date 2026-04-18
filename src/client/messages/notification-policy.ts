/**
 * Precedence for transient player feedback (see `OverlayView` JSDoc).
 *
 * Order of authority when multiple channels could apply to the same moment:
 * 1. Phase transition → phase alert banner only.
 * 2. Action / connection / session outcome → toast.
 * 3. Turn-scoped instruction → HUD status line (including the turn timer
 *    countdown; do not duplicate that with an info toast — use sound/HUD).
 * 4. History / chat → game log (and latest bar), not duplicated as toasts.
 *
 * When adding a new message, pick one channel using this order and avoid
 * duplicating the same sentence on two surfaces in the same tick.
 */
export type NotificationChannel = 'toast' | 'phaseAlert' | 'hudStatus' | 'log';

/** Lower rank = higher authority when two channels compete the same tick. */
const NOTIFICATION_CHANNEL_RANK: Record<NotificationChannel, number> = {
  phaseAlert: 0,
  toast: 1,
  hudStatus: 2,
  log: 3,
};

export const NOTIFICATION_CHANNEL_PRECEDENCE: readonly NotificationChannel[] = [
  'phaseAlert',
  'toast',
  'hudStatus',
  'log',
] as const;

export const notificationChannelPrecedenceIndex = (
  channel: NotificationChannel,
): number => NOTIFICATION_CHANNEL_RANK[channel];

/** Prefer the higher-authority channel when both would apply (ties return `a`). */
export const preferNotificationChannel = (
  a: NotificationChannel,
  b: NotificationChannel,
): NotificationChannel =>
  notificationChannelPrecedenceIndex(a) <= notificationChannelPrecedenceIndex(b)
    ? a
    : b;

export type ToastDedupeType = 'error' | 'info' | 'success';

/** Default window for suppressing identical transient toasts. */
export const TOAST_DEDUPE_WINDOW_MS = 450;

export interface ToastDedupeGate {
  /**
   * Returns false when the same non-error toast+message was emitted inside
   * the dedupe window. Errors always return true so repeated failures are
   * never silently dropped.
   */
  allow: (message: string, type: ToastDedupeType) => boolean;
}

export const createToastDedupeGate = (
  windowMs: number = TOAST_DEDUPE_WINDOW_MS,
): ToastDedupeGate => {
  let last: { message: string; type: ToastDedupeType; at: number } | null =
    null;
  return {
    allow(message, type) {
      if (type === 'error') return true;
      const now = Date.now();
      if (
        last &&
        last.message === message &&
        last.type === type &&
        now - last.at < windowMs
      ) {
        return false;
      }
      last = { message, type, at: now };
      return true;
    },
  };
};
