import { SHIP_STATS, type ShipType } from './constants';
import type {
  AstrogationOrder,
  C2S,
  CombatAttack,
  FleetPurchase,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  OrdnanceType,
  Result,
  TransferOrder,
} from './types';
import { isObject, isString } from './util';

const isShipType = (value: string): value is ShipType => value in SHIP_STATS;

const ORDNANCE_TYPES = new Set<OrdnanceType>(['mine', 'torpedo', 'nuke']);
const isOrdnanceType = (value: string): value is OrdnanceType =>
  ORDNANCE_TYPES.has(value as OrdnanceType);

const MAX_FLEET_PURCHASES = 64;
const MAX_ASTROGATION_ORDERS = 64;
const MAX_ORDNANCE_LAUNCHES = 64;
const MAX_BASE_EMPLACEMENTS = 32;
const MAX_COMBAT_ATTACKS = 64;
const MAX_ATTACKERS_PER_COMBAT = 16;
const MAX_WEAK_GRAVITY_CHOICES = 64;
const MAX_SURRENDER_SHIPS = 64;
const MAX_TRANSFER_ORDERS = 64;

const isIntegerInRange = (
  value: unknown,
  min: number,
  max: number,
): value is number =>
  Number.isInteger(value) &&
  (value as number) >= min &&
  (value as number) <= max;

const isNullableIntegerInRange = (
  value: unknown,
  min: number,
  max: number,
): value is number | null =>
  value === null || isIntegerInRange(value, min, max);

const parseFleetPurchases = (raw: unknown): FleetPurchase[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_FLEET_PURCHASES) {
    return null;
  }

  const purchases: FleetPurchase[] = [];

  for (const item of raw) {
    if (
      !isObject(item) ||
      !isString(item.shipType) ||
      !isShipType(item.shipType)
    ) {
      return null;
    }

    purchases.push({ shipType: item.shipType });
  }

  return purchases;
};

const parseWeakGravityChoices = (
  raw: unknown,
): Record<string, boolean> | undefined | null => {
  if (raw == null) return undefined;

  if (!isObject(raw)) return null;

  const entries = Object.entries(raw);

  if (entries.length > MAX_WEAK_GRAVITY_CHOICES) {
    return null;
  }

  const parsed: Record<string, boolean> = {};

  for (const [key, value] of entries) {
    if (typeof value !== 'boolean') return null;
    parsed[key] = value;
  }

  return parsed;
};

const parseAstrogationOrders = (raw: unknown): AstrogationOrder[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_ASTROGATION_ORDERS) {
    return null;
  }

  const orders: AstrogationOrder[] = [];

  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipId) || item.shipId.length === 0) {
      return null;
    }

    if (!isNullableIntegerInRange(item.burn, 0, 5)) {
      return null;
    }

    if (
      item.overload !== undefined &&
      !isNullableIntegerInRange(item.overload, 0, 5)
    ) {
      return null;
    }

    const weakGravityChoices = parseWeakGravityChoices(item.weakGravityChoices);

    if (weakGravityChoices === null) {
      return null;
    }

    orders.push({
      shipId: item.shipId,
      burn: item.burn,
      overload: item.overload === undefined ? null : item.overload,
      weakGravityChoices,
    });
  }

  return orders;
};

const parseOrdnanceLaunches = (raw: unknown): OrdnanceLaunch[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_ORDNANCE_LAUNCHES) {
    return null;
  }

  const launches: OrdnanceLaunch[] = [];

  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipId) || item.shipId.length === 0) {
      return null;
    }

    if (!isString(item.ordnanceType) || !isOrdnanceType(item.ordnanceType)) {
      return null;
    }

    if (
      item.torpedoAccel !== undefined &&
      !isNullableIntegerInRange(item.torpedoAccel, 0, 5)
    ) {
      return null;
    }

    if (
      item.torpedoAccelSteps !== undefined &&
      item.torpedoAccelSteps !== null &&
      item.torpedoAccelSteps !== 1 &&
      item.torpedoAccelSteps !== 2
    ) {
      return null;
    }

    launches.push({
      shipId: item.shipId,
      ordnanceType: item.ordnanceType,
      torpedoAccel: item.torpedoAccel === undefined ? null : item.torpedoAccel,
      torpedoAccelSteps:
        item.torpedoAccelSteps === undefined ? null : item.torpedoAccelSteps,
    });
  }

  return launches;
};

const parseBaseEmplacements = (
  raw: unknown,
): OrbitalBaseEmplacement[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_BASE_EMPLACEMENTS) {
    return null;
  }

  const emplacements: OrbitalBaseEmplacement[] = [];

  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipId) || item.shipId.length === 0) {
      return null;
    }

    emplacements.push({ shipId: item.shipId });
  }

  return emplacements;
};

