import type { AIDifficulty } from '../../shared/ai';
import type { GameState, PlayerId } from '../../shared/types/domain';
import type { Dispose } from '../reactive';
import { effect } from '../reactive';
import type { ClientState } from './phase';

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
  updatedAt: number;
}

type LocalSessionPersistenceContext = {
  isLocalGameSignal: { value: boolean };
  stateSignal: { value: ClientState };
  gameStateSignal: { value: GameState | null };
  playerIdSignal: { value: PlayerId | -1 };
  scenario: string;
  aiDifficulty: AIDifficulty;
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
  let isFirstRun = true;

  return effect(() => {
    const isLocalGame = ctx.isLocalGameSignal.value;
    const clientState = ctx.stateSignal.value;
    const gameState = ctx.gameStateSignal.value;
    const playerId = ctx.playerIdSignal.value;
    const isInitialBlankState =
      !isLocalGame &&
      gameState === null &&
      clientState === 'menu' &&
      playerId === -1;

    if (
      !isLocalGame ||
      !gameState ||
      clientState === 'menu' ||
      clientState === 'gameOver' ||
      (playerId !== 0 && playerId !== 1)
    ) {
      if (isFirstRun && isInitialBlankState) {
        isFirstRun = false;
        return;
      }

      isFirstRun = false;
      deleteStoredLocalGameSession(storage);
      return;
    }

    isFirstRun = false;
    saveStoredLocalGameSession(storage, {
      version: 1,
      scenario: ctx.scenario,
      aiDifficulty: ctx.aiDifficulty,
      playerId,
      gameState,
      updatedAt: now(),
    });
  });
};
