import type {
  AstrogationOrder,
  C2S,
  CombatAttack,
  FleetPurchase,
  OrdnanceLaunch,
  OrbitalBaseEmplacement,
} from '../shared/types';

type ValidationOk<T> = { ok: true; value: T };
type ValidationError = { ok: false; error: string };
type ValidationResult<T> = ValidationOk<T> | ValidationError;
type JsonObject = Record<string, unknown>;

const MESSAGE_TYPES = [
  'fleetReady',
  'astrogation',
  'ordnance',
  'emplaceBase',
  'skipOrdnance',
  'beginCombat',
  'combat',
  'skipCombat',
  'rematch',
  'ping',
] as const;

function error(message: string): ValidationError {
  return { ok: false, error: message };
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function expectObject(value: unknown, path: string): ValidationResult<JsonObject> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return error(`Invalid ${path}: expected object, received ${describeValue(value)}`);
  }
  return { ok: true, value: value as JsonObject };
}

function expectArray(value: unknown, path: string): ValidationResult<unknown[]> {
  if (!Array.isArray(value)) {
    return error(`Invalid ${path}: expected array, received ${describeValue(value)}`);
  }
  return { ok: true, value };
}

function expectString(value: unknown, path: string): ValidationResult<string> {
  if (typeof value !== 'string') {
    return error(`Invalid ${path}: expected string, received ${describeValue(value)}`);
  }
  return { ok: true, value };
}

function expectFiniteNumber(value: unknown, path: string): ValidationResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return error(`Invalid ${path}: expected finite number, received ${describeValue(value)}`);
  }
  return { ok: true, value };
}

function expectDirection(value: unknown, path: string): ValidationResult<number | null> {
  if (value === null) return { ok: true, value };
  const n = expectFiniteNumber(value, path);
  if (!n.ok) return n;
  if (!Number.isInteger(n.value) || n.value < 0 || n.value > 5) {
    return error(`Invalid ${path}: expected integer direction 0-5 or null`);
  }
  return { ok: true, value: n.value };
}

function expectNoExtraKeys(
  value: JsonObject,
  allowedKeys: readonly string[],
  path: string,
): ValidationError | null {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return error(`Invalid ${path}: unexpected field "${key}"`);
    }
  }
  return null;
}

function validateFleetPurchase(value: unknown, index: number): ValidationResult<FleetPurchase> {
  const path = `purchases[${index}]`;
  const obj = expectObject(value, path);
  if (!obj.ok) return obj;
  const extra = expectNoExtraKeys(obj.value, ['shipType'], path);
  if (extra) return extra;

  const shipType = expectString(obj.value.shipType, `${path}.shipType`);
  if (!shipType.ok) return shipType;

  return { ok: true, value: { shipType: shipType.value } };
}

function validateAstrogationOrder(value: unknown, index: number): ValidationResult<AstrogationOrder> {
  const path = `orders[${index}]`;
  const obj = expectObject(value, path);
  if (!obj.ok) return obj;
  const extra = expectNoExtraKeys(obj.value, ['shipId', 'burn', 'overload', 'weakGravityChoices'], path);
  if (extra) return extra;

  const shipId = expectString(obj.value.shipId, `${path}.shipId`);
  if (!shipId.ok) return shipId;

  const burn = expectDirection(obj.value.burn, `${path}.burn`);
  if (!burn.ok) return burn;

  const order: AstrogationOrder = { shipId: shipId.value, burn: burn.value };

  if ('overload' in obj.value) {
    const overload = expectDirection(obj.value.overload, `${path}.overload`);
    if (!overload.ok) return overload;
    order.overload = overload.value;
  }

  if ('weakGravityChoices' in obj.value) {
    const weakGravityChoices = expectObject(obj.value.weakGravityChoices, `${path}.weakGravityChoices`);
    if (!weakGravityChoices.ok) return weakGravityChoices;

    const parsedChoices: Record<string, boolean> = {};
    for (const [key, rawChoice] of Object.entries(weakGravityChoices.value)) {
      if (typeof rawChoice !== 'boolean') {
        return error(`Invalid ${path}.weakGravityChoices.${key}: expected boolean, received ${describeValue(rawChoice)}`);
      }
      parsedChoices[key] = rawChoice;
    }
    order.weakGravityChoices = parsedChoices;
  }

  return { ok: true, value: order };
}

