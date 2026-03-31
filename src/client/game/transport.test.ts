import { describe, expect, it, vi } from 'vitest';

import { createGame } from '../../shared/engine/game-engine';
import {
  buildSolarSystemMap,
  findBaseHex,
  SCENARIOS,
} from '../../shared/map-data';
import type { GameTransport } from './transport';
import { createLocalTransport, createWebSocketTransport } from './transport';

describe('createLocalTransport', () => {
  it('forwards local astrogation resolutions with the animation callback and prefix', () => {
    const map = buildSolarSystemMap();
    const state = createGame(SCENARIOS.biplanetary, map, 'LOCAL1', findBaseHex);
    const ship = state.ships[0];
    const onResolution = vi.fn();
    const onAnimationComplete = vi.fn();

    const transport = createLocalTransport({
      getState: () => state,
      getPlayerId: () => 0,
      getMap: () => map,
      onResolution,
      onAnimationComplete,
      onTransitionToPhase: vi.fn(),
      onEmplacementResult: vi.fn(),
      onAdvanceToNextAttacker: vi.fn(),
      onFleetReady: vi.fn(),
      onRematch: vi.fn(),
    });

    transport.submitAstrogation([
      {
        shipId: ship.id,
        burn: 0,
        overload: null,
      },
    ]);

    expect(onResolution).toHaveBeenCalledTimes(1);
    expect(onResolution.mock.calls[0]?.[0]).toMatchObject({
      kind: 'movement',
    });
    expect(onResolution.mock.calls[0]?.[1]).toBe(onAnimationComplete);
    expect(onResolution.mock.calls[0]?.[2]).toBe('Local astrogation error:');
  });

  it('no-ops when the local game state is unavailable', () => {
    const onResolution = vi.fn();
    const transport = createLocalTransport({
      getState: () => null,
      getPlayerId: () => 0,
      getMap: () => buildSolarSystemMap(),
      onResolution,
      onAnimationComplete: vi.fn(),
      onTransitionToPhase: vi.fn(),
      onEmplacementResult: vi.fn(),
      onAdvanceToNextAttacker: vi.fn(),
      onFleetReady: vi.fn(),
      onRematch: vi.fn(),
    });

    transport.beginCombat();
    transport.skipCombat();
    transport.submitAstrogation([]);

    expect(onResolution).not.toHaveBeenCalled();
  });
});

describe('createWebSocketTransport', () => {
  it.each<
    [string, (transport: GameTransport) => void, Record<string, unknown>]
  >([
    [
      'submitAstrogation',
      (transport) =>
        transport.submitAstrogation([
          { shipId: 's1', burn: 0, overload: null },
        ]),
      {
        type: 'astrogation',
        orders: [{ shipId: 's1', burn: 0, overload: null }],
      },
    ],
    [
      'submitCombat',
      (transport) =>
        transport.submitCombat([
          {
            attackerIds: ['s1'],
            targetId: 's2',
            targetType: 'ship',
            attackStrength: null,
          },
        ]),
      {
        type: 'combat',
        attacks: [
          {
            attackerIds: ['s1'],
            targetId: 's2',
            targetType: 'ship',
            attackStrength: null,
          },
        ],
      },
    ],
    [
      'submitSingleCombat',
      (transport) =>
        transport.submitSingleCombat({
          attackerIds: ['s1'],
          targetId: 's2',
          targetType: 'ship',
          attackStrength: 1,
        }),
      {
        type: 'combatSingle',
        attack: {
          attackerIds: ['s1'],
          targetId: 's2',
          targetType: 'ship',
          attackStrength: 1,
        },
      },
    ],
    ['endCombat', (transport) => transport.endCombat(), { type: 'endCombat' }],
    [
      'submitOrdnance',
      (transport) =>
        transport.submitOrdnance([
          {
            shipId: 's1',
            ordnanceType: 'torpedo',
            torpedoAccel: 1,
            torpedoAccelSteps: 1,
          },
        ]),
      {
        type: 'ordnance',
        launches: [
          {
            shipId: 's1',
            ordnanceType: 'torpedo',
            torpedoAccel: 1,
            torpedoAccelSteps: 1,
          },
        ],
      },
    ],
    [
      'submitEmplacement',
      (transport) => transport.submitEmplacement([{ shipId: 's1' }]),
      { type: 'emplaceBase', emplacements: [{ shipId: 's1' }] },
    ],
    [
      'submitFleetReady',
      (transport) =>
        transport.submitFleetReady([{ kind: 'ship', shipType: 'corvette' }]),
      {
        type: 'fleetReady',
        purchases: [{ kind: 'ship', shipType: 'corvette' }],
      },
    ],
    [
      'submitLogistics',
      (transport) =>
        transport.submitLogistics([
          {
            sourceShipId: 's1',
            targetShipId: 's2',
            transferType: 'cargo',
            amount: 1,
          },
        ]),
      {
        type: 'logistics',
        transfers: [
          {
            sourceShipId: 's1',
            targetShipId: 's2',
            transferType: 'cargo',
            amount: 1,
          },
        ],
      },
    ],
    [
      'submitSurrender',
      (transport) => transport.submitSurrender(['s1']),
      { type: 'surrender', shipIds: ['s1'] },
    ],
    [
      'skipOrdnance',
      (transport) => transport.skipOrdnance(),
      { type: 'skipOrdnance' },
    ],
    [
      'skipCombat',
      (transport) => transport.skipCombat(),
      { type: 'skipCombat' },
    ],
    [
      'skipLogistics',
      (transport) => transport.skipLogistics(),
      { type: 'skipLogistics' },
    ],
    [
      'beginCombat',
      (transport) => transport.beginCombat(),
      { type: 'beginCombat' },
    ],
    [
      'requestRematch',
      (transport) => transport.requestRematch(),
      { type: 'rematch' },
    ],
    [
      'sendChat',
      (transport) => transport.sendChat('hello'),
      { type: 'chat', text: 'hello' },
    ],
  ])('sends the expected payload for %s', (_label, invoke, expected) => {
    const send = vi.fn();
    const transport = createWebSocketTransport(send);

    invoke(transport);

    expect(send).toHaveBeenCalledWith(expected);
  });
});
