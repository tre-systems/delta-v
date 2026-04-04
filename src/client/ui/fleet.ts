import {
  isBaseCarrierType,
  ORBITAL_BASE_MASS,
  SHIP_STATS,
  type ShipType,
} from '../../shared/constants';
import type {
  FleetPurchase,
  FleetPurchaseOption,
  PurchasableShipType,
  Ship,
} from '../../shared/types/domain';
import {
  isOrbitalBaseCargoPurchase,
  isShipFleetPurchase,
} from '../../shared/types/domain';
import { sumBy } from '../../shared/util';

export interface FleetShopItemView {
  purchase: FleetPurchase;
  name: string;
  statsText: string;
  cost: number;
  disabled: boolean;
}

export interface FleetCartItemView {
  purchase: FleetPurchase;
  label: string;
}

export interface FleetCartView {
  remainingCredits: number;
  remainingLabel: string;
  items: FleetCartItemView[];
  isEmpty: boolean;
}

export type FleetExistingShip = Pick<
  Ship,
  'type' | 'lifecycle' | 'baseStatus' | 'cargoUsed'
>;

const isPurchasableShipType = (
  shipType: ShipType,
): shipType is PurchasableShipType => {
  return shipType !== 'orbitalBase';
};

const DEFAULT_FLEET_PURCHASE_OPTIONS: FleetPurchaseOption[] = [
  ...(Object.keys(SHIP_STATS) as ShipType[])
    .filter(isPurchasableShipType)
    .map((shipType) => [shipType, SHIP_STATS[shipType]] as const)
    .sort((left, right) => left[1].cost - right[1].cost)
    .map(([shipType]) => shipType),
  'orbitalBaseCargo',
];

export const getFleetPurchaseCost = (purchase: FleetPurchase): number =>
  isShipFleetPurchase(purchase)
    ? (SHIP_STATS[purchase.shipType]?.cost ?? 0)
    : SHIP_STATS.orbitalBase.cost;

export const getFleetPurchaseLabel = (purchase: FleetPurchase): string =>
  isShipFleetPurchase(purchase)
    ? (SHIP_STATS[purchase.shipType]?.name ?? purchase.shipType)
    : 'Orbital Base Cargo';

const toFleetPurchase = (option: FleetPurchaseOption): FleetPurchase =>
  option === 'orbitalBaseCargo'
    ? { kind: 'orbitalBaseCargo' }
    : { kind: 'ship', shipType: option };

export const getFleetShopOptions = (
  availableFleetPurchases?: FleetPurchaseOption[],
): FleetPurchaseOption[] =>
  availableFleetPurchases
    ? [...availableFleetPurchases]
    : DEFAULT_FLEET_PURCHASE_OPTIONS;

export const getFleetCartCost = (cart: FleetPurchase[]): number => {
  return sumBy(cart, getFleetPurchaseCost);
};

export const hasFleetShipsAfterPurchases = (
  cart: FleetPurchase[],
  existingShips: readonly FleetExistingShip[] = [],
): boolean => {
  return (
    existingShips.some((ship) => ship.lifecycle !== 'destroyed') ||
    cart.some(isShipFleetPurchase)
  );
};

const countAvailableBaseCarrierSlots = (
  cart: FleetPurchase[],
  existingShips: readonly FleetExistingShip[],
): number => {
  let slots = existingShips.filter((ship) => {
    if (ship.lifecycle === 'destroyed') return false;
    if (!isBaseCarrierType(ship.type) || ship.baseStatus) return false;
    return SHIP_STATS[ship.type].cargo - ship.cargoUsed >= ORBITAL_BASE_MASS;
  }).length;

  for (const purchase of cart) {
    if (isShipFleetPurchase(purchase) && isBaseCarrierType(purchase.shipType)) {
      slots++;
      continue;
    }

    if (isOrbitalBaseCargoPurchase(purchase)) {
      slots--;
    }
  }

  return slots;
};

export const canAddFleetPurchase = (
  cart: FleetPurchase[],
  totalCredits: number,
  purchase: FleetPurchase,
  existingShips: readonly FleetExistingShip[] = [],
): boolean => {
  if (getFleetCartCost(cart) + getFleetPurchaseCost(purchase) > totalCredits) {
    return false;
  }

  if (isOrbitalBaseCargoPurchase(purchase)) {
    return countAvailableBaseCarrierSlots(cart, existingShips) > 0;
  }

  return true;
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
      purchase,
      label: getFleetPurchaseLabel(purchase),
    })),
    isEmpty: cart.length === 0,
  };
};

export const getFleetShopView = (
  cart: FleetPurchase[],
  totalCredits: number,
  availableFleetPurchases?: FleetPurchaseOption[],
  existingShips: readonly FleetExistingShip[] = [],
): FleetShopItemView[] => {
  return getFleetShopOptions(availableFleetPurchases).map((option) => {
    const purchase = toFleetPurchase(option);

    if (isOrbitalBaseCargoPurchase(purchase)) {
      return {
        purchase,
        name: 'Orbital Base Cargo',
        statsText: 'Requires an available transport or packet',
        cost: SHIP_STATS.orbitalBase.cost,
        disabled: !canAddFleetPurchase(
          cart,
          totalCredits,
          purchase,
          existingShips,
        ),
      };
    }

    const stats = SHIP_STATS[purchase.shipType];

    return {
      purchase,
      name: stats.name,
      statsText: `C${stats.combat}${stats.defensiveOnly ? 'D' : ''} F${stats.fuel === Infinity ? '\u221e' : stats.fuel}${stats.cargo > 0 ? ` G${stats.cargo}` : ''}`,
      cost: stats.cost,
      disabled: !canAddFleetPurchase(
        cart,
        totalCredits,
        purchase,
        existingShips,
      ),
    };
  });
};
