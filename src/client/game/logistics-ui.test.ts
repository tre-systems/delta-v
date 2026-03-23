// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { TransferPair } from '../../shared/engine/logistics';
import type { Ship } from '../../shared/types/domain';
import {
  buildTransferOrders,
  type LogisticsUIState,
  renderTransferPanel,
} from './logistics-ui';

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
  maxFuel: 3,
  maxCargo: 2,
});

const createLogisticsState = (
  overrides?: Partial<LogisticsUIState>,
): LogisticsUIState => {
  const pair = createTransferPair();
  const key = `${pair.source.id}->${pair.target.id}`;

  return {
    pairs: [pair],
    fuelAmounts: new Map([[key, 0]]),
    cargoAmounts: new Map([[key, 0]]),
    ...overrides,
  };
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

    renderTransferPanel(container, {
      pairs: [],
      fuelAmounts: new Map(),
      cargoAmounts: new Map(),
    });

    stalePlusBtn?.click();

    expect(firstState.fuelAmounts.get('ship-0->ship-1')).toBe(0);
    expect(container.textContent).toContain('No transfer-eligible ships');
  });

  it('builds transfer orders from the tracked amounts', () => {
    const pair = createTransferPair();
    const key = `${pair.source.id}->${pair.target.id}`;
    const state = createLogisticsState({
      pairs: [pair],
      fuelAmounts: new Map([[key, 2]]),
      cargoAmounts: new Map([[key, 1]]),
    });

    expect(buildTransferOrders(state)).toEqual([
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
  });
});
