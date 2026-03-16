import type {
  AstrogationOrder,
  C2S,
  CombatAttack,
  FleetPurchase,
  OrdnanceLaunch,
  OrbitalBaseEmplacement,
} from '../shared/types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const MAX_FLEET_PURCHASES = 64;
const MAX_ASTROGATION_ORDERS = 64;
const MAX_ORDNANCE_LAUNCHES = 64;
const MAX_BASE_EMPLACEMENTS = 32;
const MAX_COMBAT_ATTACKS = 64;
const MAX_ATTACKERS_PER_COMBAT = 16;
const MAX_WEAK_GRAVITY_CHOICES = 64;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isNullableIntegerInRange(value: unknown, min: number, max: number): value is number | null {
  return value === null || isIntegerInRange(value, min, max);
}

function getRandomInt(maxExclusive: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % maxExclusive;
}

function generateRandomString(chars: string, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[getRandomInt(chars.length)];
  }
  return result;
}

function parseFleetPurchases(raw: unknown): FleetPurchase[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_FLEET_PURCHASES) return null;
  const purchases: FleetPurchase[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipType) || item.shipType.length === 0) {
      return null;
    }
    purchases.push({ shipType: item.shipType });
  }
  return purchases;
}

function parseWeakGravityChoices(raw: unknown): Record<string, boolean> | undefined | null {
  if (raw == null) return undefined;
  if (!isObject(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_WEAK_GRAVITY_CHOICES) return null;

  const parsed: Record<string, boolean> = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'boolean') return null;
    parsed[key] = value;
  }
  return parsed;
}

function parseAstrogationOrders(raw: unknown): AstrogationOrder[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ASTROGATION_ORDERS) return null;
  const orders: AstrogationOrder[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipId) || item.shipId.length === 0) {
      return null;
    }
    if (!isNullableIntegerInRange(item.burn, 0, 5)) {
      return null;
    }
    if (item.overload !== undefined && !isNullableIntegerInRange(item.overload, 0, 5)) {
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
}

function parseOrdnanceLaunches(raw: unknown): OrdnanceLaunch[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ORDNANCE_LAUNCHES) return null;
  const launches: OrdnanceLaunch[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipId) || item.shipId.length === 0) {
      return null;
    }
    if (item.ordnanceType !== 'mine' && item.ordnanceType !== 'torpedo' && item.ordnanceType !== 'nuke') {
      return null;
    }
    if (item.torpedoAccel !== undefined && !isNullableIntegerInRange(item.torpedoAccel, 0, 5)) {
      return null;
    }
    if (item.torpedoAccelSteps !== undefined && item.torpedoAccelSteps !== null && item.torpedoAccelSteps !== 1 && item.torpedoAccelSteps !== 2) {
      return null;
    }
    launches.push({
      shipId: item.shipId,
      ordnanceType: item.ordnanceType,
      torpedoAccel: item.torpedoAccel === undefined ? null : item.torpedoAccel,
      torpedoAccelSteps: item.torpedoAccelSteps === undefined ? null : item.torpedoAccelSteps,
    });
  }
  return launches;
}

function parseBaseEmplacements(raw: unknown): OrbitalBaseEmplacement[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_BASE_EMPLACEMENTS) return null;
  const emplacements: OrbitalBaseEmplacement[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isString(item.shipId) || item.shipId.length === 0) {
      return null;
    }
    emplacements.push({ shipId: item.shipId });
  }
  return emplacements;
}

function parseCombatAttacks(raw: unknown): CombatAttack[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_COMBAT_ATTACKS) return null;
  const attacks: CombatAttack[] = [];
  for (const item of raw) {
    if (!isObject(item) || !Array.isArray(item.attackerIds) || !isString(item.targetId) || item.targetId.length === 0) {
      return null;
    }
    if (item.attackerIds.length === 0 || item.attackerIds.length > MAX_ATTACKERS_PER_COMBAT) {
      return null;
    }
    const attackerIds: string[] = [];
    for (const attackerId of item.attackerIds) {
      if (!isString(attackerId) || attackerId.length === 0) {
        return null;
      }
      attackerIds.push(attackerId);
    }
    if (item.targetType !== undefined && item.targetType !== 'ship' && item.targetType !== 'ordnance') {
      return null;
    }
    const rawAttackStrength = item.attackStrength;
    let attackStrength: number | null = null;
    if (rawAttackStrength !== undefined && rawAttackStrength !== null) {
      if (typeof rawAttackStrength !== 'number' || !Number.isInteger(rawAttackStrength) || rawAttackStrength < 1 || rawAttackStrength > 99) {
        return null;
      }
      attackStrength = rawAttackStrength;
    }
    attacks.push({
      attackerIds,
      targetId: item.targetId,
      targetType: item.targetType,
      attackStrength,
    });
  }
  return attacks;
}

