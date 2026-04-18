/**
 * Precedence for transient player feedback (see `OverlayView` JSDoc).
 *
 * Order of authority when multiple channels could apply to the same moment:
 * 1. Phase transition → phase alert banner only.
 * 2. Action / connection / session outcome → toast.
 * 3. Turn-scoped instruction → HUD status line.
 * 4. History / chat → game log (and latest bar), not duplicated as toasts.
 *
 * When adding a new message, pick one channel using this order and avoid
 * duplicating the same sentence on two surfaces in the same tick.
 */
export type NotificationChannel = 'toast' | 'phaseAlert' | 'hudStatus' | 'log';
