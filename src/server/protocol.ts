import type {
  AstrogationOrder,
  C2S,
  CombatAttack,
  FleetPurchase,
  OrbitalBaseEmplacement,
  OrdnanceLaunch,
  TransferOrder,
} from '../shared/types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TOKEN_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const MAX_FLEET_PURCHASES = 64;
const MAX_ASTROGATION_ORDERS = 64;
const MAX_ORDNANCE_LAUNCHES = 64;
const MAX_BASE_EMPLACEMENTS = 32;
const MAX_COMBAT_ATTACKS = 64;
const MAX_ATTACKERS_PER_COMBAT = 16;
const MAX_WEAK_GRAVITY_CHOICES = 64;
const MAX_SURRENDER_SHIPS = 64;
const MAX_TRANSFER_ORDERS = 64;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

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

const getRandomInt = (maxExclusive: number): number => {
  // Rejection sampling to avoid modulo bias
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const bytes = new Uint32Array(1);
  let value: number;

  do {
    crypto.getRandomValues(bytes);
    value = bytes[0];
  } while (value >= limit);

  return value % maxExclusive;
};

const generateRandomString = (chars: string, length: number): string =>
  Array.from({ length }, () => chars[getRandomInt(chars.length)]).join('');

const parseFleetPurchases = (raw: unknown): FleetPurchase[] | null => {
  if (!Array.isArray(raw) || raw.length > MAX_FLEET_PURCHASES) {
    return null;
  }

  const purchases: FleetPurchase[] = [];

  for (const item of raw) {
    if (
      !isObject(item) ||
      !isString(item.shipType) ||
      item.shipType.length === 0
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

    if (
      item.ordnanceType !== 'mine' &&
      item.ordnanceType !== 'torpedo' &&
      item.ordnanceType !== 'nuke'
    ) {
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
      targetType: item.targetType,
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

// 32 code chars ^ 5 = ~33.6M possible codes.
// At 12 retries, collision is negligible until
// ~thousands of concurrent active rooms.
export const generateRoomCode = (): string =>
  generateRandomString(CODE_CHARS, 5);

export const generatePlayerToken = (): string =>
  generateRandomString(TOKEN_CHARS, 32);

export const isValidPlayerToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);

export const normalizeScenarioKey = (
  raw: unknown,
  knownScenarioKeys: readonly string[],
): string => {
  if (!isString(raw)) {
    return 'biplanetary';
  }

  return knownScenarioKeys.includes(raw) ? raw : 'biplanetary';
};

export const parseCreatePayload = (
  raw: unknown,
  knownScenarioKeys: readonly string[],
): { scenario: string } => {
  if (!isObject(raw)) {
    return { scenario: 'biplanetary' };
  }

  return {
    scenario: normalizeScenarioKey(raw.scenario, knownScenarioKeys),
  };
};

export interface InitPayload {
  code: string;
  scenario: string;
  playerToken: string;
  inviteToken: string | null;
}

export const parseInitPayload = (
  raw: unknown,
  knownScenarioKeys: readonly string[],
): { ok: true; value: InitPayload } | { ok: false; error: string } => {
  if (!isObject(raw)) {
    return { ok: false, error: 'Invalid init payload' };
  }

  if (typeof raw.code !== 'string' || !/^[A-Z0-9]{5}$/.test(raw.code)) {
    return { ok: false, error: 'Invalid room code' };
  }

  if (
    typeof raw.scenario !== 'string' ||
    !knownScenarioKeys.includes(raw.scenario)
  ) {
    return { ok: false, error: 'Invalid scenario' };
  }

  if (!isValidPlayerToken(raw.playerToken)) {
    return { ok: false, error: 'Invalid player token' };
  }

  const inviteToken =
    raw.inviteToken === undefined || raw.inviteToken === null
      ? null
      : isValidPlayerToken(raw.inviteToken)
        ? raw.inviteToken
        : null;

  return {
    ok: true,
    value: {
      code: raw.code,
      scenario: raw.scenario,
      playerToken: raw.playerToken,
      inviteToken,
    },
  };
};

export const validateClientMessage = (
  raw: unknown,
): { ok: true; value: C2S } | { ok: false; error: string } => {
  if (!isObject(raw) || !isString(raw.type)) {
    return {
      ok: false,
      error: 'Invalid message payload',
    };
  }

  switch (raw.type) {
    case 'fleetReady': {
      const purchases = parseFleetPurchases(raw.purchases);

      return purchases
        ? {
            ok: true,
            value: { type: 'fleetReady', purchases },
          }
        : {
            ok: false,
            error: 'Invalid fleet payload',
          };
    }

    case 'astrogation': {
      const orders = parseAstrogationOrders(raw.orders);

      return orders
        ? {
            ok: true,
            value: { type: 'astrogation', orders },
          }
        : {
            ok: false,
            error: 'Invalid astrogation payload',
          };
    }

    case 'ordnance': {
      const launches = parseOrdnanceLaunches(raw.launches);

      return launches
        ? {
            ok: true,
            value: { type: 'ordnance', launches },
          }
        : {
            ok: false,
            error: 'Invalid ordnance payload',
          };
    }

    case 'emplaceBase': {
      const emplacements = parseBaseEmplacements(raw.emplacements);

      return emplacements
        ? {
            ok: true,
            value: {
              type: 'emplaceBase',
              emplacements,
            },
          }
        : {
            ok: false,
            error: 'Invalid emplacement payload',
          };
    }

    case 'combat': {
      const attacks = parseCombatAttacks(raw.attacks);

      return attacks
        ? {
            ok: true,
            value: { type: 'combat', attacks },
          }
        : {
            ok: false,
            error: 'Invalid combat payload',
          };
    }

    case 'surrender': {
      const shipIds = parseSurrenderShipIds(raw.shipIds);

      return shipIds
        ? {
            ok: true,
            value: { type: 'surrender', shipIds },
          }
        : {
            ok: false,
            error: 'Invalid surrender payload',
          };
    }

    case 'logistics': {
      const transfers = parseTransferOrders(raw.transfers);

      return transfers
        ? {
            ok: true,
            value: { type: 'logistics', transfers },
          }
        : {
            ok: false,
            error: 'Invalid logistics payload',
          };
    }

    case 'skipOrdnance':
    case 'beginCombat':
    case 'skipCombat':
    case 'skipLogistics':
    case 'rematch':
      return { ok: true, value: { type: raw.type } };

    case 'chat': {
      if (
        !isString(raw.text) ||
        raw.text.length === 0 ||
        raw.text.length > 200
      ) {
        return {
          ok: false,
          error: 'Invalid chat payload',
        };
      }

      return {
        ok: true,
        value: { type: 'chat', text: raw.text.trim() },
      };
    }

    case 'ping':
      return typeof raw.t === 'number' && Number.isFinite(raw.t)
        ? {
            ok: true,
            value: { type: 'ping', t: raw.t },
          }
        : {
            ok: false,
            error: 'Invalid ping payload',
          };

    default:
      return { ok: false, error: 'Unknown message type' };
  }
};

export interface RoomConfig {
  code: string;
  scenario: string;
  playerTokens: [string, string | null];
  inviteTokens: [string | null, string | null];
}

export const createRoomConfig = ({
  code,
  scenario,
  playerToken,
  inviteToken,
}: InitPayload): RoomConfig => ({
  code,
  scenario,
  playerTokens: [playerToken, null],
  inviteTokens: [null, inviteToken],
});

export interface SeatAssignmentInput {
  presentedToken: string | null;
  disconnectedPlayer: number | null;
  seatOpen: [boolean, boolean];
  playerTokens: [string, string | null];
  inviteTokens: [string | null, string | null];
}

export type SeatAssignmentDecision =
  | {
      type: 'join';
      playerId: 0 | 1;
      issueNewToken: boolean;
      consumeInviteToken: boolean;
    }
  | {
      type: 'reject';
      status: number;
      message: string;
    };

export const resolveSeatAssignment = (
  input: SeatAssignmentInput,
): SeatAssignmentDecision => {
  const { presentedToken, seatOpen, playerTokens, inviteTokens } = input;

  const seats = [0, 1] as const;

  const tokenMatch = seats.find(
    (p) => playerTokens[p] && seatOpen[p] && presentedToken === playerTokens[p],
  );

  if (tokenMatch !== undefined) {
    return {
      type: 'join',
      playerId: tokenMatch,
      issueNewToken: false,
      consumeInviteToken: false,
    };
  }

  const inviteMatch = seats.find(
    (p) => inviteTokens[p] && seatOpen[p] && presentedToken === inviteTokens[p],
  );

  if (inviteMatch !== undefined) {
    return {
      type: 'join',
      playerId: inviteMatch,
      issueNewToken: true,
      consumeInviteToken: true,
    };
  }

  if (presentedToken) {
    return {
      type: 'reject',
      status: 403,
      message: 'Invalid player token',
    };
  }

  // Tokenless join: allow joining seats that have no
  // invite token. Seat 1 has no invite token by default,
  // so anyone with the room code can join.
  const openSeat = seats.find(
    (p) => seatOpen[p] && playerTokens[p] === null && inviteTokens[p] === null,
  );

  if (openSeat !== undefined) {
    return {
      type: 'join',
      playerId: openSeat,
      issueNewToken: true,
      consumeInviteToken: false,
    };
  }

  if (seatOpen.some(Boolean)) {
    return {
      type: 'reject',
      status: 403,
      message: 'Join token required',
    };
  }

  if (input.disconnectedPlayer !== null) {
    return {
      type: 'reject',
      status: 409,
      message: 'Waiting for player reconnection',
    };
  }

  return {
    type: 'reject',
    status: 409,
    message: 'Game is full',
  };
};
