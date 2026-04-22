// Client-side polling of /version.json so a long session (e.g. a full
// Grand Tour that runs 100+ turns) learns about a fresh deploy without
// waiting on the next navigation. The service worker already does a
// network-first fetch for HTML and reloads on controllerchange — but
// that only fires once the user reloads. This module complements that
// by giving the player a dismissible "new version — reload" prompt in
// the middle of gameplay when the server has shipped new bundle hashes.
//
// Baseline strategy: the first successful fetch establishes the hash
// the client currently believes it is running. Every subsequent poll
// compares to that baseline and fires `onNewVersion` exactly once when
// the hash diverges. Failed polls (network error, non-JSON, missing
// hash) are silent — the goal is a helpful nudge, not noise.

export interface VersionPayload {
  packageVersion?: string;
  assetsHash?: string;
}

// Narrow fetch shape so tests don't have to construct full Response
// objects. Matches the subset of the DOM fetch we actually use.
export type VersionCheckResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};
export type VersionCheckFetch = (
  url: string,
  init?: { cache?: 'no-store'; headers?: Record<string, string> },
) => Promise<VersionCheckResponse>;

export interface StartVersionCheckOptions {
  onNewVersion: (info: { currentHash: string; nextHash: string }) => void;
  // Called on every successful fetch, mostly for tests.
  onPoll?: (hash: string) => void;
  pollIntervalMs?: number;
  // Injected for tests so we can drive the poll loop without timers.
  fetchLike?: VersionCheckFetch;
  setIntervalLike?: (fn: () => void, ms: number) => number;
  clearIntervalLike?: (handle: number) => void;
  // Resource URL — default /version.json, override in tests or for
  // servers that host the app under a subpath.
  url?: string;
}

export type Dispose = () => void;

const DEFAULT_POLL_INTERVAL_MS = 10 * 60 * 1000;

// Read the assetsHash out of a /version.json response. Returns null when
// the payload is missing, non-JSON, or lacks a usable hash — a caller
// that treats null as "skip this round" gets exactly the "silent on
// failure" behavior we want.
export const extractAssetsHash = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') return null;
  const { assetsHash, packageVersion } = payload as VersionPayload;
  if (typeof assetsHash === 'string' && assetsHash.trim().length > 0) {
    return assetsHash.trim();
  }
  if (typeof packageVersion === 'string' && packageVersion.trim().length > 0) {
    return packageVersion.trim();
  }
  return null;
};

export const startVersionCheck = (
  options: StartVersionCheckOptions,
): Dispose => {
  const {
    onNewVersion,
    onPoll,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetchLike = fetch as unknown as VersionCheckFetch,
    setIntervalLike = setInterval as unknown as (
      fn: () => void,
      ms: number,
    ) => number,
    clearIntervalLike = clearInterval as unknown as (handle: number) => void,
    url = '/version.json',
  } = options;

  let baseline: string | null = null;
  let disposed = false;
  let notified = false;

  const poll = async (): Promise<void> => {
    if (disposed || notified) return;
    try {
      const response = await fetchLike(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      const hash = extractAssetsHash(payload);
      if (!hash) return;
      onPoll?.(hash);
      if (baseline === null) {
        baseline = hash;
        return;
      }
      if (hash !== baseline) {
        notified = true;
        onNewVersion({ currentHash: baseline, nextHash: hash });
      }
    } catch {
      // Swallow network / parse errors so the poll loop keeps trying;
      // a transient outage must not produce a false "new version"
      // prompt, and the user doesn't need to know the poll failed.
    }
  };

  // Kick off an immediate poll so the baseline is captured quickly.
  // The returned promise is intentionally not awaited — the caller
  // should get a synchronous Dispose back.
  void poll();
  const handle = setIntervalLike(() => {
    void poll();
  }, pollIntervalMs);

  return () => {
    disposed = true;
    clearIntervalLike(handle);
  };
};