function validateOrdnanceLaunch(value: unknown, index: number): ValidationResult<OrdnanceLaunch> {
  const path = `launches[${index}]`;
  const obj = expectObject(value, path);
  if (!obj.ok) return obj;
  const extra = expectNoExtraKeys(obj.value, ['shipId', 'ordnanceType', 'torpedoAccel', 'torpedoAccelSteps'], path);
  if (extra) return extra;

  const shipId = expectString(obj.value.shipId, `${path}.shipId`);
  if (!shipId.ok) return shipId;

  if (obj.value.ordnanceType !== 'mine' && obj.value.ordnanceType !== 'torpedo' && obj.value.ordnanceType !== 'nuke') {
    return error(`Invalid ${path}.ordnanceType: expected "mine", "torpedo", or "nuke"`);
  }

  const launch: OrdnanceLaunch = { shipId: shipId.value, ordnanceType: obj.value.ordnanceType };

  if ('torpedoAccel' in obj.value) {
    const torpedoAccel = expectDirection(obj.value.torpedoAccel, `${path}.torpedoAccel`);
    if (!torpedoAccel.ok) return torpedoAccel;
    launch.torpedoAccel = torpedoAccel.value;
  }

  if ('torpedoAccelSteps' in obj.value) {
    const rawSteps = obj.value.torpedoAccelSteps;
    if (rawSteps !== null && rawSteps !== 1 && rawSteps !== 2) {
      return error(`Invalid ${path}.torpedoAccelSteps: expected 1, 2, or null`);
    }
    launch.torpedoAccelSteps = rawSteps;
  }

  return { ok: true, value: launch };
}

function validateBaseEmplacement(value: unknown, index: number): ValidationResult<OrbitalBaseEmplacement> {
  const path = `emplacements[${index}]`;
  const obj = expectObject(value, path);
  if (!obj.ok) return obj;
  const extra = expectNoExtraKeys(obj.value, ['shipId'], path);
  if (extra) return extra;

  const shipId = expectString(obj.value.shipId, `${path}.shipId`);
  if (!shipId.ok) return shipId;
  return { ok: true, value: { shipId: shipId.value } };
}

function validateCombatAttack(value: unknown, index: number): ValidationResult<CombatAttack> {
  const path = `attacks[${index}]`;
  const obj = expectObject(value, path);
  if (!obj.ok) return obj;
  const extra = expectNoExtraKeys(obj.value, ['attackerIds', 'targetId', 'targetType', 'attackStrength'], path);
  if (extra) return extra;

  const attackerIds = expectArray(obj.value.attackerIds, `${path}.attackerIds`);
  if (!attackerIds.ok) return attackerIds;
  const parsedAttackerIds: string[] = [];
  for (let i = 0; i < attackerIds.value.length; i++) {
    const attackerId = expectString(attackerIds.value[i], `${path}.attackerIds[${i}]`);
    if (!attackerId.ok) return attackerId;
    parsedAttackerIds.push(attackerId.value);
  }

  const targetId = expectString(obj.value.targetId, `${path}.targetId`);
  if (!targetId.ok) return targetId;

  const attack: CombatAttack = {
    attackerIds: parsedAttackerIds,
    targetId: targetId.value,
  };

  if ('targetType' in obj.value) {
    const targetType = obj.value.targetType;
    if (targetType !== 'ship' && targetType !== 'ordnance') {
      return error(`Invalid ${path}.targetType: expected "ship" or "ordnance"`);
    }
    attack.targetType = targetType;
  }

  if ('attackStrength' in obj.value) {
    const rawStrength = obj.value.attackStrength;
    if (rawStrength === null) {
      attack.attackStrength = null;
    } else {
      const attackStrength = expectFiniteNumber(rawStrength, `${path}.attackStrength`);
      if (!attackStrength.ok) return attackStrength;
      attack.attackStrength = attackStrength.value;
    }
  }

  return { ok: true, value: attack };
}

function validateTypeAndNoExtraFields(
  value: JsonObject,
  type: typeof MESSAGE_TYPES[number],
  allowedKeys: readonly string[],
): ValidationError | null {
  if (value.type !== type) {
    return error(`Invalid "type": expected "${type}"`);
  }
  return expectNoExtraKeys(value, allowedKeys, `${type} message`);
}

