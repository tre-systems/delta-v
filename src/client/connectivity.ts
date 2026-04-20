// Reactive online/offline signal sourced from `navigator.onLine` plus
// the window `online` / `offline` events. Used by the lobby to gate
// CTAs that require a server round-trip (Quick Match, Create Private,
// Join, Leaderboard, Recent Matches) so they don't fail opaquely when
// the user is on a plane or has lost Wi-Fi.
//
// The client-runtime already has separate listeners that fire a toast
// on transitions; this signal is intended for *state binding* in views
// (disabled button state, offline banner visibility) rather than
// one-shot side effects.

import { type ReadonlySignal, signal } from './reactive';

export interface ConnectivityController {
  /** Reactive `true` when the browser believes we can reach the network. */
  readonly onlineSignal: ReadonlySignal<boolean>;
  dispose: () => void;
}

export interface ConnectivityDeps {
  /** Window-like target for online/offline event binding. Defaults to `window`. */
  readonly target?: EventTarget;
  /** Initial online state. Defaults to `navigator.onLine`, true if unavailable. */
  readonly initialOnline?: boolean;
}

const readNavigatorOnline = (): boolean => {
  // `navigator.onLine` is `false` only when the browser is confident there
  // is no route to the network; many platforms leave it permanently `true`
  // when no events have fired yet. Treat missing `navigator` (test env) as
  // online so unit tests don't need to stub it.
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine ?? true;
};

export const createConnectivityController = (
  deps: ConnectivityDeps = {},
): ConnectivityController => {
  const target = deps.target ?? globalThis;
  const onlineSignal = signal(deps.initialOnline ?? readNavigatorOnline());

  const onOnline = (): void => {
    onlineSignal.value = true;
  };
  const onOffline = (): void => {
    onlineSignal.value = false;
  };

  target.addEventListener('online', onOnline);
  target.addEventListener('offline', onOffline);

  return {
    onlineSignal,
    dispose: () => {
      target.removeEventListener('online', onOnline);
      target.removeEventListener('offline', onOffline);
    },
  };
};
