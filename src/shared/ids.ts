declare const __roomCodeBrand: unique symbol;
declare const __playerTokenBrand: unique symbol;
declare const __shipIdBrand: unique symbol;
declare const __ordnanceIdBrand: unique symbol;
declare const __gameIdBrand: unique symbol;

export type RoomCode = string & { readonly [__roomCodeBrand]: never };
export type PlayerToken = string & { readonly [__playerTokenBrand]: never };

const ROOM_CODE_PATTERN = /^[A-Z0-9]{5}$/;
const PLAYER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const asRoomCode = (value: string): RoomCode => value as RoomCode;

export const isRoomCode = (value: unknown): value is RoomCode =>
  typeof value === 'string' && ROOM_CODE_PATTERN.test(value);

export const normalizeRoomCode = (value: unknown): RoomCode | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.toUpperCase();
  return isRoomCode(normalized) ? asRoomCode(normalized) : null;
};

export const asPlayerToken = (value: string): PlayerToken =>
  value as PlayerToken;

export const isPlayerToken = (value: unknown): value is PlayerToken =>
  typeof value === 'string' && PLAYER_TOKEN_PATTERN.test(value);

export const normalizePlayerToken = (value: unknown): PlayerToken | null =>
  isPlayerToken(value) ? value : null;

export type ShipId = string & { readonly [__shipIdBrand]: never };
export const asShipId = (value: string): ShipId => value as ShipId;

export type OrdnanceId = string & { readonly [__ordnanceIdBrand]: never };
export const asOrdnanceId = (value: string): OrdnanceId => value as OrdnanceId;

export type GameId = string & { readonly [__gameIdBrand]: never };
export const asGameId = (value: string): GameId => value as GameId;
