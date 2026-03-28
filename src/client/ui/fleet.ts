import {
  SHIP_STATS,
  type ShipStats,
  type ShipType,
} from '../../shared/constants';
import type { FleetPurchase } from '../../shared/types/domain';
import { sumBy } from '../../shared/util';

export interface FleetShopItemView {
  shipType: ShipType;
  name: string;
  statsText: string;
  cost: number;
  disabled: boolean;
}

export interface FleetCartItemView {
  shipType: ShipType;
  label: string;
}

export interface FleetCartView {
  remainingCredits: number;
  remainingLabel: string;
  items: FleetCartItemView[];
  isEmpty: boolean;
}

export const getFleetShopTypes = (): [ShipType, ShipStats][] => {
  return (Object.entries(SHIP_STATS) as [ShipType, ShipStats][]).sort(
    (left, right) => left[1].cost - right[1].cost,
  );
};

export const getFleetCartCost = (cart: FleetPurchase[]): number => {
  return sumBy(cart, (purchase) =>
    purchase.shipType === 'orbitalBase'
      ? 0
      : (SHIP_STATS[purchase.shipType]?.cost ?? 0),
  );
};

export const canAddFleetShip = (
  cart: FleetPurchase[],
  totalCredits: number,
  shipType: ShipType,
): boolean => {
  const cost =
    shipType === 'orbitalBase' ? 0 : (SHIP_STATS[shipType]?.cost ?? 0);
  return getFleetCartCost(cart) + cost <= totalCredits;
};

export const getFleetCartView = (
  cart: FleetPurchase[],
  totalCredits: number,
): FleetCartView => {
  const remainingCredits = totalCredits - getFleetCartCost(cart);

  return {
    remainingCredits,
    remainingLabel: `${remainingCredits} MC remaining`,
    items: cart.map((purchase) => ({
      shipType: purchase.shipType,
      label: SHIP_STATS[purchase.shipType]?.name ?? purchase.shipType,
    })),
    isEmpty: cart.length === 0,
  };
};

export const getFleetShopView = (
  cart: FleetPurchase[],
  totalCredits: number,
): FleetShopItemView[] => {
  const remainingCredits = totalCredits - getFleetCartCost(cart);

  return getFleetShopTypes().map(([shipType, stats]) => {
    if (shipType === 'orbitalBase') {
      return {
        shipType,
        name: 'Orbital Base Cargo',
        statsText: 'Requires an available transport or packet',
        cost: 0,
        disabled: false,
      };
    }

    return {
      shipType,
      name: stats.name,
      statsText: `C${stats.combat}${stats.defensiveOnly ? 'D' : ''} F${stats.fuel === Infinity ? '\u221e' : stats.fuel}${stats.cargo > 0 ? ` G${stats.cargo}` : ''}`,
      cost: stats.cost,
      disabled: stats.cost > remainingCredits,
    };
  });
};
