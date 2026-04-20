import { describe, expect, it } from 'vitest';
import type { GameId } from '../../shared/ids';
import { asGameId } from '../../shared/ids';
import type { ReplayTimeline } from '../../shared/replay';
import type { GameState } from '../../shared/types/domain';
import { TOAST } from '../messages/toasts';
import { createReplayController } from './replay-controller';

const createState = (gameId: GameId): GameState => ({
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

const createTimeline = (gameId: GameId): ReplayTimeline => ({
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
    const controller = createReplayController({
      getClientContext: () => ({
        state: 'gameOver',
        isLocalGame: false,
        gameCode: 'ABCDE',
        gameState: createState(asGameId('ABCDE-m2')),
      }),
      fetchReplay: async () => null,
      showToast: () => {},
      logText: () => {},
      clearTrails: () => {},
      applyGameState: () => {},
      frameOnActivePlayer: () => {},
      presentReplayEntry: (_entry, _previousState, done) => done(),
    });

    controller.onGameOverShown();
    controller.selectMatch('prev');

    expect(controller.controlsSignal.value).toMatchObject({
      selectedGameId: 'ABCDE-m1',
      canSelectPrevMatch: false,
      canSelectNextMatch: true,
      statusText: 'Selected ABCDE-m1 for replay',
    });
  });

  it('loads a selected replay and restores the live state on exit', async () => {
    const appliedStates: string[] = [];
    const timeline = createTimeline(asGameId('ABCDE-m1'));
    let fetchArgs: [string, string] | null = null;
    const controller = createReplayController({
      getClientContext: () => ({
        state: 'gameOver',
        isLocalGame: false,
        gameCode: 'ABCDE',
        gameState: createState(asGameId('ABCDE-m2')),
      }),
      fetchReplay: async (code, gameId) => {
        fetchArgs = [code, gameId];
        return timeline;
      },
      showToast: () => {},
      logText: () => {},
      clearTrails: () => {},
      applyGameState: (state) => {
        appliedStates.push(state.gameId);
      },
      frameOnActivePlayer: () => {},
      presentReplayEntry: (_entry, _previousState, done) => done(),
    });

    controller.onGameOverShown();
    controller.selectMatch('prev');
    await controller.toggleReplay();
    await controller.toggleReplay();

    expect(fetchArgs).toEqual(['ABCDE', 'ABCDE-m1']);
    expect(appliedStates).toEqual(['ABCDE-m1', 'ABCDE-m2']);
  });

  it('seeds archived replay from a pre-fetched timeline and starts at turn 1', () => {
    const appliedStates: string[] = [];
    const framedStates: string[] = [];
    const timeline = createTimeline(asGameId('ABCDE-m1'));
    // Caller is expected to have applied the final state before invoking
    // startArchivedReplay — that becomes the "source" state the replay
    // restores to when closed.
    const finalState = { ...createState(asGameId('ABCDE-m1')), turnNumber: 42 };

    const controller = createReplayController({
      getClientContext: () => ({
        state: 'gameOver',
        isLocalGame: false,
        gameCode: 'ABCDE',
        gameState: finalState,
      }),
      fetchReplay: async () => null,
      showToast: () => {},
      logText: () => {},
      clearTrails: () => {},
      applyGameState: (state) => {
        appliedStates.push(`${state.gameId}#t${state.turnNumber}`);
      },
      frameOnActivePlayer: (state) => {
        framedStates.push(state.gameId);
      },
      presentReplayEntry: (_entry, _previousState, done) => done(),
    });

    controller.startArchivedReplay(timeline);

    // First timeline entry is turn 1; controller should have applied and
    // framed on it.
    expect(appliedStates).toEqual(['ABCDE-m1#t1']);
    expect(framedStates).toEqual(['ABCDE-m1']);
    expect(controller.controlsSignal.value).toMatchObject({
      available: true,
      active: true,
      statusText: 'Turn 1 · P1 ASTROGATION',
      speed: 1,
      progress: 0,
      turnLabel: 'Turn 1/2',
    });
  });

  it('cycles playback speed through 0.5x/1x/2x/4x', () => {
    const timeline = createTimeline(asGameId('ABCDE-m1'));
    const controller = createReplayController({
      getClientContext: () => ({
        state: 'gameOver',
        isLocalGame: false,
        gameCode: 'ABCDE',
        gameState: createState(asGameId('ABCDE-m1')),
      }),
      fetchReplay: async () => null,
      showToast: () => {},
      logText: () => {},
      clearTrails: () => {},
      applyGameState: () => {},
      frameOnActivePlayer: () => {},
      presentReplayEntry: (_entry, _previousState, done) => done(),
    });

    controller.startArchivedReplay(timeline);
    expect(controller.controlsSignal.value.speed).toBe(1);

    controller.cycleSpeed();
    expect(controller.controlsSignal.value.speed).toBe(2);

    controller.cycleSpeed();
    expect(controller.controlsSignal.value.speed).toBe(4);

    controller.cycleSpeed();
    expect(controller.controlsSignal.value.speed).toBe(0.5);

    controller.cycleSpeed();
    expect(controller.controlsSignal.value.speed).toBe(1);
  });

  it('shows a toast and does nothing for an empty archived timeline', () => {
    const toastCalls: Array<{ message: string; type: string }> = [];
    const applied: string[] = [];
    const emptyTimeline = {
      ...createTimeline(asGameId('ABCDE-m1')),
      entries: [],
    };

    const controller = createReplayController({
      getClientContext: () => ({
        state: 'gameOver',
        isLocalGame: false,
        gameCode: 'ABCDE',
        gameState: createState(asGameId('ABCDE-m1')),
      }),
      fetchReplay: async () => null,
      showToast: (message, type) => {
        toastCalls.push({ message, type });
      },
      logText: () => {},
      clearTrails: () => {},
      applyGameState: (state) => applied.push(state.gameId),
      frameOnActivePlayer: () => {},
      presentReplayEntry: (_entry, _previousState, done) => done(),
    });

    controller.startArchivedReplay(emptyTimeline);

    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0].type).toBe('error');
    expect(toastCalls[0].message).toBe(TOAST.sessionController.replayNoEntries);
    expect(applied).toHaveLength(0);
  });
});
