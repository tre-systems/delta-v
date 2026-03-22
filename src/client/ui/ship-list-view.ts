import type { Ship } from '../../shared/types/domain';
import { byId } from '../dom';
import { computed, createDisposalScope, effect, signal } from '../reactive';
import { buildShipListView } from './ship-list';

export interface ShipListViewDeps {
  onSelectShip: (shipId: string) => void;
}

export class ShipListView {
  private readonly scope = createDisposalScope();
  private readonly shipListEl = byId('shipList');
  private readonly inputSignal = signal<{
    ships: Ship[];
    selectedId: string | null;
    burns: Map<string, number | null>;
  } | null>(null);

  constructor(private readonly deps: ShipListViewDeps) {
    const listSignal = this.scope.add(
      computed(() => {
        const input = this.inputSignal.value;
        if (!input) return null;
        return {
          input,
          view: buildShipListView(input.ships, input.selectedId, input.burns),
        };
      }),
    );

    this.scope.add(
      effect(() => {
        const state = listSignal.value;
        if (!state) return;
        const { input, view } = state;

        this.shipListEl.innerHTML = '';

        for (const [index, ship] of input.ships.entries()) {
          const entryView = view[index];
          const entry = document.createElement('div');
          entry.className = 'ship-entry';

          if (entryView.isSelected) {
            entry.classList.add('active');
          }
          if (entryView.isDestroyed) {
            entry.classList.add('destroyed');
          }

          entry.innerHTML = `
          <span class="ship-name">${entryView.displayName}</span>
          <span class="ship-status">
            ${entryView.statusText}
            ${entryView.hasBurn ? '<span class="burn-dot"></span>' : ''}
          </span>
          <span class="ship-fuel">${entryView.fuelText}</span>
        `;

          if (entryView.detailRows.length > 0) {
            const details = document.createElement('div');
            details.className = 'ship-details';

            const rows = entryView.detailRows.map((row) => {
              const style = row.tone ? ` style="color:var(--${row.tone})"` : '';

              return `<div class="ship-detail-row"><span class="ship-detail-label">${row.label}</span><span class="ship-detail-value"${style}>${row.value}</span></div>`;
            });

            details.innerHTML = rows.join('');
            entry.appendChild(details);
          }

          if (ship.lifecycle !== 'destroyed') {
            entry.addEventListener('click', () => {
              this.deps.onSelectShip(ship.id);
            });
          }

          this.shipListEl.appendChild(entry);
        }
      }),
    );
  }

  update(
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ): void {
    this.inputSignal.value = { ships, selectedId, burns };
  }

  dispose(): void {
    this.scope.dispose();
    this.shipListEl.innerHTML = '';
  }
}
