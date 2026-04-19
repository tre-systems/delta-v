import { describe, expect, it } from 'vitest';

import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import { signal } from '../reactive';
import {
  attachLocalGameSessionPersistence,
  deleteStoredLocalGameSession,
  LOCAL_GAME_SESSION_STORAGE_KEY,
  type LocalSessionStorageLike,
  loadStoredLocalGameSession,
  type StoredLocalGameSession,
  saveStoredLocalGameSession,
} from './local-session-store';

const createStorage = (): LocalSessionStorageLike & {
  data: Map<string, string>;
} => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const createSnapshot = (): StoredLocalGameSession => ({
  version: 1,
  scenario: 'duel',
  aiDifficulty: 'normal',
  playerId: 0,
  updatedAt: 1234,
  gameState: createGameOrThrow(
    SCENARIOS.duel,
    buildSolarSystemMap(),
    asGameId('LOCAL'),
    findBaseHex,
  ),
});

describe('local-session-store', () => {
  it('loads a stored local game snapshot', () => {
    const storage = createStorage();
    const snapshot = createSnapshot();

    saveStoredLocalGameSession(storage, snapshot);

    expect(loadStoredLocalGameSession(storage)).toEqual(snapshot);
  });

  it('returns null for malformed snapshots', () => {
    const storage = createStorage();
    storage.setItem(
      LOCAL_GAME_SESSION_STORAGE_KEY,
      JSON.stringify({ version: 1, scenario: 'duel', playerId: 0 }),
    );

    expect(loadStoredLocalGameSession(storage)).toBeNull();
  });

  it('deletes stored snapshots', () => {
    const storage = createStorage();
    saveStoredLocalGameSession(storage, createSnapshot());

    deleteStoredLocalGameSession(storage);

    expect(storage.getItem(LOCAL_GAME_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('persists active local games and clears on menu or game over', () => {
    const storage = createStorage();
    const gameState = createSnapshot().gameState;
    const ctx = {
      isLocalGameSignal: signal(false),
      stateSignal: signal<'menu' | 'playing_astrogation' | 'gameOver'>('menu'),
      gameStateSignal: signal<typeof gameState | null>(null),
      playerIdSignal: signal<0 | 1 | -1>(-1),
      scenario: 'duel',
      aiDifficulty: 'hard' as const,
    };

    const dispose = attachLocalGameSessionPersistence(storage, ctx, () => 999);

    expect(loadStoredLocalGameSession(storage)).toBeNull();

    ctx.isLocalGameSignal.value = true;
    ctx.playerIdSignal.value = 1;
    ctx.gameStateSignal.value = gameState;
    ctx.stateSignal.value = 'playing_astrogation';

    expect(loadStoredLocalGameSession(storage)).toMatchObject({
      scenario: 'duel',
      aiDifficulty: 'hard',
      playerId: 1,
      updatedAt: 999,
    });

    ctx.stateSignal.value = 'gameOver';
    expect(loadStoredLocalGameSession(storage)).toBeNull();

    dispose();
  });

  it('preserves a pre-existing snapshot on the initial blank startup tick', () => {
    const storage = createStorage();
    const snapshot = createSnapshot();
    saveStoredLocalGameSession(storage, snapshot);

    const ctx = {
      isLocalGameSignal: signal(false),
      stateSignal: signal<'menu' | 'playing_astrogation' | 'gameOver'>('menu'),
      gameStateSignal: signal<typeof snapshot.gameState | null>(null),
      playerIdSignal: signal<0 | 1 | -1>(-1),
      scenario: 'duel',
      aiDifficulty: 'hard' as const,
    };

    const dispose = attachLocalGameSessionPersistence(storage, ctx, () => 999);

    expect(loadStoredLocalGameSession(storage)).toEqual(snapshot);

    ctx.isLocalGameSignal.value = true;
    ctx.playerIdSignal.value = snapshot.playerId;
    ctx.gameStateSignal.value = snapshot.gameState;
    ctx.stateSignal.value = 'playing_astrogation';

    expect(loadStoredLocalGameSession(storage)).toMatchObject({
      updatedAt: 999,
    });

    ctx.isLocalGameSignal.value = false;
    ctx.playerIdSignal.value = -1;
    ctx.gameStateSignal.value = null;
    ctx.stateSignal.value = 'menu';

    expect(loadStoredLocalGameSession(storage)).toBeNull();

    dispose();
  });
});
