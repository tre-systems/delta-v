import { describe, expect, it } from 'vitest';

import type { FleetPurchase } from '../../shared/types/domain';
import {
  canAddFleetPurchase,
  getFleetCartCost,
  getFleetCartView,
  getFleetShopOptions,
  getFleetShopView,
} from './fleet';

describe('ui fleet helpers', () => {
  it('returns purchasable ship types (including orbital base cargo) and sorted by cost', () => {
    const shopOptions = getFleetShopOptions();

    expect(shopOptions).toContain('orbitalBaseCargo');
    expect(shopOptions[0]).toBe('transport');
  });

  it('calculates cart totals and add eligibility from current credits', () => {
    const cart: FleetPurchase[] = [{ kind: 'ship', shipType: 'transport' }];

    expect(getFleetCartCost(cart)).toBe(10);
    expect(
      canAddFleetPurchase(cart, 40, { kind: 'ship', shipType: 'packet' }),
    ).toBe(true);
    expect(
      canAddFleetPurchase(cart, 25, { kind: 'ship', shipType: 'corvette' }),
    ).toBe(false);
  });

  it('builds fleet cart and shop view models with disabled states', () => {
    const cart: FleetPurchase[] = [{ kind: 'ship', shipType: 'transport' }];

    const cartView = getFleetCartView(cart, 25);
    const shopView = getFleetShopView(cart, 25);

    expect(cartView).toMatchObject({
      remainingCredits: 15,
      remainingLabel: '15 MC remaining',
      isEmpty: false,
    });

    expect(cartView.items).toEqual([
      { purchase: { kind: 'ship', shipType: 'transport' }, label: 'Transport' },
    ]);

    expect(
      shopView.find(
        (item) =>
          item.purchase.kind === 'ship' && item.purchase.shipType === 'packet',
      ),
    ).toMatchObject({ disabled: true });

    expect(
      shopView.find(
        (item) =>
          item.purchase.kind === 'ship' &&
          item.purchase.shipType === 'transport',
      ),
    ).toMatchObject({
      disabled: false,
      statsText: 'C1D F10 G50',
    });

    expect(
      shopView.find((item) => item.purchase.kind === 'orbitalBaseCargo'),
    ).toMatchObject({
      cost: 1000,
      disabled: true,
    });
  });

  it('filters the shop to scenario-allowed purchases', () => {
    const shopView = getFleetShopView([], 2000, ['packet', 'orbitalBaseCargo']);

    expect(shopView).toHaveLength(2);
    expect(
      shopView.find(
        (item) =>
          item.purchase.kind === 'ship' && item.purchase.shipType === 'packet',
      ),
    ).toBeTruthy();
    expect(
      shopView.find((item) => item.purchase.kind === 'orbitalBaseCargo'),
    ).toBeTruthy();
  });
});
