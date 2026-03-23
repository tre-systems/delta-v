import { SHIP_STATS } from '../../shared/constants';
import {
  getTransferEligiblePairs,
  type TransferPair,
} from '../../shared/engine/logistics';
import type { GameState, TransferOrder } from '../../shared/types/domain';
import { clearHTML, el } from '../dom';

export interface LogisticsUIState {
  pairs: TransferPair[];
  fuelAmounts: Map<string, number>; // pairKey -> fuel amount to transfer
  cargoAmounts: Map<string, number>; // pairKey -> cargo amount to transfer
}

const pairKey = (source: string, target: string): string =>
  `${source}->${target}`;

export const createLogisticsUIState = (
  state: GameState,
  playerId: number,
): LogisticsUIState => {
  const pairs = getTransferEligiblePairs(state, playerId);
  return {
    pairs,
    fuelAmounts: new Map(),
    cargoAmounts: new Map(),
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

  return false;
};

const shipName = (type: string): string => SHIP_STATS[type]?.name ?? type;

export const renderTransferPanel = (
  container: HTMLElement,
  uiState: LogisticsUIState,
  onChanged: () => void,
): void => {
  clearHTML(container);

  if (uiState.pairs.length === 0) {
    container.appendChild(
      el('div', {
        class: 'transfer-empty',
        text: 'No transfer-eligible ships',
      }),
    );
    return;
  }

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
      const fuelAmt = uiState.fuelAmounts.get(key) ?? 0;
      const fuelRow = buildAmountRow(
        'Fuel',
        fuelAmt,
        pair.maxFuel,
        (newAmt) => {
          uiState.fuelAmounts.set(key, newAmt);
          onChanged();
        },
      );
      pairEl.appendChild(fuelRow);
    }

    if (pair.canTransferCargo) {
      const cargoAmt = uiState.cargoAmounts.get(key) ?? 0;
      const cargoRow = buildAmountRow(
        'Cargo',
        cargoAmt,
        pair.maxCargo,
        (newAmt) => {
          uiState.cargoAmounts.set(key, newAmt);
          onChanged();
        },
      );
      pairEl.appendChild(cargoRow);
    }

    container.appendChild(pairEl);
  }
};

const buildAmountRow = (
  label: string,
  current: number,
  max: number,
  onChange: (amount: number) => void,
): HTMLElement => {
  const row = el('div', { class: 'transfer-row' });

  const labelEl = el('span', { class: 'transfer-label', text: `${label}:` });
  row.appendChild(labelEl);

  const minusBtn = el('button', { class: 'btn-transfer-adj', text: '−' });
  minusBtn.addEventListener('click', () => {
    const newAmt = Math.max(0, current - 1);

    if (newAmt !== current) {
      onChange(newAmt);
    }
  });
  row.appendChild(minusBtn);

  const amountEl = el('span', {
    class: 'transfer-amount',
    text: `${current}/${max}`,
  });
  row.appendChild(amountEl);

  const plusBtn = el('button', { class: 'btn-transfer-adj', text: '+' });
  plusBtn.addEventListener('click', () => {
    const newAmt = Math.min(max, current + 1);

    if (newAmt !== current) {
      onChange(newAmt);
    }
  });
  row.appendChild(plusBtn);

  const maxBtn = el('button', { class: 'btn-transfer-max', text: 'MAX' });
  maxBtn.addEventListener('click', () => {
    if (current !== max) {
      onChange(max);
    }
  });
  row.appendChild(maxBtn);

  return row;
};