export function validateC2SMessage(value: unknown): ValidationResult<C2S> {
  const message = expectObject(value, 'message');
  if (!message.ok) return message;

  const type = expectString(message.value.type, 'message.type');
  if (!type.ok) return type;

  switch (type.value) {
    case 'fleetReady': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'fleetReady', ['type', 'purchases']);
      if (fieldError) return fieldError;

      const purchases = expectArray(message.value.purchases, 'fleetReady.purchases');
      if (!purchases.ok) return purchases;

      const parsedPurchases: FleetPurchase[] = [];
      for (let i = 0; i < purchases.value.length; i++) {
        const purchase = validateFleetPurchase(purchases.value[i], i);
        if (!purchase.ok) return purchase;
        parsedPurchases.push(purchase.value);
      }

      return { ok: true, value: { type: 'fleetReady', purchases: parsedPurchases } };
    }

    case 'astrogation': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'astrogation', ['type', 'orders']);
      if (fieldError) return fieldError;

      const orders = expectArray(message.value.orders, 'astrogation.orders');
      if (!orders.ok) return orders;

      const parsedOrders: AstrogationOrder[] = [];
      for (let i = 0; i < orders.value.length; i++) {
        const order = validateAstrogationOrder(orders.value[i], i);
        if (!order.ok) return order;
        parsedOrders.push(order.value);
      }

      return { ok: true, value: { type: 'astrogation', orders: parsedOrders } };
    }

    case 'ordnance': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'ordnance', ['type', 'launches']);
      if (fieldError) return fieldError;

      const launches = expectArray(message.value.launches, 'ordnance.launches');
      if (!launches.ok) return launches;

      const parsedLaunches: OrdnanceLaunch[] = [];
      for (let i = 0; i < launches.value.length; i++) {
        const launch = validateOrdnanceLaunch(launches.value[i], i);
        if (!launch.ok) return launch;
        parsedLaunches.push(launch.value);
      }

      return { ok: true, value: { type: 'ordnance', launches: parsedLaunches } };
    }

    case 'emplaceBase': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'emplaceBase', ['type', 'emplacements']);
      if (fieldError) return fieldError;

      const emplacements = expectArray(message.value.emplacements, 'emplaceBase.emplacements');
      if (!emplacements.ok) return emplacements;

      const parsedEmplacements: OrbitalBaseEmplacement[] = [];
      for (let i = 0; i < emplacements.value.length; i++) {
        const emplacement = validateBaseEmplacement(emplacements.value[i], i);
        if (!emplacement.ok) return emplacement;
        parsedEmplacements.push(emplacement.value);
      }

      return { ok: true, value: { type: 'emplaceBase', emplacements: parsedEmplacements } };
    }

    case 'skipOrdnance': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'skipOrdnance', ['type']);
      if (fieldError) return fieldError;
      return { ok: true, value: { type: 'skipOrdnance' } };
    }

    case 'beginCombat': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'beginCombat', ['type']);
      if (fieldError) return fieldError;
      return { ok: true, value: { type: 'beginCombat' } };
    }

    case 'combat': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'combat', ['type', 'attacks']);
      if (fieldError) return fieldError;

      const attacks = expectArray(message.value.attacks, 'combat.attacks');
      if (!attacks.ok) return attacks;

      const parsedAttacks: CombatAttack[] = [];
      for (let i = 0; i < attacks.value.length; i++) {
        const attack = validateCombatAttack(attacks.value[i], i);
        if (!attack.ok) return attack;
        parsedAttacks.push(attack.value);
      }

      return { ok: true, value: { type: 'combat', attacks: parsedAttacks } };
    }

    case 'skipCombat': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'skipCombat', ['type']);
      if (fieldError) return fieldError;
      return { ok: true, value: { type: 'skipCombat' } };
    }

    case 'rematch': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'rematch', ['type']);
      if (fieldError) return fieldError;
      return { ok: true, value: { type: 'rematch' } };
    }

    case 'ping': {
      const fieldError = validateTypeAndNoExtraFields(message.value, 'ping', ['type', 't']);
      if (fieldError) return fieldError;

      const t = expectFiniteNumber(message.value.t, 'ping.t');
      if (!t.ok) return t;

      return { ok: true, value: { type: 'ping', t: t.value } };
    }

    default:
      return error(`Invalid message.type: unsupported "${type.value}". Expected one of ${MESSAGE_TYPES.join(', ')}`);
  }
}
