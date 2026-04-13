import { describe, expect, it, vi } from 'vitest';
import { asPlayerToken, asRoomCode } from '../../shared/ids';
import type { RoomConfig } from '../protocol';
import { getRequiredRematchVotes, handleRematchRequest } from './match';
import { GAME_DO_STORAGE_KEYS } from './storage-keys';

type MockStorage = DurableObjectStorage & {
  data: Map<string, unknown>;
};

const createMockStorage = (): MockStorage => {
  const data = new Map<string, unknown>();

  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    put: vi.fn(async (key: string, value?: unknown) => {
      data.set(key, value);
      return true;
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  } as unknown as MockStorage;
};

const HUMAN_VS_HUMAN_ROOM: RoomConfig = {
  code: asRoomCode('ABCDE'),
  scenario: 'duel',
  playerTokens: [asPlayerToken('A'.repeat(32)), asPlayerToken('B'.repeat(32))],
  players: [
    {
      playerKey: 'player-1',
      username: 'Pilot One',
      kind: 'human',
    },
    {
      playerKey: 'player-2',
      username: 'Pilot Two',
      kind: 'human',
    },
  ],
};

const HUMAN_VS_AGENT_ROOM: RoomConfig = {
  code: asRoomCode('ABCDE'),
  scenario: 'duel',
  playerTokens: [asPlayerToken('A'.repeat(32)), asPlayerToken('B'.repeat(32))],
  players: [
    {
      playerKey: 'player-1',
      username: 'Pilot One',
      kind: 'human',
    },
    {
      playerKey: 'agent_1',
      username: 'Ari Mercer',
      kind: 'agent',
    },
  ],
};

describe('handleRematchRequest', () => {
  it('waits for both players in human-vs-human matches', async () => {
    const storage = createMockStorage();
    const initGame = vi.fn(async () => {});
    const broadcast = vi.fn();

    await handleRematchRequest(
      {
        storage,
        initGame,
        broadcast,
        getRequiredVotes: async () =>
          getRequiredRematchVotes(HUMAN_VS_HUMAN_ROOM),
      },
      0,
    );

    expect(initGame).not.toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledWith(
      GAME_DO_STORAGE_KEYS.rematchRequests,
      [0],
    );
    expect(broadcast).toHaveBeenCalledWith({ type: 'rematchPending' });
  });

  it('starts immediately when the opponent seat is an agent', async () => {
    const storage = createMockStorage();
    const initGame = vi.fn(async () => {});
    const broadcast = vi.fn();

    await handleRematchRequest(
      {
        storage,
        initGame,
        broadcast,
        getRequiredVotes: async () =>
          getRequiredRematchVotes(HUMAN_VS_AGENT_ROOM),
      },
      0,
    );

    expect(initGame).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(
      GAME_DO_STORAGE_KEYS.rematchRequests,
    );
    expect(broadcast).not.toHaveBeenCalled();
  });
});
