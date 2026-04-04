import type {
  FleetPurchase,
  FleetPurchaseOption,
  GameState,
  PlayerId,
} from '../../shared/types/domain';
import { byId, clearHTML, el, listen, renderList, text, visible } from '../dom';
import {
  batch,
  computed,
  createDisposalScope,
  effect,
  signal,
  withScope,
} from '../reactive';
import {
  canAddFleetPurchase,
  type FleetExistingShip,
  getFleetCartView,
  getFleetShopView,
} from './fleet';

export interface FleetBuildingViewDeps {
  onFleetReady: (purchases: FleetPurchase[]) => void;
}

export interface FleetBuildingView {
  show: (state: GameState, playerId: PlayerId) => void;
  showWaiting: () => void;
  dispose: () => void;
}

export const createFleetBuildingView = (
  deps: FleetBuildingViewDeps,
): FleetBuildingView => {
  const scope = createDisposalScope();
  const cartSignal = signal<FleetPurchase[]>([]);
  const availableFleetPurchasesSignal = signal<
    FleetPurchaseOption[] | undefined
  >(undefined);
  const existingShipsSignal = signal<FleetExistingShip[]>([]);
  const totalCreditsSignal = signal(0);
  const waitingSignal = signal(false);

  const shopEl = byId('fleetShopList');
  const cartEl = byId('fleetCart');
  const creditsEl = byId('fleetCredits');
  const readyBtn = byId('fleetReadyBtn');
  const clearBtn = byId('fleetClearBtn');
  const waitingEl = byId('fleetWaiting');

  const showFleetBuilding = (state: GameState, playerId: PlayerId): void => {
    const isSpectator = playerId !== 0 && playerId !== 1;
    const effectivePlayer = isSpectator ? 0 : playerId;
    const credits = state.players[effectivePlayer]?.credits ?? 0;

    batch(() => {
      availableFleetPurchasesSignal.value =
        state.scenarioRules.availableFleetPurchases;
      existingShipsSignal.value = state.ships
        .filter((ship) => ship.owner === effectivePlayer)
        .map((ship) => ({
          type: ship.type,
          lifecycle: ship.lifecycle,
          baseStatus: ship.baseStatus,
          cargoUsed: ship.cargoUsed,
        }));
      totalCreditsSignal.value = credits;
      cartSignal.value = [];
      waitingSignal.value = isSpectator;
    });
  };

  const showWaiting = (): void => {
    waitingSignal.value = true;
  };

  const dispose = (): void => {
    scope.dispose();
    clearHTML(shopEl);
    clearHTML(cartEl);
  };

  withScope(scope, () => {
    listen(readyBtn, 'click', () => {
      deps.onFleetReady([...cartSignal.value]);
    });

    listen(clearBtn, 'click', () => {
      cartSignal.value = [];
    });

    const cartViewSignal = computed(() =>
      getFleetCartView(cartSignal.value, totalCreditsSignal.value),
    );

    const shopViewSignal = computed(() =>
      getFleetShopView(
        cartSignal.value,
        totalCreditsSignal.value,
        availableFleetPurchasesSignal.value,
        existingShipsSignal.value,
      ),
    );

    effect(() => {
      const cartView = cartViewSignal.value;

      text(creditsEl, cartView.remainingLabel);

      if (cartView.isEmpty) {
        clearHTML(cartEl);
        cartEl.appendChild(
          el('span', {
            style: {
              color: '#556',
              fontSize: '0.75rem',
              padding: '0.2rem',
            },
            text: 'Click ships above to add',
          }),
        );
        return;
      }

      renderList(cartEl, cartView.items, (itemView, index) => {
        const chip = el(
          'div',
          { class: 'fleet-cart-chip' },
          itemView.label,
          el('span', { class: 'chip-remove', text: '×' }),
        );

        chip.setAttribute('role', 'button');
        chip.tabIndex = 0;
        chip.setAttribute('aria-label', `Remove ${itemView.label}`);

        const removeShip = (): void => {
          const newCart = [...cartSignal.peek()];
          newCart.splice(index, 1);
          cartSignal.value = newCart;
        };

        listen(chip, 'click', removeShip);
        listen(chip, 'keydown', (e: Event) => {
          const key = (e as KeyboardEvent).key;
          if (key === 'Enter' || key === ' ') {
            e.preventDefault();
            removeShip();
          }
        });

        return chip;
      });
    });

    effect(() => {
      const shopView = shopViewSignal.value;

      renderList(shopEl, shopView, (itemView) => {
        const item = el(
          'div',
          {
            class: 'fleet-shop-item',
            classList: { disabled: itemView.disabled },
          },
          el(
            'div',
            {},
            el('div', { class: 'fleet-shop-name', text: itemView.name }),
            el('div', { class: 'fleet-shop-stats', text: itemView.statsText }),
          ),
          el('div', { class: 'fleet-shop-cost', text: `${itemView.cost} MC` }),
        );

        item.setAttribute('role', 'button');
        item.tabIndex = itemView.disabled ? -1 : 0;
        item.setAttribute(
          'aria-label',
          `${itemView.name}, ${itemView.statsText}, ${itemView.cost} MegaCredits`,
        );

        const addShip = (): void => {
          if (
            canAddFleetPurchase(
              cartSignal.peek(),
              totalCreditsSignal.peek(),
              itemView.purchase,
              existingShipsSignal.peek(),
            )
          ) {
            cartSignal.value = [...cartSignal.peek(), itemView.purchase];
          }
        };

        listen(item, 'click', addShip);
        listen(item, 'keydown', (e: Event) => {
          const key = (e as KeyboardEvent).key;
          if (key === 'Enter' || key === ' ') {
            e.preventDefault();
            addShip();
          }
        });

        return item;
      });
    });

    let lastCartLength = 0;
    effect(() => {
      const currentLength = cartSignal.value.length;

      if (currentLength > lastCartLength) {
        cartEl.classList.remove('recoil-anim');
        void cartEl.offsetWidth;
        cartEl.classList.add('recoil-anim');
      }

      lastCartLength = currentLength;
    });

    effect(() => {
      const waiting = waitingSignal.value;

      visible(readyBtn, !waiting);
      visible(clearBtn, !waiting);
      visible(waitingEl, waiting, 'block');
    });
  });

  return {
    show: showFleetBuilding,
    showWaiting,
    dispose,
  };
};
