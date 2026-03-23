import type { FleetPurchase, GameState } from '../../shared/types/domain';
import {
  byId,
  clearHTML,
  hide,
  listen,
  renderList,
  setTrustedHTML,
  show,
} from '../dom';
import {
  batch,
  computed,
  createDisposalScope,
  effect,
  signal,
} from '../reactive';
import { canAddFleetShip, getFleetCartView, getFleetShopView } from './fleet';

export interface FleetBuildingViewDeps {
  onFleetReady: (purchases: FleetPurchase[]) => void;
}

export interface FleetBuildingView {
  show: (state: GameState, playerId: number) => void;
  showWaiting: () => void;
  dispose: () => void;
}

const EMPTY_CART_HTML =
  '<span style="color:#556;font-size:0.75rem;padding:0.2rem">Click ships above to add</span>';

export const createFleetBuildingView = (
  deps: FleetBuildingViewDeps,
): FleetBuildingView => {
  const scope = createDisposalScope();
  const cartSignal = signal<FleetPurchase[]>([]);
  const totalCreditsSignal = signal(0);
  const waitingSignal = signal(false);

  const shopEl = byId('fleetShopList');
  const cartEl = byId('fleetCart');
  const creditsEl = byId('fleetCredits');
  const readyBtn = byId('fleetReadyBtn');
  const clearBtn = byId('fleetClearBtn');
  const waitingEl = byId('fleetWaiting');

  scope.add(
    listen(readyBtn, 'click', () => {
      deps.onFleetReady([...cartSignal.value]);
    }),
  );

  scope.add(
    listen(clearBtn, 'click', () => {
      cartSignal.value = [];
    }),
  );

  const cartViewSignal = scope.add(
    computed(() =>
      getFleetCartView(cartSignal.value, totalCreditsSignal.value),
    ),
  );
  const shopViewSignal = scope.add(
    computed(() =>
      getFleetShopView(cartSignal.value, totalCreditsSignal.value),
    ),
  );

  scope.add(
    effect(() => {
      const cartView = cartViewSignal.value;

      creditsEl.textContent = cartView.remainingLabel;

      if (cartView.isEmpty) {
        clearHTML(cartEl);
        setTrustedHTML(cartEl, EMPTY_CART_HTML);
        return;
      }

      renderList(cartEl, cartView.items, (itemView, index) => {
        const chip = document.createElement('div');
        chip.className = 'fleet-cart-chip';
        setTrustedHTML(
          chip,
          `${itemView.label} <span class="chip-remove">&times;</span>`,
        );

        chip.addEventListener('click', () => {
          const newCart = [...cartSignal.peek()];
          newCart.splice(index, 1);
          cartSignal.value = newCart;
        });

        return chip;
      });
    }),
  );

  scope.add(
    effect(() => {
      const shopView = shopViewSignal.value;

      renderList(shopEl, shopView, (itemView) => {
        const item = document.createElement('div');
        item.className = 'fleet-shop-item';
        item.classList.toggle('disabled', itemView.disabled);

        setTrustedHTML(
          item,
          `
          <div>
            <div class="fleet-shop-name">${itemView.name}</div>
            <div class="fleet-shop-stats">${itemView.statsText}</div>
          </div>
          <div class="fleet-shop-cost">${itemView.cost} MC</div>
        `,
        );

        item.addEventListener('click', () => {
          if (
            canAddFleetShip(
              cartSignal.peek(),
              totalCreditsSignal.peek(),
              itemView.shipType,
            )
          ) {
            cartSignal.value = [
              ...cartSignal.peek(),
              { shipType: itemView.shipType },
            ];
          }
        });

        return item;
      });
    }),
  );

  let lastCartLength = 0;
  scope.add(
    effect(() => {
      const currentLength = cartSignal.value.length;

      if (currentLength > lastCartLength) {
        cartEl.classList.remove('recoil-anim');
        void cartEl.offsetWidth;
        cartEl.classList.add('recoil-anim');
      }

      lastCartLength = currentLength;
    }),
  );

  scope.add(
    effect(() => {
      const waiting = waitingSignal.value;

      if (waiting) {
        hide(readyBtn);
        hide(clearBtn);
        show(waitingEl, 'block');
        return;
      }

      show(readyBtn);
      show(clearBtn);
      hide(waitingEl);
    }),
  );

  const showFleetBuilding = (state: GameState, playerId: number): void => {
    const credits = state.players[playerId].credits ?? 0;

    batch(() => {
      totalCreditsSignal.value = credits;
      cartSignal.value = [];
      waitingSignal.value = false;
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

  return {
    show: showFleetBuilding,
    showWaiting,
    dispose,
  };
};
