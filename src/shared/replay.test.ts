import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createGame, filterStateForPlayer } from './engine/game-engine';
import { buildSolarSystemMap, findBaseHex, SCENARIOS } from './map-data';
import {
  buildMatchId,
  parseMatchId,
  type ReplayEntry,
  type ReplayMessage,
  type ReplayTimeline,
  toReplayEntry,
} from './replay';
import type { GameState } from './types/domain';

const map = buildSolarSystemMap();
const sharedContractFixtures = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/contracts.json', import.meta.url),
    'utf8',
  ),
) as {
  replay: {
    entry: unknown;
    timeline: unknown;
  };
};

const normalizeReplayShape = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeReplayShape);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === 'state' ? '__STATE__' : normalizeReplayShape(entry),
      ]),
    );
  }

  return value;
};

const createTestState = (
  gameId: string,
  overrides: Partial<GameState> = {},
): GameState => ({
  ...createGame(SCENARIOS.biplanetary, map, gameId, findBaseHex),
  ...overrides,
});

describe('replay shape fixtures', () => {
  it('buildMatchId produces the canonical format', () => {
    expect(buildMatchId('ABCDE', 1)).toBe('ABCDE-m1');
    expect(buildMatchId('ZZZZZ', 42)).toBe('ZZZZZ-m42');
  });

  it('parseMatchId reads the canonical format', () => {
    expect(parseMatchId('ABCDE-m1')).toEqual({
      roomCode: 'ABCDE',
      matchNumber: 1,
    });
    expect(parseMatchId('ZZZZZ-m42')).toEqual({
      roomCode: 'ZZZZZ',
      matchNumber: 42,
    });
    expect(parseMatchId('not-a-match-id')).toBeNull();
  });

  it('ReplayEntry has the expected wire shape', () => {
    const state = createTestState('ENTRY-m1');
    const message: ReplayMessage = {
      type: 'gameStart',
      state,
    };

    const entry = toReplayEntry(1, message, 1700000000000);

    expect(normalizeReplayShape(entry)).toEqual(
      sharedContractFixtures.replay.entry,
    );
  });

  it('ReplayEntry deep-clones the message', () => {
    const state = createTestState('CLONE-m1');
    const message: ReplayMessage = {
      type: 'gameStart',
      state,
    };

    const entry = toReplayEntry(1, message, 0);

    expect(entry.message).not.toBe(message);
    expect(entry.message).toEqual(message);
  });

  it('ReplayTimeline has the expected wire shape', () => {
    const state = createTestState('ARCHV-m1');
    const timeline: ReplayTimeline = {
      gameId: 'ARCHV-m1',
      roomCode: 'ARCHV',
      matchNumber: 1,
      scenario: 'Bi-Planetary',
      createdAt: 1700000000000,
      entries: [
        {
          sequence: 1,
          recordedAt: 1700000000000,
          turn: state.turnNumber,
          phase: state.phase,
          message: { type: 'gameStart', state },
        },
      ],
    };

    expect(normalizeReplayShape(timeline)).toEqual(
      sharedContractFixtures.replay.timeline,
    );
  });

  it('ReplayTimeline entries grow with subsequent messages', () => {
    const state1 = createTestState('GROW-m1');
    const state2 = createTestState('GROW-m1', {
      turnNumber: 2,
      phase: 'astrogation',
      activePlayer: 1,
    });

    const timeline: ReplayTimeline = {
      gameId: 'GROW-m1',
      roomCode: 'GROW',
      matchNumber: 1,
      scenario: state1.scenario,
      createdAt: 1000,
      entries: [toReplayEntry(1, { type: 'gameStart', state: state1 }, 1000)],
    };

    const entry2 = toReplayEntry(
      2,
      { type: 'stateUpdate', state: state2 },
      2000,
    );
    timeline.entries.push(entry2);

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[0].sequence).toBe(1);
    expect(timeline.entries[1].sequence).toBe(2);
    expect(timeline.entries[1].turn).toBe(2);
    expect(timeline.entries[1].phase).toBe('astrogation');
  });

  it('replay response filtered for player strips hidden state', () => {
    const state = createTestState('FILT-m1');

    state.ships[0].identity = {
      hasFugitives: true,
      revealed: false,
    };

    const filtered = filterStateForPlayer(state, 1);

    const ownShipIdentity = filtered.ships.find((s) => s.owner === 1)?.identity;
    const enemyShipIdentity = filtered.ships.find(
      (s) => s.owner === 0,
    )?.identity;

    expect(ownShipIdentity).toBeUndefined();

    if (enemyShipIdentity) {
      expect(enemyShipIdentity.hasFugitives).toBe(false);
    }
  });

  it('all state-bearing S2C types qualify as ReplayMessage', () => {
    const state = createTestState('TYPES-m1');

    const messages: ReplayMessage[] = [
      { type: 'gameStart', state },
      { type: 'stateUpdate', state },
      {
        type: 'movementResult',
        movements: [],
        ordnanceMovements: [],
        events: [],
        state,
      },
      { type: 'combatResult', results: [], state },
    ];

    for (const msg of messages) {
      const entry = toReplayEntry(1, msg, 0);
      expect(entry.message.type).toBe(msg.type);
      expect(entry.message.state).toEqual(state);
    }
  });

  it('ReplayEntry preserves phase and turn from embedded state', () => {
    const entries: ReplayEntry[] = [];
    let seq = 1;

    const phases = [
      'astrogation',
      'ordnance',
      'combat',
      'logistics',
      'gameOver',
    ] as const;

    for (const phase of phases) {
      const state = createTestState('PHASE-m1', {
        turnNumber: seq,
        phase,
      });
      entries.push(
        toReplayEntry(seq, { type: 'stateUpdate', state }, seq * 1000),
      );
      seq++;
    }

    expect(entries.map((e) => e.phase)).toEqual(phases);
    expect(entries.map((e) => e.turn)).toEqual([1, 2, 3, 4, 5]);
  });
});
