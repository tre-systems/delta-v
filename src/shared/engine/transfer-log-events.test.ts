import { describe, expect, it } from 'vitest';

import { filterLogisticsTransferLogEvents } from './transfer-log-events';

describe('filterLogisticsTransferLogEvents', () => {
  it('keeps only fuel, cargo, and passenger transfer events', () => {
    expect(
      filterLogisticsTransferLogEvents([
        { type: 'turnAdvanced', turn: 2, activePlayer: 1 },
        {
          type: 'fuelTransferred',
          fromShipId: 'a',
          toShipId: 'b',
          amount: 3,
        },
        {
          type: 'cargoTransferred',
          fromShipId: 'a',
          toShipId: 'b',
          amount: 2,
        },
        {
          type: 'passengersTransferred',
          fromShipId: 'a',
          toShipId: 'b',
          amount: 1,
        },
      ]),
    ).toEqual([
      {
        type: 'fuelTransferred',
        fromShipId: 'a',
        toShipId: 'b',
        amount: 3,
      },
      {
        type: 'cargoTransferred',
        fromShipId: 'a',
        toShipId: 'b',
        amount: 2,
      },
      {
        type: 'passengersTransferred',
        fromShipId: 'a',
        toShipId: 'b',
        amount: 1,
      },
    ]);
  });
});
