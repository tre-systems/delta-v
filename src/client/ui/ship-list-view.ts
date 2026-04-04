import type { Ship } from '../../shared/types/domain';
import { byId, clearHTML, listen, renderList, setTrustedHTML } from '../dom';
import {
  computed,
  createDisposalScope,
  effect,
  signal,
  withScope,
} from '../reactive';
import { buildShipListView } from './ship-list';

export interface ShipListViewDeps {
  onSelectShip: (shipId: string) => void;
}

export interface ShipListView {
  update: (
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ) => void;
  dispose: () => void;
}

export const createShipListView = (deps: ShipListViewDeps): ShipListView => {
  const scope = createDisposalScope();
  const shipListEl = byId('shipList');
  const inputSignal = signal<{
    ships: Ship[];
    selectedId: string | null;
    burns: Map<string, number | null>;
  } | null>(null);

  const update = (
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ): void => {
    inputSignal.value = { ships, selectedId, burns };
  };

  const dispose = (): void => {
    scope.dispose();
    clearHTML(shipListEl);
  };

  withScope(scope, () => {
    const listSignal = computed(() => {
      const input = inputSignal.value;

      if (!input) {
        return null;
      }

      return {
        input,
        view: buildShipListView(input.ships, input.selectedId, input.burns),
      };
    });

    effect(() => {
      const state = listSignal.value;

      if (!state) {
        return;
      }

      const { input, view } = state;

      renderList(shipListEl, input.ships, (ship, index) => {
        const entryView = view[index];
        const entry = document.createElement('div');
        entry.className = 'ship-entry';
        entry.setAttribute('role', 'button');
        entry.setAttribute(
          'aria-label',
          `${entryView.displayName}, ${entryView.statusText.replace(/\s+/g, ' ').trim()}`,
        );
        entry.setAttribute('aria-pressed', String(entryView.isSelected));

        if (entryView.isSelected) {
          entry.classList.add('active');
        }

        if (entryView.isDestroyed) {
          entry.classList.add('destroyed');
          entry.setAttribute('aria-disabled', 'true');
        } else {
          entry.removeAttribute('aria-disabled');
        }

        setTrustedHTML(
          entry,
          `
          <span class="ship-name">${entryView.displayName}</span>
          <span class="ship-status">
            ${entryView.statusText}
            ${entryView.hasBurn ? '<span class="burn-dot"></span>' : ''}
          </span>
          <span class="ship-fuel">${entryView.fuelText}</span>
        `,
        );

        if (entryView.detailRows.length > 0) {
          const details = document.createElement('div');
          details.className = 'ship-details';

          const rows = entryView.detailRows.map((row) => {
            const style = row.tone ? ` style="color:var(--${row.tone})"` : '';

            return `<div class="ship-detail-row"><span class="ship-detail-label">${row.label}</span><span class="ship-detail-value"${style}>${row.value}</span></div>`;
          });

          setTrustedHTML(details, rows.join(''));
          entry.appendChild(details);
        }

        if (ship.lifecycle !== 'destroyed') {
          entry.tabIndex = 0;

          listen(entry, 'click', () => {
            deps.onSelectShip(ship.id);
          });
          listen(entry, 'keydown', (e: Event) => {
            const key = (e as KeyboardEvent).key;
            if (key === 'Enter' || key === ' ') {
              e.preventDefault();
              deps.onSelectShip(ship.id);
            }
          });
        }

        return entry;
      });
    });
  });

  return {
    update,
    dispose,
  };
};
