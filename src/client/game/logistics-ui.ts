import { SHIP_STATS, type ShipType } from '../../shared/constants';
import { clearHTML, el, listen, text } from '../dom';
import {
  computed,
  createDisposalScope,
  effect,
  signal,
  withScope,
} from '../reactive';
import type { LogisticsStore } from './logistics-store';

interface TransferPanelView {
  readonly store: LogisticsStore;
  dispose(): void;
}

const panelViews = new WeakMap<HTMLElement, TransferPanelView>();

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

  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Cargo and fuel transfers');
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('aria-relevant', 'additions text');

  if (logisticsStore.pairs.length === 0) {
    container.appendChild(
      el('div', {
        class: 'transfer-empty',
        text: 'No ships can transfer fuel or cargo at this location this turn.',
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
