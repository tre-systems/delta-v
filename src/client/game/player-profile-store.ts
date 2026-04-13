import {
  buildDefaultUsername,
  normalizePlayerKey,
  normalizeUsername,
  type PublicPlayerProfile,
} from '../../shared/player';

export interface StoredPlayerProfile extends PublicPlayerProfile {
  updatedAt: number;
}

export interface PlayerProfileStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PLAYER_PROFILE_STORAGE_KEY = 'delta-v:player-profile';

export const loadStoredPlayerProfile = (
  storage: Pick<PlayerProfileStorageLike, 'getItem'>,
  key = PLAYER_PROFILE_STORAGE_KEY,
): StoredPlayerProfile | null => {
  try {
    const raw = JSON.parse(
      storage.getItem(key) ?? 'null',
    ) as Partial<StoredPlayerProfile> | null;
    const playerKey = normalizePlayerKey(raw?.playerKey);

    if (!playerKey) {
      return null;
    }

    return {
      playerKey,
      username:
        normalizeUsername(raw?.username) ?? buildDefaultUsername(playerKey),
      updatedAt:
        typeof raw?.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
          ? raw.updatedAt
          : 0,
    };
  } catch {
    return null;
  }
};

export const saveStoredPlayerProfile = (
  storage: Pick<PlayerProfileStorageLike, 'setItem'>,
  profile: StoredPlayerProfile,
  key = PLAYER_PROFILE_STORAGE_KEY,
): void => {
  try {
    storage.setItem(key, JSON.stringify(profile));
  } catch {
    // Ignore storage failures.
  }
};
