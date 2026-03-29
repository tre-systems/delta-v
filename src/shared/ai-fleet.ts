import type { AIDifficulty } from './ai-types';
import {
  isBaseCarrierType,
  isWarshipType,
  SHIP_STATS,
  type ShipType,
} from './constants';
import type {
  FleetPurchase,
  FleetPurchaseOption,
  GameState,
  PlayerId,
  PurchasableShipType,
} from './types';
import { sumBy } from './util';

const DEFAULT_FLEET_PURCHASES = (Object.keys(SHIP_STATS) as ShipType[]).filter(
  (type): type is PurchasableShipType => type !== 'orbitalBase',
);

const COMBAT_FLEET_PRIORITIES: Record<
  AIDifficulty,
  readonly PurchasableShipType[]
> = {
  easy: ['corvette', 'corsair', 'packet', 'transport'],
  normal: ['frigate', 'corsair', 'corvette', 'packet', 'transport'],
  hard: [
    'dreadnaught',
    'frigate',
    'torch',
    'corsair',
    'corvette',
    'packet',
    'transport',
  ],
};

const OBJECTIVE_FLEET_PRIORITIES: Record<
  AIDifficulty,
  readonly PurchasableShipType[]
> = {
  easy: ['packet', 'corvette', 'transport', 'tanker'],
  normal: ['packet', 'corsair', 'corvette', 'transport', 'tanker', 'frigate'],
  hard: ['corsair', 'packet', 'frigate', 'transport', 'tanker', 'corvette'],
};

const usesObjectiveFleet = (state: GameState, playerId: PlayerId): boolean => {
  const player = state.players[playerId];

  return (
    !!player.targetBody ||
    !!state.scenarioRules.targetWinRequiresPassengers ||
    !!state.scenarioRules.checkpointBodies
  );
};

const availablePurchaseShipTypes = (
  remainingPurchases: readonly FleetPurchaseOption[],
): PurchasableShipType[] =>
  remainingPurchases.filter(
    (purchase): purchase is PurchasableShipType =>
      purchase !== 'orbitalBaseCargo',
  );

const scoreCombatFleetPlan = (purchases: FleetPurchase[]): number => {
  const shipTypes = purchases
    .filter(
      (purchase): purchase is Extract<FleetPurchase, { kind: 'ship' }> =>
        purchase.kind === 'ship',
    )
    .map((purchase) => purchase.shipType);

  const ships = shipTypes.map((shipType) => SHIP_STATS[shipType]);
  const totalCombat = sumBy(ships, (stats) => stats.combat);
  const totalCargo = sumBy(ships, (stats) => stats.cargo);
  const totalFuel = sumBy(ships, (stats) =>
    Number.isFinite(stats.fuel) ? stats.fuel : 30,
  );
  const hullCount = ships.length;
  const overloadCount = sumBy(ships, (stats) => (stats.canOverload ? 1 : 0));
  const frigateCount = shipTypes.filter((type) => type === 'frigate').length;
  const corsairCount = shipTypes.filter((type) => type === 'corsair').length;
  const corvetteCount = shipTypes.filter((type) => type === 'corvette').length;
  const torchCount = shipTypes.filter((type) => type === 'torch').length;

  let score =
    totalCombat * 28 +
    hullCount * 18 +
    totalCargo * 0.7 +
    totalFuel * 0.4 +
    overloadCount * 10;

  if (hullCount < 3) {
    score -= (3 - hullCount) * 60;
  }

  if (frigateCount > 0 && corsairCount + corvetteCount > 0) {
    score += 35;
  }

  if (corsairCount >= 3) {
    score += 15;
  }

  if (torchCount > 0 && hullCount === 1) {
    score -= 120;
  }

  return score;
};

const buildOptimizedCombatFleetPurchases = (
  availableShipTypes: readonly PurchasableShipType[],
  difficulty: AIDifficulty,
  credits: number,
): FleetPurchase[] => {
  const purchasableTypes = [...availableShipTypes].sort(
    (left, right) => SHIP_STATS[right].cost - SHIP_STATS[left].cost,
  );
  let bestPurchases: FleetPurchase[] = [];
  let bestScore = -Infinity;

  const getMaxCount = (shipType: PurchasableShipType): number => {
    switch (shipType) {
      case 'dreadnaught':
        return difficulty === 'hard' ? 1 : 0;
      case 'torch':
        return difficulty === 'hard' ? 1 : 0;
      default:
        return Math.floor(credits / SHIP_STATS[shipType].cost);
    }
  };

  const search = (
    index: number,
    remainingCredits: number,
    current: FleetPurchase[],
  ): void => {
    const currentScore = scoreCombatFleetPlan(current);

    if (
      currentScore > bestScore ||
      (currentScore === bestScore && current.length > bestPurchases.length)
    ) {
      bestScore = currentScore;
      bestPurchases = [...current];
    }

    if (index >= purchasableTypes.length) {
      return;
    }

    const shipType = purchasableTypes[index];
    const shipCost = SHIP_STATS[shipType].cost;
    const maxCount = Math.min(
      getMaxCount(shipType),
      Math.floor(remainingCredits / shipCost),
    );

    for (let count = maxCount; count >= 0; count--) {
      for (let i = 0; i < count; i++) {
        current.push({ kind: 'ship', shipType });
      }

      search(index + 1, remainingCredits - count * shipCost, current);

      current.length -= count;
    }
  };

  search(0, credits, []);
  return bestPurchases;
};

