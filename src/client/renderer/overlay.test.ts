import { describe, expect, it, vi } from 'vitest';

import { asOrdnanceId } from '../../shared/ids';
import type { GameState } from '../../shared/types/domain';
import type { AnimationState } from './animation';
import { renderOrdnance } from './overlay';

const createCtx = (): CanvasRenderingContext2D => {
  return {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    shadowBlur: 0,
    shadowColor: '',
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
};

const createState = (overrides: Partial<GameState> = {}): GameState =>
  ({
    gameId: 'test' as GameState['gameId'],
    scenario: 'biplanetary',
    scenarioRules: {},
    escapeMoralVictoryAchieved: false,
    turnNumber: 1,
    phase: 'ordnance',
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
        targetBody: '',
        homeBody: 'Terra',
        bases: [],
        escapeWins: false,
      },
      {
        connected: true,
        ready: true,
        targetBody: '',
        homeBody: 'Mars',
        bases: [],
        escapeWins: false,
      },
    ],
    outcome: null,
    ...overrides,
  }) as GameState;

describe('renderer overlay ordnance', () => {
  it('renders animated ordnance even when the post-movement state has none left', () => {
    const ctx = createCtx();
    const animState: AnimationState = {
      movements: [],
      ordnanceMovements: [
        {
          ordnanceId: asOrdnanceId('ord-1'),
          owner: 0,
          ordnanceType: 'mine',
          from: { q: 0, r: 0 },
          to: { q: 1, r: 0 },
          path: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
          ],
          detonated: false,
        },
      ],
      startTime: 0,
      duration: 1000,
      onComplete: () => {},
    };

    renderOrdnance({
      ctx,
      state: createState(),
      playerId: 0,
      animState,
      hexSize: 28,
      now: 500,
      interpolatePath: () => ({ x: 0, y: 0 }),
      zoom: 1,
    });

    expect(ctx.arc).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });
});
