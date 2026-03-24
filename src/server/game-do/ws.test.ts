import { describe, expect, it, vi } from 'vitest';

import type { GameState } from '../../shared/types/domain';
import { handleGameDoWebSocketClose } from './ws';

describe('handleGameDoWebSocketClose', () => {
  it('does not set disconnect marker when socket was replaced', async () => {
    const setDisconnectMarker = vi.fn().mockResolvedValue(undefined);

    await handleGameDoWebSocketClose(
      {
        consumeReplacedSocket: () => true,
        getPlayerId: () => 0,
        getCurrentGameState: async () =>
          ({ phase: 'astrogation' }) as GameState,
        setDisconnectMarker,
      },
      {} as WebSocket,
    );

    expect(setDisconnectMarker).not.toHaveBeenCalled();
  });
});
