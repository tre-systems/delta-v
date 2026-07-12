import { describe, expect, it, vi } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import type { GameState, Ship } from '../../shared/types/domain';
import { drawShipsLayer } from './ships';

const createShip = (id: string): Ship => ({
  id: asShipId(id),
  type: 'packet',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active',
  control: 'own',
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
});

const createState = (): GameState => ({
  gameId: asGameId('LOCAL'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [createShip('a'), createShip('b')],
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

const createContext = () =>
  ({
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;

describe('ship-layer fleet affordances', () => {
  it('keeps stack badges and fleet rings readable when zoomed out', () => {
    const ctx = createContext();
    const arc = vi.mocked(ctx.arc);
    const fillText = vi.mocked(ctx.fillText);
    const setLineDash = vi.mocked(ctx.setLineDash);

    drawShipsLayer({
      ctx,
      state: createState(),
      map: null,
      now: 0,
      playerId: 0,
      planningSelectedShipId: 'b',
      planningSelectedShipIds: new Set(['a', 'b']),
      hexSize: 28,
      animState: null,
      zoom: 0.25,
    });

    expect(setLineDash).toHaveBeenCalledWith([16, 12]);
    expect(arc).toHaveBeenCalledWith(-8, 0, 54, 0, Math.PI * 2);
    expect(arc).toHaveBeenLastCalledWith(60, -60, 32, 0, Math.PI * 2);
    expect(fillText).toHaveBeenLastCalledWith('2', 60, -58);
    expect(ctx.font).toBe('bold 44px system-ui, sans-serif');
    expect(ctx.lineWidth).toBe(6);
  });
});
