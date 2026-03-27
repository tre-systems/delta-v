import { describe, expect, it } from 'vitest';

import type { ReplayTimeline } from '../../shared/replay';
import type { GameState } from '../../shared/types/domain';
import { createReplayController } from './replay-controller';

const createState = (gameId: string): GameState => ({
  gameId,
  scenario: 'duel',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: true,
      targetBody: 'Mars',
      homeBody: 'Terra',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: 'Terra',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ],
  outcome: null,
});

const createTimeline = (gameId: string): ReplayTimeline => ({
  gameId,
  roomCode: 'ABCDE',
  matchNumber: Number(gameId.split('-m')[1] ?? 1),
  scenario: 'duel',
  createdAt: 1,
  entries: [
    {
      sequence: 1,
      recordedAt: 1,
      turn: 1,
      phase: 'astrogation',
      message: {
        type: 'stateUpdate',
        state: createState(gameId),
      },
    },
    {
      sequence: 2,
      recordedAt: 2,
      turn: 2,
      phase: 'combat',
      message: {
        type: 'stateUpdate',
        state: {
          ...createState(gameId),
          turnNumber: 2,
          phase: 'combat',
        },
      },
    },
  ],
});

describe('replay-controller', () => {
  it('shows explicit match selection when a room has rematches', () => {
    const views: unknown[] = [];
    const controller = createReplayController({
      getClientContext: () => ({
        state: 'gameOver',
        isLocalGame: false,
        gameCode: 'ABCDE',
        gameState: createState('ABCDE-m2'),
      }),
      fetchReplay: async () => null,
      setReplayControls: (view) => {
        views.push(view);
      },
      showToast: () => {},
      clearTrails: () => {},
      applyGameState: () => {},
    });

    controller.onGameOverShown();
    controller.selectMatch('prev');

    expect(views.at(-1)).toMatchObject({
      selectedGameId: 'ABCDE-m1',
      canSelectPrevMatch: false,
      canSelectNextMatch: true,
      statusText: 'Selected ABCDE-m1 for replay',
    });
  });

  it('loads a selected replay and restores the live state on exit', async () => {
    const appliedStates: string[] = [];
    const timeline = createTimeline('ABCDE-m1');
    let fetchArgs: [string, string] | null = null;
    const controller = createReplayController({
      getClientContext: () => ({
        state: 'gameOver',
        isLocalGame: false,
        gameCode: 'ABCDE',
        gameState: createState('ABCDE-m2'),
      }),
      fetchReplay: async (code, gameId) => {
        fetchArgs = [code, gameId];
        return timeline;
      },
      setReplayControls: () => {},
      showToast: () => {},
      clearTrails: () => {},
      applyGameState: (state) => {
        appliedStates.push(state.gameId);
      },
    });

    controller.onGameOverShown();
    controller.selectMatch('prev');
    await controller.toggleReplay();
    await controller.toggleReplay();

    expect(fetchArgs).toEqual(['ABCDE', 'ABCDE-m1']);
    expect(appliedStates).toEqual(['ABCDE-m1', 'ABCDE-m2']);
  });
});
