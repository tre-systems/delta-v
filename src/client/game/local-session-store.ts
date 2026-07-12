import type { AIDifficulty } from '../../shared/ai';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { Dispose } from '../reactive';
import { effect } from '../reactive';
import type { ClientState } from './phase';
import type { OnboardingEntry } from './session-model';

export interface LocalSessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?: (key: string) => void;
}

export interface StoredLocalGameSession {
  version: 1;
  scenario: string;
  aiDifficulty: AIDifficulty;
  playerId: PlayerId;
  gameState: GameState;
  onboardingEntry?: Extract<OnboardingEntry, 'training'>;
  updatedAt: number;
}

type LocalSessionPersistenceContext = {
  isLocalGameSignal: { value: boolean };
  stateSignal: { value: ClientState };
  gameStateSignal: { value: GameState | null };
  playerIdSignal: { value: PlayerId | -1 };
  scenario: string;
  aiDifficulty: AIDifficulty;
  onboardingEntry?: OnboardingEntry | null;
};

const AI_DIFFICULTIES = new Set<AIDifficulty>(['easy', 'normal', 'hard']);

export const LOCAL_GAME_SESSION_STORAGE_KEY = 'delta-v:local-game';

const isStoredLocalGameSession = (
  value: unknown,
): value is StoredLocalGameSession => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StoredLocalGameSession>;

  return (
    candidate.version === 1 &&
    typeof candidate.scenario === 'string' &&
    AI_DIFFICULTIES.has(candidate.aiDifficulty as AIDifficulty) &&
    (candidate.onboardingEntry === undefined ||
      candidate.onboardingEntry === 'training') &&
    (candidate.playerId === 0 || candidate.playerId === 1) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt) &&
    !!candidate.gameState &&
    typeof candidate.gameState === 'object' &&
    candidate.gameState.scenario === candidate.scenario &&
    typeof candidate.gameState.phase === 'string'
  );
};

export const loadStoredLocalGameSession = (
  storage: Pick<LocalSessionStorageLike, 'getItem'>,
  key = LOCAL_GAME_SESSION_STORAGE_KEY,
): StoredLocalGameSession | null => {
  try {
    const raw = JSON.parse(storage.getItem(key) ?? 'null') as unknown;
    return isStoredLocalGameSession(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const saveStoredLocalGameSession = (
  storage: Pick<LocalSessionStorageLike, 'setItem'>,
  snapshot: StoredLocalGameSession,
  key = LOCAL_GAME_SESSION_STORAGE_KEY,
): void => {
  try {
    storage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures.
  }
};

export const deleteStoredLocalGameSession = (
  storage: Pick<LocalSessionStorageLike, 'removeItem'>,
  key = LOCAL_GAME_SESSION_STORAGE_KEY,
): void => {
  try {
    storage.removeItem?.(key);
  } catch {
    // Ignore storage failures.
  }
};

export const attachLocalGameSessionPersistence = (
  storage: LocalSessionStorageLike,
  ctx: LocalSessionPersistenceContext,
  now: () => number = () => Date.now(),
): Dispose => {
  // Only a session that actually ran a local game may delete the stored
  // save. Without this guard, booting into any non-local surface (a
  // friend's ?code= invite, spectating, an archived replay link) would
  // silently destroy an in-progress local campaign save.
  let hadActiveLocalGame = false;

  return effect(() => {
    const isLocalGame = ctx.isLocalGameSignal.value;
    const clientState = ctx.stateSignal.value;
    const gameState = ctx.gameStateSignal.value;
    const playerId = ctx.playerIdSignal.value;

    if (
      !isLocalGame ||
      !gameState ||
      clientState === 'menu' ||
      clientState === 'gameOver' ||
      (playerId !== 0 && playerId !== 1)
    ) {
      // Legitimate deletion: a local game ran this session and has now
      // completed (gameOver) or been deliberately left (back to menu, or
      // into a network game). A session that never went local leaves the
      // save untouched.
      if (hadActiveLocalGame) {
        hadActiveLocalGame = false;
        deleteStoredLocalGameSession(storage);
      }
      return;
    }

    hadActiveLocalGame = true;
    saveStoredLocalGameSession(storage, {
      version: 1,
      scenario: ctx.scenario,
      aiDifficulty: ctx.aiDifficulty,
      playerId,
      gameState,
      ...(ctx.onboardingEntry === 'training'
        ? { onboardingEntry: 'training' as const }
        : {}),
      updatedAt: now(),
    });
  });
};
