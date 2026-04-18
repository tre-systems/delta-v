import type { Ship } from '../../shared/types/domain';
import { byId, clearHTML, listen, renderList, setTrustedHTML } from '../dom';
import {
  computed,
  createDisposalScope,
  effect,
  registerDisposer,
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
  setMobile: (isMobile: boolean) => void;
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
  const mobileCompactSignal = signal(false);

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

  const setMobile = (isMobile: boolean): void => {
    mobileCompactSignal.value = isMobile;
  };

  withScope(scope, () => {
    const listSignal = computed(() => {
      const input = inputSignal.value;

      if (!input) {
        return null;
      }

      const compact = mobileCompactSignal.value;

      return {
        input,
        compact,
        view: buildShipListView(
          input.ships,
          input.selectedId,
          input.burns,
          compact,
        ),
      };
    });

    effect(() => {
      const state = listSignal.value;

      if (!state) {
        return;
      }

      const { input, view, compact } = state;

      shipListEl.classList.toggle('ship-list--compact', compact);

      if (input.ships.length === 0) {
        clearHTML(shipListEl);
        const empty = document.createElement('div');
        empty.className = 'ship-list-empty';
        empty.textContent = 'No ships to show.';
        shipListEl.appendChild(empty);
        return;
      }

      renderList(shipListEl, input.ships, (ship, index) => {
        const entryView = view[index];
        const entry = document.createElement('div');
        entry.className = 'ship-entry';
        entry.setAttribute('role', 'button');
        // Stable hook for Playwright e2e. Keeping the class for CSS.
        entry.setAttribute('data-testid', 'ship-entry');
        const statusLine =
          `${entryView.statusText.replace(/\s+/g, ' ').trim()}${entryView.hasBurn ? ' burn' : ''}`.trim();
        entry.setAttribute(
          'aria-label',
          [
            entryView.displayName,
            entryView.fuelText && `fuel ${entryView.fuelText}`,
            statusLine,
          ]
            .filter(Boolean)
            .join(', '),
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

        const hasStatusRow =
          !compact || Boolean(entryView.statusText) || entryView.hasBurn;

        if (!hasStatusRow) {
          entry.classList.add('ship-entry--quiet');
        }

        const statusHtml = hasStatusRow
          ? `<span class="ship-status">${entryView.statusText}${entryView.hasBurn ? '<span class="burn-dot"></span>' : ''}</span>`
          : '';

        setTrustedHTML(
          entry,
          `
          <span class="ship-name">${entryView.displayName}</span>
          ${statusHtml}
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

      const syncScrollMask = (): void => {
        const canScroll = shipListEl.scrollHeight > shipListEl.clientHeight + 2;
        shipListEl.classList.toggle('ship-list--scrollable', canScroll);
      };

      syncScrollMask();
      registerDisposer(listen(shipListEl, 'scroll', syncScrollMask));
      registerDisposer(
        listen(window, 'resize', () => {
          queueMicrotask(syncScrollMask);
        }),
      );
    });
  });

  return {
    update,
    setMobile,
    dispose,
  };
};
