import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestState } from '../../shared/test-helpers';
import * as archive from './archive';
import { type PublicationDeps, runPublicationPipeline } from './publication';

vi.mock('./archive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./archive')>();
  return {
    ...actual,
    appendEnvelopedEvents: vi.fn().mockResolvedValue(undefined),
    getEventStreamLength: vi.fn().mockResolvedValue(0),
    saveCheckpoint: vi.fn().mockResolvedValue(undefined),
  };
});

describe('runPublicationPipeline', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs projection parity check before broadcast and turn timer', async () => {
    const order: string[] = [];
    const state = createTestState();
    const deps: PublicationDeps = {
      storage: {} as DurableObjectStorage,
      env: { DB: {} as D1Database },
      waitUntil: vi.fn(),
      getGameCode: async () => 'ABCDE',
      getRoomConfig: async () => null,
      verifyProjectionParity: async () => {
        order.push('parity');
      },
      broadcastStateChange: () => {
        order.push('broadcast');
      },
      startTurnTimer: async () => {
        order.push('timer');
      },
    };

    await runPublicationPipeline(deps, state, undefined, { events: [] });

    expect(order).toEqual(['parity', 'timer', 'broadcast']);
    expect(archive.getEventStreamLength).toHaveBeenCalled();
    expect(archive.appendEnvelopedEvents).not.toHaveBeenCalled();
  });
});
