// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { TransferPair } from '../../shared/engine/logistics';
import { asShipId } from '../../shared/ids';
import type { Ship } from '../../shared/types/domain';
import {
  createLogisticsStoreFromPairs,
  type LogisticsStore,
} from './logistics-store';
import { renderTransferPanel } from './logistics-ui';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
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
  target: createShip({ id: asShipId('ship-1') }),
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

describe('logistics-ui', () => {
  it('renders a reactive transfer row without recreating the pair element', () => {
    document.body.innerHTML = '<div id="transferPanel"></div>';
    const container = document.getElementById('transferPanel') as HTMLElement;
    const state = createLogisticsState();
    const onChanged = vi.fn();

    renderTransferPanel(container, state, onChanged);

    const pairEl = container.querySelector('.transfer-pair') as HTMLElement;
    const fuelRow = pairEl.querySelector('.transfer-row') as HTMLElement;
    const buttons = fuelRow.querySelectorAll('button');
    const minusBtn = buttons[0] as HTMLButtonElement;
    const plusBtn = buttons[1] as HTMLButtonElement;
    const maxBtn = buttons[2] as HTMLButtonElement;
    const amountEl = fuelRow.querySelector('.transfer-amount') as HTMLElement;

    expect(amountEl.textContent).toBe('0/3');
    expect(minusBtn.disabled).toBe(true);

    plusBtn.click();

    expect(container.querySelector('.transfer-pair')).toBe(pairEl);
    expect(amountEl.textContent).toBe('1/3');
    expect(state.fuelAmounts.get('ship-0->ship-1')).toBe(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(minusBtn.disabled).toBe(false);
    expect(plusBtn.disabled).toBe(false);
    expect(maxBtn.disabled).toBe(false);

    maxBtn.click();

    expect(amountEl.textContent).toBe('3/3');
    expect(state.fuelAmounts.get('ship-0->ship-1')).toBe(3);
    expect(plusBtn.disabled).toBe(true);
    expect(maxBtn.disabled).toBe(true);
  });

  it('disposes stale row listeners when a new state replaces the panel', () => {
    document.body.innerHTML = '<div id="transferPanel"></div>';
    const container = document.getElementById('transferPanel') as HTMLElement;
    const firstState = createLogisticsState();

    renderTransferPanel(container, firstState);

    const stalePlusBtn = container.querySelectorAll('.btn-transfer-adj')[1] as
      | HTMLButtonElement
      | undefined;

    renderTransferPanel(container, createLogisticsStoreFromPairs([]));

    stalePlusBtn?.click();

    expect(firstState.fuelAmounts.get('ship-0->ship-1')).toBe(0);
    expect(container.textContent).toContain(
      'No ships can transfer fuel or cargo at this location this turn.',
    );
  });
});
