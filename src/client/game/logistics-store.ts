import {
  getTransferEligiblePairs,
  type TransferPair,
} from '../../shared/engine/logistics';
import type {
  GameState,
  PlayerId,
  TransferOrder,
} from '../../shared/types/domain';
import { type Signal, signal } from '../reactive';

interface LogisticsState {
  readonly revisionSignal?: Signal<number>;
  pairs: TransferPair[];
  fuelAmounts: Map<string, number>; // pairKey -> fuel amount to transfer
  cargoAmounts: Map<string, number>; // pairKey -> cargo amount to transfer
  passengerAmounts: Map<string, number>; // pairKey -> passengers to transfer
}

export type TransferType = TransferOrder['transferType'];

export interface LogisticsStore extends LogisticsState {
  readonly revisionSignal: Signal<number>;
  getTransferAmount: (
    transferType: TransferType,
    sourceId: string,
    targetId: string,
  ) => number;
  setTransferAmount: (
    transferType: TransferType,
    sourceId: string,
    targetId: string,
    amount: number,
  ) => void;
  buildTransferOrders: () => TransferOrder[];
  hasQueuedTransfers: () => boolean;
}

export const pairKey = (source: string, target: string): string =>
  `${source}->${target}`;

export const defineHiddenLogisticsMember = <K extends keyof LogisticsStore>(
  logisticsStore: LogisticsStore,
  key: K,
  value: LogisticsStore[K],
): void => {
  Object.defineProperty(logisticsStore, key, {
    enumerable: false,
    configurable: false,
    writable: false,
    value,
  });
};

export const getTransferAmounts = (
  logisticsStore: LogisticsStore,
  transferType: TransferType,
): Map<string, number> => {
  switch (transferType) {
    case 'fuel':
      return logisticsStore.fuelAmounts;
    case 'cargo':
      return logisticsStore.cargoAmounts;
    case 'passengers':
      return logisticsStore.passengerAmounts;
  }
};

export const createLogisticsStoreFromPairs = (
  pairs: TransferPair[],
): LogisticsStore => {
  const logisticsState: LogisticsState = {
    pairs,
    fuelAmounts: new Map(),
    cargoAmounts: new Map(),
    passengerAmounts: new Map(),
  };
  const logisticsStore = logisticsState as LogisticsStore;

  const notifyLogisticsChanged = (): void => {
    logisticsStore.revisionSignal.update((n) => n + 1);
  };

  defineHiddenLogisticsMember(logisticsStore, 'revisionSignal', signal(0));
  defineHiddenLogisticsMember(
    logisticsStore,
    'getTransferAmount',
    (transferType: TransferType, sourceId: string, targetId: string): number =>
      getTransferAmounts(logisticsStore, transferType).get(
        pairKey(sourceId, targetId),
      ) ?? 0,
  );
  defineHiddenLogisticsMember(
    logisticsStore,
    'setTransferAmount',
    (
      transferType: TransferType,
      sourceId: string,
      targetId: string,
      amount: number,
    ): void => {
      const nextAmount = Math.max(0, amount);
      const amounts = getTransferAmounts(logisticsStore, transferType);
      const key = pairKey(sourceId, targetId);

      if ((amounts.get(key) ?? 0) === nextAmount) {
        return;
      }

      amounts.set(key, nextAmount);
      notifyLogisticsChanged();
    },
  );
  defineHiddenLogisticsMember(
    logisticsStore,
    'buildTransferOrders',
    (): TransferOrder[] => {
      const orders: TransferOrder[] = [];

      for (const pair of logisticsStore.pairs) {
        const fuelAmt = logisticsStore.getTransferAmount(
          'fuel',
          pair.source.id,
          pair.target.id,
        );
        const cargoAmt = logisticsStore.getTransferAmount(
          'cargo',
          pair.source.id,
          pair.target.id,
        );
        const passengerAmt = logisticsStore.getTransferAmount(
          'passengers',
          pair.source.id,
          pair.target.id,
        );

        if (fuelAmt > 0) {
          orders.push({
            sourceShipId: pair.source.id,
            targetShipId: pair.target.id,
            transferType: 'fuel',
            amount: fuelAmt,
          });
        }

        if (cargoAmt > 0) {
          orders.push({
            sourceShipId: pair.source.id,
            targetShipId: pair.target.id,
            transferType: 'cargo',
            amount: cargoAmt,
          });
        }

        if (passengerAmt > 0) {
          orders.push({
            sourceShipId: pair.source.id,
            targetShipId: pair.target.id,
            transferType: 'passengers',
            amount: passengerAmt,
          });
        }
      }

      return orders;
    },
  );
  defineHiddenLogisticsMember(
    logisticsStore,
    'hasQueuedTransfers',
    (): boolean => {
      for (const amt of logisticsStore.fuelAmounts.values()) {
        if (amt > 0) return true;
      }

      for (const amt of logisticsStore.cargoAmounts.values()) {
        if (amt > 0) return true;
      }

      for (const amt of logisticsStore.passengerAmounts.values()) {
        if (amt > 0) return true;
      }

      return false;
    },
  );

  return logisticsStore;
};

export const createLogisticsStore = (
  state: GameState,
  playerId: PlayerId,
): LogisticsStore =>
  createLogisticsStoreFromPairs(getTransferEligiblePairs(state, playerId));
