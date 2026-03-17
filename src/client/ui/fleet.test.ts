import { describe, expect, it } from 'vitest';
import type { FleetPurchase } from '../../shared/types';
import { canAddFleetShip, getFleetCartCost, getFleetCartView, getFleetShopTypes, getFleetShopView } from './fleet';

describe('ui fleet helpers', () => {
  it('returns purchasable ship types without orbital bases and sorted by cost', () => {
    const shopTypes = getFleetShopTypes();

    expect(shopTypes.some(([shipType]) => shipType === 'orbitalBase')).toBe(false);
    expect(shopTypes[0][1].cost).toBeLessThanOrEqual(shopTypes[shopTypes.length - 1][1].cost);
  });

  it('calculates cart totals and add eligibility from current credits', () => {
    const cart: FleetPurchase[] = [{ shipType: 'transport' }];

    expect(getFleetCartCost(cart)).toBe(10);
    expect(canAddFleetShip(cart, 40, 'packet')).toBe(true);
    expect(canAddFleetShip(cart, 25, 'corvette')).toBe(false);
  });

  it('builds fleet cart and shop view models with disabled states', () => {
    const cart: FleetPurchase[] = [{ shipType: 'transport' }];
    const cartView = getFleetCartView(cart, 25);
    const shopView = getFleetShopView(cart, 25);

    expect(cartView).toMatchObject({
      remainingCredits: 15,
      remainingLabel: '15 MC remaining',
      isEmpty: false,
    });
    expect(cartView.items).toEqual([{ shipType: 'transport', label: 'Transport' }]);
    expect(shopView.find((item) => item.shipType === 'packet')).toMatchObject({
      disabled: true,
    });
    expect(shopView.find((item) => item.shipType === 'transport')).toMatchObject({
      disabled: false,
      statsText: 'C1D F10',
    });
  });
});