const getShipPurchaseCount = (
  purchases: FleetPurchase[],
  shipType: PurchasableShipType,
): number =>
  purchases.filter(
    (purchase) => purchase.kind === 'ship' && purchase.shipType === shipType,
  ).length;

const getFreeBaseCarrierSlots = (
  state: GameState,
  playerId: PlayerId,
  purchases: FleetPurchase[],
): number => {
  const existingSlots = state.ships.filter(
    (ship) =>
      ship.owner === playerId &&
      isBaseCarrierType(ship.type) &&
      ship.baseStatus !== 'carryingBase',
  ).length;
  const plannedCarriers = purchases.filter(
    (purchase) =>
      purchase.kind === 'ship' && isBaseCarrierType(purchase.shipType),
  ).length;
  const plannedBases = purchases.filter(
    (purchase) => purchase.kind === 'orbitalBaseCargo',
  ).length;

  return existingSlots + plannedCarriers - plannedBases;
};

export const buildAIFleetPurchases = (
  state: GameState,
  playerId: PlayerId,
  difficulty: AIDifficulty,
  availableFleetPurchases?: FleetPurchaseOption[],
): FleetPurchase[] => {
  const remainingPurchases =
    availableFleetPurchases ??
    state.scenarioRules.availableFleetPurchases ??
    DEFAULT_FLEET_PURCHASES;
  const available = new Set(remainingPurchases);
  const purchases: FleetPurchase[] = [];
  let remainingCredits = state.players[playerId].credits ?? 0;
  const usesObjectives = usesObjectiveFleet(state, playerId);
  const availableShipTypes = availablePurchaseShipTypes(remainingPurchases);
  const homeBodies = new Set(state.players.map((player) => player.homeBody));
  const marsVenusFleetBattle =
    homeBodies.size === 2 && homeBodies.has('Mars') && homeBodies.has('Venus');
  const warshipOnlyCombatFleet =
    !usesObjectives &&
    marsVenusFleetBattle &&
    !available.has('orbitalBaseCargo') &&
    availableShipTypes.length > 0 &&
    availableShipTypes.every((shipType) => isWarshipType(shipType));

  if (warshipOnlyCombatFleet) {
    return buildOptimizedCombatFleetPurchases(
      availableShipTypes,
      difficulty,
      remainingCredits,
    );
  }

  const priorities = usesObjectives
    ? OBJECTIVE_FLEET_PRIORITIES[difficulty]
    : COMBAT_FLEET_PRIORITIES[difficulty];
  const wantsTanker = !!state.scenarioRules.logisticsEnabled;

  const getMaxCount = (shipType: PurchasableShipType): number => {
    switch (shipType) {
      case 'dreadnaught':
        return difficulty === 'hard' ? 1 : 0;
      case 'torch':
        return difficulty === 'hard' ? 1 : 0;
      case 'tanker':
        return wantsTanker ? 1 : 0;
      case 'transport':
        return usesObjectives || available.has('orbitalBaseCargo') ? 1 : 0;
      default:
        return Number.POSITIVE_INFINITY;
    }
  };

  const tryBuyShip = (shipType: PurchasableShipType): boolean => {
    if (!available.has(shipType)) return false;
    if (getShipPurchaseCount(purchases, shipType) >= getMaxCount(shipType)) {
      return false;
    }
    const cost = SHIP_STATS[shipType].cost;

    if (remainingCredits < cost) return false;

    purchases.push({ kind: 'ship', shipType });
    remainingCredits -= cost;
    return true;
  };

  const tryBuyOrbitalBase = (): boolean => {
    if (!available.has('orbitalBaseCargo')) return false;
    if (remainingCredits < SHIP_STATS.orbitalBase.cost) return false;
    if (getFreeBaseCarrierSlots(state, playerId, purchases) <= 0) return false;

    purchases.push({ kind: 'orbitalBaseCargo' });
    remainingCredits -= SHIP_STATS.orbitalBase.cost;
    return true;
  };

  if (difficulty === 'hard' && available.has('orbitalBaseCargo')) {
    const carrierType = available.has('transport')
      ? 'transport'
      : available.has('packet')
        ? 'packet'
        : null;

    if (
      carrierType != null &&
      getFreeBaseCarrierSlots(state, playerId, purchases) === 0 &&
      remainingCredits >=
        SHIP_STATS.orbitalBase.cost + SHIP_STATS[carrierType].cost
    ) {
      tryBuyShip(carrierType);
    }
    tryBuyOrbitalBase();
  }

  if (wantsTanker && available.has('tanker')) {
    const anchorType = priorities.find(
      (shipType) =>
        shipType !== 'tanker' &&
        shipType !== 'transport' &&
        available.has(shipType) &&
        remainingCredits >= SHIP_STATS[shipType].cost + SHIP_STATS.tanker.cost,
    );

    if (anchorType) {
      tryBuyShip(anchorType);
      tryBuyShip('tanker');
    }
  }

  for (const shipType of priorities) {
    while (tryBuyShip(shipType)) {
      if (
        difficulty !== 'easy' &&
        isBaseCarrierType(shipType) &&
        getFreeBaseCarrierSlots(state, playerId, purchases) > 0
      ) {
        tryBuyOrbitalBase();
      }
    }
  }

  return purchases;
};
