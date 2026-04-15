export type ClientFeatureFlag = 'spectatorMode' | 'replayControls';

const DEFAULT_CLIENT_FEATURE_FLAGS: Readonly<
  Record<ClientFeatureFlag, boolean>
> = {
  spectatorMode: false,
  // Replay controls are enabled for two code paths:
  // 1. Post-match review — a player finishes their game and scrubs through
  //    it via "View Replay" on the game-over overlay.
  // 2. Archived replays from /matches — the history page boots the client
  //    into read-only replay mode for any completed match.
  // Both paths share the same replay-controller machinery and overlay UI.
  replayControls: true,
};

const FEATURE_STORAGE_PREFIX = 'delta-v:feature:';

type FeatureFlagOverrideValue = boolean | string | number;
type FeatureFlagOverrides = Partial<
  Record<ClientFeatureFlag, FeatureFlagOverrideValue>
>;

const parseFlagOverride = (raw: string | null): boolean | null => {
  if (raw === null) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'on' ||
    normalized === 'yes'
  ) {
    return true;
  }

  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'off' ||
    normalized === 'no'
  ) {
    return false;
  }

  return null;
};

const readStorageOverride = (flag: ClientFeatureFlag): boolean | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage?.getItem(
      `${FEATURE_STORAGE_PREFIX}${flag}`,
    );
    return parseFlagOverride(raw ?? null);
  } catch {
    return null;
  }
};

const readGlobalOverride = (flag: ClientFeatureFlag): boolean | null => {
  const globalOverrides = (
    globalThis as typeof globalThis & {
      __DELTA_V_FEATURE_FLAGS?: FeatureFlagOverrides;
    }
  ).__DELTA_V_FEATURE_FLAGS;

  if (!globalOverrides || !(flag in globalOverrides)) {
    return null;
  }

  return parseFlagOverride(String(globalOverrides[flag] ?? ''));
};

export const isClientFeatureEnabled = (flag: ClientFeatureFlag): boolean => {
  const globalOverride = readGlobalOverride(flag);
  if (globalOverride !== null) {
    return globalOverride;
  }

  const override = readStorageOverride(flag);
  if (override !== null) {
    return override;
  }

  return DEFAULT_CLIENT_FEATURE_FLAGS[flag];
};
