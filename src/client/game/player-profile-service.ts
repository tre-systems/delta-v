import {
  buildDefaultUsername,
  normalizePlayerKey,
  normalizeUsername,
  type PublicPlayerProfile,
} from '../../shared/player';
import {
  deleteStoredPlayerProfile,
  loadStoredPlayerProfile,
  type PlayerProfileStorageLike,
  type StoredPlayerProfile,
  saveStoredPlayerProfile,
} from './player-profile-store';

export interface PlayerProfileService {
  getProfile: () => PublicPlayerProfile;
  setUsername: (username: string) => PublicPlayerProfile;
  restoreProfile: (profile: PublicPlayerProfile) => PublicPlayerProfile;
  resetProfile: () => PublicPlayerProfile;
}

export interface PlayerProfileServiceDeps {
  storage: PlayerProfileStorageLike;
  createPlayerKey?: () => string;
  now?: () => number;
}

const createGeneratedPlayerKey = (): string => {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }

  return Math.random().toString(36).slice(2, 18);
};

export const createPlayerProfileService = (
  deps: PlayerProfileServiceDeps,
): PlayerProfileService => {
  const now = deps.now ?? (() => Date.now());
  const createPlayerKey = deps.createPlayerKey ?? createGeneratedPlayerKey;

  const ensureProfile = (): StoredPlayerProfile => {
    const existing = loadStoredPlayerProfile(deps.storage);

    if (existing) {
      return existing;
    }

    const playerKey = createPlayerKey();
    const profile: StoredPlayerProfile = {
      playerKey,
      username: buildDefaultUsername(playerKey),
      updatedAt: now(),
    };
    saveStoredPlayerProfile(deps.storage, profile);
    return profile;
  };

  const persistProfile = (
    profile: StoredPlayerProfile,
  ): StoredPlayerProfile => {
    saveStoredPlayerProfile(deps.storage, profile);
    return profile;
  };

  return {
    getProfile: () => {
      const profile = ensureProfile();
      return {
        playerKey: profile.playerKey,
        username: profile.username,
      };
    },
    setUsername: (username) => {
      const profile = ensureProfile();
      const nextUsername =
        normalizeUsername(username) ?? buildDefaultUsername(profile.playerKey);
      const saved = persistProfile({
        ...profile,
        username: nextUsername,
        updatedAt: now(),
      });
      return {
        playerKey: saved.playerKey,
        username: saved.username,
      };
    },
    restoreProfile: (profile) => {
      const playerKey = normalizePlayerKey(profile.playerKey);
      if (!playerKey) {
        const current = ensureProfile();
        return {
          playerKey: current.playerKey,
          username: current.username,
        };
      }

      const saved = persistProfile({
        playerKey,
        username:
          normalizeUsername(profile.username) ??
          buildDefaultUsername(playerKey),
        updatedAt: now(),
      });
      return {
        playerKey: saved.playerKey,
        username: saved.username,
      };
    },
    resetProfile: () => {
      deleteStoredPlayerProfile(deps.storage);
      const profile = ensureProfile();
      return {
        playerKey: profile.playerKey,
        username: profile.username,
      };
    },
  };
};
