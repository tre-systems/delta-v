import { SHIP_STATS, type ShipType } from '../../shared/constants';
import {
  getTransferEligiblePairs,
  type TransferPair,
} from '../../shared/engine/logistics';
import type {
  GameState,
  PlayerId,
  TransferOrder,
} from '../../shared/types/domain';
import { clearHTML, el, listen, text } from '../dom';
import {
  computed,
  createDisposalScope,
  effect,
  type Signal,
  signal,
  withScope,
} from '../reactive';

interface LogisticsState {
  readonly revisionSignal?: Signal<number>;
  pairs: TransferPair[];
  fuelAmounts: Map<string, number>; // pairKey -> fuel amount to transfer
  cargoAmounts: Map<string, number>; // pairKey -> cargo amount to transfer
  passengerAmounts: Map<string, number>; // pairKey -> passengers to transfer
}

type TransferType = TransferOrder['transferType'];

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

const pairKey = (source: string, target: string): string =>
  `${source}->${target}`;

interface TransferPanelView {
  readonly store: LogisticsStore;
  dispose(): void;
}

const panelViews = new WeakMap<HTMLElement, TransferPanelView>();

const defineHiddenLogisticsMember = <K extends keyof LogisticsStore>(
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

const getTransferAmounts = (
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

const shipName = (type: ShipType): string => SHIP_STATS[type].name;

export const renderTransferPanel = (
  container: HTMLElement,
  logisticsStore: LogisticsStore,
  onChanged?: () => void,
): void => {
  const existing = panelViews.get(container);

  if (existing?.store === logisticsStore) {
    return;
  }

  existing?.dispose();
  clearHTML(container);

  if (logisticsStore.pairs.length === 0) {
    container.appendChild(
      el('div', {
        class: 'transfer-empty',
        text: 'No transfer-eligible ships',
      }),
    );
    panelViews.set(container, {
      store: logisticsStore,
      dispose: () => {
        clearHTML(container);
      },
    });
    return;
  }

  const scope = createDisposalScope();

  withScope(scope, () => {
    for (const pair of logisticsStore.pairs) {
      const isLooting = pair.source.owner !== pair.target.owner;
      const sourceLabel = `${shipName(pair.source.type)}${isLooting ? ' (enemy)' : ''}`;
      const targetLabel = shipName(pair.target.type);

      const pairEl = el('div', { class: 'transfer-pair' });
      pairEl.appendChild(
        el('div', {
          class: 'transfer-header',
          text: `${sourceLabel} → ${targetLabel}`,
        }),
      );

      if (pair.canTransferFuel) {
        pairEl.appendChild(
          buildAmountRow(
            'Fuel',
            pair.maxFuel,
            signal(
              logisticsStore.getTransferAmount(
                'fuel',
                pair.source.id,
                pair.target.id,
              ),
            ),
            (newAmt) => {
              logisticsStore.setTransferAmount(
                'fuel',
                pair.source.id,
                pair.target.id,
                newAmt,
              );
              onChanged?.();
            },
          ),
        );
      }

      if (pair.canTransferCargo) {
        pairEl.appendChild(
          buildAmountRow(
            'Cargo',
            pair.maxCargo,
            signal(
              logisticsStore.getTransferAmount(
                'cargo',
                pair.source.id,
                pair.target.id,
              ),
            ),
            (newAmt) => {
              logisticsStore.setTransferAmount(
                'cargo',
                pair.source.id,
                pair.target.id,
                newAmt,
              );
              onChanged?.();
            },
          ),
        );
      }

      if (pair.canTransferPassengers) {
        pairEl.appendChild(
          buildAmountRow(
            'Passengers',
            pair.maxPassengers,
            signal(
              logisticsStore.getTransferAmount(
                'passengers',
                pair.source.id,
                pair.target.id,
              ),
            ),
            (newAmt) => {
              logisticsStore.setTransferAmount(
                'passengers',
                pair.source.id,
                pair.target.id,
                newAmt,
              );
              onChanged?.();
            },
          ),
        );
      }

      container.appendChild(pairEl);
    }
  });

  panelViews.set(container, {
    store: logisticsStore,
    dispose: () => {
      scope.dispose();
      clearHTML(container);
    },
  });
};

const buildAmountRow = (
  label: string,
  max: number,
  amountSignal: { value: number; peek(): number },
  onChange: (amount: number) => void,
): HTMLElement => {
  const row = el('div', { class: 'transfer-row' });

  const labelEl = el('span', { class: 'transfer-label', text: `${label}:` });
  row.appendChild(labelEl);

  const minusBtn = el('button', {
    class: 'btn-transfer-adj',
    text: '−',
  }) as HTMLButtonElement;
  listen(minusBtn, 'click', () => {
    const current = amountSignal.peek();
    const newAmt = Math.max(0, current - 1);

    if (newAmt !== current) {
      amountSignal.value = newAmt;
      onChange(newAmt);
    }
  });
  row.appendChild(minusBtn);

  const amountTextSignal = computed(() => `${amountSignal.value}/${max}`);
  const amountEl = el('span', {
    class: 'transfer-amount',
  });
  text(amountEl, amountTextSignal);
  row.appendChild(amountEl);

  const plusBtn = el('button', {
    class: 'btn-transfer-adj',
    text: '+',
  }) as HTMLButtonElement;
  listen(plusBtn, 'click', () => {
    const current = amountSignal.peek();
    const newAmt = Math.min(max, current + 1);

    if (newAmt !== current) {
      amountSignal.value = newAmt;
      onChange(newAmt);
    }
  });
  row.appendChild(plusBtn);

  const maxBtn = el('button', {
    class: 'btn-transfer-max',
    text: 'MAX',
  }) as HTMLButtonElement;
  listen(maxBtn, 'click', () => {
    const current = amountSignal.peek();

    if (current !== max) {
      amountSignal.value = max;
      onChange(max);
    }
  });
  row.appendChild(maxBtn);

  effect(() => {
    const current = amountSignal.value;
    minusBtn.disabled = current === 0;
    plusBtn.disabled = current === max;
    maxBtn.disabled = current === max;
  });

  return row;
};
