import { describe, expect, it } from 'vitest';

import type { TransferPair } from '../../shared/engine/logistics';
import type { Ship } from '../../shared/types/domain';
import {
  createLogisticsStoreFromPairs,
  type LogisticsStore,
} from './logistics-store';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
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
  ...overrides,
});

const createTransferPair = (): TransferPair => ({
  source: createShip(),
  target: createShip({ id: 'ship-1' }),
  canTransferFuel: true,
  canTransferCargo: true,
  canTransferPassengers: false,
  maxFuel: 3,
  maxCargo: 2,
  maxPassengers: 0,
});

const createLogisticsState = (
  overrides?: Partial<
    Pick<LogisticsStore, 'fuelAmounts' | 'cargoAmounts' | 'passengerAmounts'>
  >,
): LogisticsStore => {
  const pair = createTransferPair();
  const key = `${pair.source.id}->${pair.target.id}`;
  const state = createLogisticsStoreFromPairs([pair]);

  state.fuelAmounts = overrides?.fuelAmounts ?? new Map([[key, 0]]);
  state.cargoAmounts = overrides?.cargoAmounts ?? new Map([[key, 0]]);
  state.passengerAmounts = overrides?.passengerAmounts ?? new Map([[key, 0]]);

  return state;
};

describe('logistics-store', () => {
  it('builds transfer orders from the tracked amounts', () => {
    const pair = createTransferPair();
    const key = `${pair.source.id}->${pair.target.id}`;
    const state = createLogisticsState({
      fuelAmounts: new Map([[key, 2]]),
      cargoAmounts: new Map([[key, 1]]),
    });

    expect(state.buildTransferOrders()).toEqual([
      {
        sourceShipId: 'ship-0',
        targetShipId: 'ship-1',
        transferType: 'fuel',
        amount: 2,
      },
      {
        sourceShipId: 'ship-0',
        targetShipId: 'ship-1',
        transferType: 'cargo',
        amount: 1,
      },
    ]);
    expect(state.hasQueuedTransfers()).toBe(true);
  });
});