export function generateRoomCode(): string {
  return generateRandomString(CODE_CHARS, 5);
}

export function generatePlayerToken(): string {
  return generateRandomString(TOKEN_CHARS, 32);
}

export function isValidPlayerToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
}

export function normalizeScenarioKey(raw: unknown, knownScenarioKeys: readonly string[]): string {
  if (!isString(raw)) {
    return 'biplanetary';
  }
  return knownScenarioKeys.includes(raw) ? raw : 'biplanetary';
}

export function parseCreatePayload(raw: unknown, knownScenarioKeys: readonly string[]): { scenario: string } {
  if (!isObject(raw)) {
    return { scenario: 'biplanetary' };
  }
  return {
    scenario: normalizeScenarioKey(raw.scenario, knownScenarioKeys),
  };
}

export function validateClientMessage(raw: unknown): { ok: true; value: C2S } | { ok: false; error: string } {
  if (!isObject(raw) || !isString(raw.type)) {
    return { ok: false, error: 'Invalid message payload' };
  }

  switch (raw.type) {
    case 'fleetReady': {
      const purchases = parseFleetPurchases(raw.purchases);
      return purchases ? { ok: true, value: { type: 'fleetReady', purchases } } : { ok: false, error: 'Invalid fleet payload' };
    }
    case 'astrogation': {
      const orders = parseAstrogationOrders(raw.orders);
      return orders ? { ok: true, value: { type: 'astrogation', orders } } : { ok: false, error: 'Invalid astrogation payload' };
    }
    case 'ordnance': {
      const launches = parseOrdnanceLaunches(raw.launches);
      return launches ? { ok: true, value: { type: 'ordnance', launches } } : { ok: false, error: 'Invalid ordnance payload' };
    }
    case 'emplaceBase': {
      const emplacements = parseBaseEmplacements(raw.emplacements);
      return emplacements ? { ok: true, value: { type: 'emplaceBase', emplacements } } : { ok: false, error: 'Invalid emplacement payload' };
    }
    case 'combat': {
      const attacks = parseCombatAttacks(raw.attacks);
      return attacks ? { ok: true, value: { type: 'combat', attacks } } : { ok: false, error: 'Invalid combat payload' };
    }
    case 'skipOrdnance':
    case 'beginCombat':
    case 'skipCombat':
    case 'rematch':
      return { ok: true, value: { type: raw.type } };
    case 'ping':
      return typeof raw.t === 'number' && Number.isFinite(raw.t)
        ? { ok: true, value: { type: 'ping', t: raw.t } }
        : { ok: false, error: 'Invalid ping payload' };
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

export interface RoomConfig {
  code: string;
  scenario: string;
  playerTokens: [string, string | null];
  inviteTokens: [string | null, string | null];
}

export interface SeatAssignmentInput {
  presentedToken: string | null;
  disconnectedPlayer: number | null;
  seatOpen: [boolean, boolean];
  playerTokens: [string, string | null];
  inviteTokens: [string | null, string | null];
}

export type SeatAssignmentDecision =
  | { type: 'join'; playerId: 0 | 1; issueNewToken: boolean; consumeInviteToken: boolean }
  | { type: 'reject'; status: number; message: string };

export function resolveSeatAssignment(input: SeatAssignmentInput): SeatAssignmentDecision {
  const { presentedToken, seatOpen, playerTokens, inviteTokens } = input;

  for (const playerId of [0, 1] as const) {
    const expectedToken = playerTokens[playerId];
    if (expectedToken && seatOpen[playerId] && presentedToken === expectedToken) {
      return { type: 'join', playerId, issueNewToken: false, consumeInviteToken: false };
    }
  }

  for (const playerId of [0, 1] as const) {
    const inviteToken = inviteTokens[playerId];
    if (inviteToken && seatOpen[playerId] && presentedToken === inviteToken) {
      return { type: 'join', playerId, issueNewToken: true, consumeInviteToken: true };
    }
  }

  if (presentedToken) {
    return { type: 'reject', status: 403, message: 'Invalid player token' };
  }

  for (const playerId of [0, 1] as const) {
    if (seatOpen[playerId] && playerTokens[playerId] === null && inviteTokens[playerId] === null) {
      return { type: 'join', playerId, issueNewToken: true, consumeInviteToken: false };
    }
  }

  if (seatOpen.some(Boolean)) {
    return { type: 'reject', status: 403, message: 'Join token required' };
  }

  if (input.disconnectedPlayer !== null) {
    return { type: 'reject', status: 409, message: 'Waiting for player reconnection' };
  }

  return { type: 'reject', status: 409, message: 'Game is full' };
}
