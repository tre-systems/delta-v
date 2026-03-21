import type { Ship } from '../../shared/types';
import { byId } from '../dom';
import { buildShipListView } from './ship-list';

export interface ShipListViewDeps {
  onSelectShip: (shipId: string) => void;
}

export class ShipListView {
  private readonly shipListEl = byId('shipList');

  constructor(private readonly deps: ShipListViewDeps) {}

  update(
    ships: Ship[],
    selectedId: string | null,
    burns: Map<string, number | null>,
  ): void {
    this.shipListEl.innerHTML = '';

    const shipListView = buildShipListView(ships, selectedId, burns);

    for (const [index, ship] of ships.entries()) {
      const entryView = shipListView[index];
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

      if (!ship.destroyed) {
        entry.addEventListener('click', () => {
          this.deps.onSelectShip(ship.id);
        });
      }

      this.shipListEl.appendChild(entry);
    }
  }
}
