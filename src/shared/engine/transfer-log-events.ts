import type { LogisticsTransferLogEvent } from '../types/protocol';
import type { EngineEvent } from './engine-events';

/** Strip to the subset safe to send on `stateUpdate` for client game-log lines. */
export const filterLogisticsTransferLogEvents = (
  events: readonly EngineEvent[],
): LogisticsTransferLogEvent[] => {
  const out: LogisticsTransferLogEvent[] = [];

  for (const e of events) {
    if (e.type === 'fuelTransferred') {
      out.push({
        type: 'fuelTransferred',
        fromShipId: e.fromShipId,
        toShipId: e.toShipId,
        amount: e.amount,
      });
    } else if (e.type === 'cargoTransferred') {
      out.push({
        type: 'cargoTransferred',
        fromShipId: e.fromShipId,
        toShipId: e.toShipId,
        amount: e.amount,
      });
    } else if (e.type === 'passengersTransferred') {
      out.push({
        type: 'passengersTransferred',
        fromShipId: e.fromShipId,
        toShipId: e.toShipId,
        amount: e.amount,
      });
    }
  }

  return out;
};