const parseCombatAttacks = (raw: unknown): CombatAttack[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_COMBAT_ATTACKS) {
    return null;
  }

  const attacks: CombatAttack[] = [];

  for (const item of raw) {
    if (
      !isObject(item) ||
      !Array.isArray(item.attackerIds) ||
      !isString(item.targetId) ||
      item.targetId.length === 0
    ) {
      return null;
    }

    if (
      item.attackerIds.length === 0 ||
      item.attackerIds.length > MAX_ATTACKERS_PER_COMBAT
    ) {
      return null;
    }

    const attackerIds: string[] = [];

    for (const attackerId of item.attackerIds) {
      if (!isString(attackerId) || attackerId.length === 0) {
        return null;
      }

      attackerIds.push(attackerId);
    }

    if (
      item.targetType !== undefined &&
      item.targetType !== 'ship' &&
      item.targetType !== 'ordnance'
    ) {
      return null;
    }

    const { attackStrength: rawAttackStrength } = item;
    let attackStrength: number | null = null;

    if (rawAttackStrength !== undefined && rawAttackStrength !== null) {
      if (
        typeof rawAttackStrength !== 'number' ||
        !Number.isInteger(rawAttackStrength) ||
        rawAttackStrength < 1 ||
        rawAttackStrength > 99
      ) {
        return null;
      }

      attackStrength = rawAttackStrength;
    }

    attacks.push({
      attackerIds,
      targetId: item.targetId,
      targetType: item.targetType ?? 'ship',
      attackStrength,
    });
  }

  return attacks;
};

const parseSurrenderShipIds = (raw: unknown): string[] | null => {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > MAX_SURRENDER_SHIPS
  ) {
    return null;
  }

  const ids: string[] = [];

  for (const item of raw) {
    if (!isString(item) || item.length === 0) return null;
    ids.push(item);
  }

  return ids;
};

const parseTransferOrders = (raw: unknown): TransferOrder[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_TRANSFER_ORDERS) {
    return null;
  }

  const transfers: TransferOrder[] = [];

  for (const item of raw) {
    if (!isObject(item)) return null;

    if (!isString(item.sourceShipId) || item.sourceShipId.length === 0) {
      return null;
    }

    if (!isString(item.targetShipId) || item.targetShipId.length === 0) {
      return null;
    }

    if (item.transferType !== 'fuel' && item.transferType !== 'cargo') {
      return null;
    }

    if (
      typeof item.amount !== 'number' ||
      !Number.isInteger(item.amount) ||
      item.amount < 1 ||
      item.amount > 9999
    ) {
      return null;
    }

    transfers.push({
      sourceShipId: item.sourceShipId,
      targetShipId: item.targetShipId,
      transferType: item.transferType,
      amount: item.amount,
    });
  }

  return transfers;
};

export const validateClientMessage = (raw: unknown): Result<C2S> => {
  const ok = (value: C2S) => ({ ok: true as const, value });
  const invalid = (error: string) => ({ ok: false as const, error });
  const fromParsed = <T>(
    parsed: T | null,
    toValue: (value: T) => C2S,
    error: string,
  ) => (parsed ? ok(toValue(parsed)) : invalid(error));

  if (!isObject(raw) || !isString(raw.type)) {
    return invalid('Invalid message payload');
  }

  const message = raw as Record<string, unknown> & {
    type: C2S['type'] | string;
  };

  const validateChat = () => {
    if (!isString(message.text)) {
      return invalid('Invalid chat payload');
    }

    const text = message.text.trim();

    if (text.length === 0 || text.length > 200) {
      return invalid('Invalid chat payload');
    }

    return ok({ type: 'chat', text });
  };

  const validatePing = () =>
    typeof message.t === 'number' && Number.isFinite(message.t)
      ? ok({ type: 'ping', t: message.t })
      : invalid('Invalid ping payload');

  switch (message.type) {
    case 'fleetReady':
      return fromParsed(
        parseFleetPurchases(message.purchases),
        (purchases) => ({ type: 'fleetReady', purchases }),
        'Invalid fleet payload',
      );

    case 'astrogation':
      return fromParsed(
        parseAstrogationOrders(message.orders),
        (orders) => ({ type: 'astrogation', orders }),
        'Invalid astrogation payload',
      );

    case 'ordnance':
      return fromParsed(
        parseOrdnanceLaunches(message.launches),
        (launches) => ({ type: 'ordnance', launches }),
        'Invalid ordnance payload',
      );

    case 'emplaceBase':
      return fromParsed(
        parseBaseEmplacements(message.emplacements),
        (emplacements) => ({ type: 'emplaceBase', emplacements }),
        'Invalid emplacement payload',
      );

    case 'combat':
      return fromParsed(
        parseCombatAttacks(message.attacks),
        (attacks) => ({ type: 'combat', attacks }),
        'Invalid combat payload',
      );

    case 'surrender':
      return fromParsed(
        parseSurrenderShipIds(message.shipIds),
        (shipIds) => ({ type: 'surrender', shipIds }),
        'Invalid surrender payload',
      );

    case 'logistics':
      return fromParsed(
        parseTransferOrders(message.transfers),
        (transfers) => ({ type: 'logistics', transfers }),
        'Invalid logistics payload',
      );

    case 'skipOrdnance':
    case 'beginCombat':
    case 'skipCombat':
    case 'skipLogistics':
    case 'rematch':
      return ok({ type: message.type });

    case 'chat':
      return validateChat();

    case 'ping':
      return validatePing();

    default:
      return invalid('Unknown message type');
  }
};
