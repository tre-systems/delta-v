import type { LogisticsTransferLogEvent } from '../types/protocol';
import type { EngineEvent } from './engine-events';

const TRANSFER_TYPES: ReadonlySet<string> = new Set([
  'fuelTransferred',
  'cargoTransferred',
  'passengersTransferred',
]);

/** Strip to the subset safe to send on `stateUpdate` for client game-log lines. */
export const filterLogisticsTransferLogEvents = (
  events: readonly EngineEvent[],
): LogisticsTransferLogEvent[] => {
  const out: LogisticsTransferLogEvent[] = [];

  for (const e of events) {
    if (TRANSFER_TYPES.has(e.type)) {
      const te = e as EngineEvent & {
        fromShipId: string;
        toShipId: string;
        amount: number;
      };
      out.push({
        type: e.type as LogisticsTransferLogEvent['type'],
        fromShipId: te.fromShipId,
        toShipId: te.toShipId,
        amount: te.amount,
      });
    }
  }

  return out;
};
