import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameOrThrow } from '../../shared/engine/game-engine';
import { asGameId, asShipId } from '../../shared/ids';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type {
  AstrogationOrder,
  CombatAttack,
  GameState,
  OrdnanceLaunch,
  TransferOrder,
} from '../../shared/types/domain';

const aiMocks = vi.hoisted(() => ({
  aiAstrogation: vi.fn(),
  aiCombat: vi.fn(),
  aiLogistics: vi.fn(),
  aiOrdnance: vi.fn(),
  buildAIFleetPurchases: vi.fn(),
}));

vi.mock('../../shared/ai', () => ({
  aiAstrogation: aiMocks.aiAstrogation,
  aiCombat: aiMocks.aiCombat,
  aiLogistics: aiMocks.aiLogistics,
  aiOrdnance: aiMocks.aiOrdnance,
  buildAIFleetPurchases: aiMocks.buildAIFleetPurchases,
}));

import { buildBotAction } from './bot';

const map = buildSolarSystemMap();

const createState = (phase: GameState['phase']): GameState => {
  const state = createGameOrThrow(
    SCENARIOS.duel,
    map,
    asGameId('BOT01'),
    findBaseHex,
    () => 0,
  );
  state.phase = phase;
  return state;
};

describe('buildBotAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null in waiting and game-over phases', () => {
    expect(buildBotAction(createState('waiting'), 0, map)).toBeNull();
    expect(buildBotAction(createState('gameOver'), 0, map)).toBeNull();
  });

  it('builds fleet purchases during fleet building', () => {
    aiMocks.buildAIFleetPurchases.mockReturnValue([
      { kind: 'ship', shipType: 'frigate' },
    ]);

    expect(buildBotAction(createState('fleetBuilding'), 0, map)).toEqual({
      type: 'fleetReady',
      purchases: [{ kind: 'ship', shipType: 'frigate' }],
    });
  });

  it('uses AI astrogation orders when available', () => {
    const orders: AstrogationOrder[] = [
      { shipId: asShipId('p0s0'), burn: 2, overload: null },
    ];
    aiMocks.aiAstrogation.mockReturnValue(orders);

    expect(buildBotAction(createState('astrogation'), 0, map)).toEqual({
      type: 'astrogation',
      orders,
    });
  });

  it('falls back to idle astrogation orders when AI has none', () => {
    const state = createState('astrogation');
    state.ships[0].lifecycle = 'destroyed';
    aiMocks.aiAstrogation.mockReturnValue([]);

    expect(buildBotAction(state, 0, map)).toEqual({
      type: 'astrogation',
      orders: [],
    });
    expect(aiMocks.aiAstrogation).toHaveBeenCalledWith(state, 0, map, 'hard');
  });

  it('uses ordnance launches when available and otherwise skips ordnance', () => {
    const launches: OrdnanceLaunch[] = [
      {
        shipId: asShipId('p0s0'),
        ordnanceType: 'mine',
        torpedoAccel: null,
        torpedoAccelSteps: null,
      },
    ];
    aiMocks.aiOrdnance.mockReturnValueOnce(launches).mockReturnValueOnce([]);

    expect(buildBotAction(createState('ordnance'), 0, map)).toEqual({
      type: 'ordnance',
      launches,
    });
    expect(buildBotAction(createState('ordnance'), 0, map)).toEqual({
      type: 'skipOrdnance',
    });
  });

  it('begins combat when it owns a pending asteroid hazard', () => {
    const state = createState('combat');
    state.pendingAsteroidHazards.push({
      shipId: state.ships[0].id,
      hex: { ...state.ships[0].position },
    });

    expect(buildBotAction(state, 0, map)).toEqual({
      type: 'beginCombat',
    });
    expect(aiMocks.aiCombat).not.toHaveBeenCalled();
  });

  it('uses combat attacks when available and otherwise skips combat', () => {
    const attacks: CombatAttack[] = [
      {
        attackerIds: [asShipId('p0s0')],
        targetId: asShipId('p1s0'),
        targetType: 'ship',
        attackStrength: 1,
      },
    ];
    aiMocks.aiCombat.mockReturnValueOnce(attacks).mockReturnValueOnce([]);

    expect(buildBotAction(createState('combat'), 0, map)).toEqual({
      type: 'combat',
      attacks,
    });
    expect(buildBotAction(createState('combat'), 0, map)).toEqual({
      type: 'skipCombat',
    });
  });

  it('uses logistics transfers when available and otherwise skips logistics', () => {
    const transfers: TransferOrder[] = [
      {
        sourceShipId: asShipId('p0s0'),
        targetShipId: asShipId('p0s1'),
        transferType: 'fuel',
        amount: 1,
      },
    ];
    aiMocks.aiLogistics.mockReturnValueOnce(transfers).mockReturnValueOnce([]);

    expect(buildBotAction(createState('logistics'), 0, map)).toEqual({
      type: 'logistics',
      transfers,
    });
    expect(buildBotAction(createState('logistics'), 0, map)).toEqual({
      type: 'skipLogistics',
    });
  });
});
