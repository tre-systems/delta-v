import { SHIP_STATS } from '../shared/constants';
import type { FleetPurchase } from '../shared/types';

export interface FleetShopItemView {
  shipType: string;
  name: string;
  statsText: string;
  cost: number;
  disabled: boolean;
}

export interface FleetCartItemView {
  shipType: string;
  label: string;
}

export interface FleetCartView {
  remainingCredits: number;
  remainingLabel: string;
  items: FleetCartItemView[];
  isEmpty: boolean;
}

export function getFleetShopTypes() {
  return Object.entries(SHIP_STATS)
    .filter(([shipType]) => shipType !== 'orbitalBase')
    .sort((left, right) => left[1].cost - right[1].cost);
}

export function getFleetCartCost(cart: FleetPurchase[]): number {
  return cart.reduce((total, purchase) => total + (SHIP_STATS[purchase.shipType]?.cost ?? 0), 0);
}

export function canAddFleetShip(cart: FleetPurchase[], totalCredits: number, shipType: string): boolean {
  return getFleetCartCost(cart) + (SHIP_STATS[shipType]?.cost ?? 0) <= totalCredits;
}

export function getFleetCartView(cart: FleetPurchase[], totalCredits: number): FleetCartView {
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
}

export function getFleetShopView(cart: FleetPurchase[], totalCredits: number): FleetShopItemView[] {
  const remainingCredits = totalCredits - getFleetCartCost(cart);
  return getFleetShopTypes().map(([shipType, stats]) => ({
    shipType,
    name: stats.name,
    statsText: `C${stats.combat}${stats.defensiveOnly ? 'D' : ''} F${stats.fuel === Infinity ? '\u221e' : stats.fuel}`,
    cost: stats.cost,
    disabled: stats.cost > remainingCredits,
  }));
}
