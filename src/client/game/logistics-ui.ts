import { SHIP_STATS } from '../../shared/constants';
import {
  getTransferEligiblePairs,
  type TransferPair,
} from '../../shared/engine/logistics';
import type { GameState, TransferOrder } from '../../shared/types/domain';
import { clearHTML, el, listen, text } from '../dom';
import {
  computed,
  createDisposalScope,
  effect,
  signal,
  withScope,
} from '../reactive';

export interface LogisticsUIState {
  pairs: TransferPair[];
  fuelAmounts: Map<string, number>; // pairKey -> fuel amount to transfer
  cargoAmounts: Map<string, number>; // pairKey -> cargo amount to transfer
  passengerAmounts: Map<string, number>; // pairKey -> passengers to transfer
}

const pairKey = (source: string, target: string): string =>
  `${source}->${target}`;

interface TransferPanelView {
  readonly uiState: LogisticsUIState;
  dispose(): void;
}

const panelViews = new WeakMap<HTMLElement, TransferPanelView>();

export const createLogisticsUIState = (
  state: GameState,
  playerId: number,
): LogisticsUIState => {
  const pairs = getTransferEligiblePairs(state, playerId);
  return {
    pairs,
    fuelAmounts: new Map(),
    cargoAmounts: new Map(),
    passengerAmounts: new Map(),
  };
};

export const buildTransferOrders = (
  uiState: LogisticsUIState,
): TransferOrder[] => {
  const orders: TransferOrder[] = [];
  for (const pair of uiState.pairs) {
    const key = pairKey(pair.source.id, pair.target.id);
    const fuelAmt = uiState.fuelAmounts.get(key) ?? 0;
    const cargoAmt = uiState.cargoAmounts.get(key) ?? 0;

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
    const passengerAmt = uiState.passengerAmounts.get(key) ?? 0;

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
};

export const hasQueuedTransfers = (uiState: LogisticsUIState): boolean => {
  for (const amt of uiState.fuelAmounts.values()) {
    if (amt > 0) return true;
  }

  for (const amt of uiState.cargoAmounts.values()) {
    if (amt > 0) return true;
  }

  for (const amt of uiState.passengerAmounts.values()) {
    if (amt > 0) return true;
  }

  return false;
};

const shipName = (type: string): string => SHIP_STATS[type]?.name ?? type;

export const renderTransferPanel = (
  container: HTMLElement,
  uiState: LogisticsUIState,
  onChanged?: () => void,
): void => {
  const existing = panelViews.get(container);

  if (existing?.uiState === uiState) {
    return;
  }

  existing?.dispose();
  clearHTML(container);

  if (uiState.pairs.length === 0) {
    container.appendChild(
      el('div', {
        class: 'transfer-empty',
        text: 'No transfer-eligible ships',
      }),
    );
    panelViews.set(container, {
      uiState,
      dispose: () => {
        clearHTML(container);
      },
    });
    return;
  }

  const scope = createDisposalScope();

  withScope(scope, () => {
    for (const pair of uiState.pairs) {
      const key = pairKey(pair.source.id, pair.target.id);
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
            signal(uiState.fuelAmounts.get(key) ?? 0),
            (newAmt) => {
              uiState.fuelAmounts.set(key, newAmt);
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
            signal(uiState.cargoAmounts.get(key) ?? 0),
            (newAmt) => {
              uiState.cargoAmounts.set(key, newAmt);
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
            signal(uiState.passengerAmounts.get(key) ?? 0),
            (newAmt) => {
              uiState.passengerAmounts.set(key, newAmt);
              onChanged?.();
            },
          ),
        );
      }

      container.appendChild(pairEl);
    }
  });

  panelViews.set(container, {
    uiState,
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
