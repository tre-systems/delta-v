import type { FleetPurchase, GameState } from '../../shared/types/domain';
import { byId, hide, show } from '../dom';
import { computed, effect, signal } from '../reactive';
import { canAddFleetShip, getFleetCartView, getFleetShopView } from './fleet';

export interface FleetBuildingViewDeps {
  onFleetReady: (purchases: FleetPurchase[]) => void;
}

const EMPTY_CART_HTML =
  '<span style="color:#556;font-size:0.75rem;padding:0.2rem">Click ships above to add</span>';

export class FleetBuildingView {
  private readonly cartSignal = signal<FleetPurchase[]>([]);
  private readonly totalCreditsSignal = signal(0);

  private readonly shopEl = byId('fleetShopList');
  private readonly cartEl = byId('fleetCart');
  private readonly creditsEl = byId('fleetCredits');
  private readonly readyBtn = byId('fleetReadyBtn');
  private readonly clearBtn = byId('fleetClearBtn');
  private readonly waitingEl = byId('fleetWaiting');

  constructor(private readonly deps: FleetBuildingViewDeps) {
    this.readyBtn.addEventListener('click', () => {
      this.deps.onFleetReady([...this.cartSignal.value]);
    });

    this.clearBtn.addEventListener('click', () => {
      this.cartSignal.value = [];
    });

    const cartViewSignal = computed(() =>
      getFleetCartView(this.cartSignal.value, this.totalCreditsSignal.value),
    );
    const shopViewSignal = computed(() =>
      getFleetShopView(this.cartSignal.value, this.totalCreditsSignal.value),
    );

    // Render cart dynamically
    effect(() => {
      const cartView = cartViewSignal.value;
      this.creditsEl.textContent = cartView.remainingLabel;
      this.cartEl.innerHTML = '';

      if (cartView.isEmpty) {
        this.cartEl.innerHTML = EMPTY_CART_HTML;
        return;
      }

      for (const [index, itemView] of cartView.items.entries()) {
        const chip = document.createElement('div');
        chip.className = 'fleet-cart-chip';
        chip.innerHTML = `${itemView.label} <span class="chip-remove">&times;</span>`;

        chip.addEventListener('click', () => {
          const newCart = [...this.cartSignal.peek()];
          newCart.splice(index, 1);
          this.cartSignal.value = newCart;
        });

        this.cartEl.appendChild(chip);
      }
    });

    // Update shop item disabled states dynamically
    effect(() => {
      const shopItems =
        this.shopEl.querySelectorAll<HTMLElement>('.fleet-shop-item');
      const shopView = shopViewSignal.value;

      for (const [index, item] of Array.from(shopItems).entries()) {
        item.classList.toggle('disabled', shopView[index]?.disabled ?? false);
      }
    });

    // Cart Recoil Animation whenever cart grows
    let lastCartLength = 0;
    effect(() => {
      const currentLength = this.cartSignal.value.length;
      if (currentLength > lastCartLength) {
        this.cartEl.classList.remove('recoil-anim');
        void this.cartEl.offsetWidth;
        this.cartEl.classList.add('recoil-anim');
      }
      lastCartLength = currentLength;
    });
  }

  show(state: GameState, playerId: number): void {
    const credits = state.players[playerId].credits ?? 0;

    // Render the static shop structure once
    this.shopEl.innerHTML = '';
    for (const itemView of getFleetShopView([], credits)) {
      const item = document.createElement('div');
      item.className = 'fleet-shop-item';

      item.innerHTML = `
        <div>
          <div class="fleet-shop-name">${itemView.name}</div>
          <div class="fleet-shop-stats">${itemView.statsText}</div>
        </div>
        <div class="fleet-shop-cost">${itemView.cost} MC</div>
      `;

      item.addEventListener('click', () => {
        if (
          canAddFleetShip(
            this.cartSignal.peek(),
            this.totalCreditsSignal.peek(),
            itemView.shipType,
          )
        ) {
          this.cartSignal.value = [
            ...this.cartSignal.peek(),
            { shipType: itemView.shipType },
          ];
        }
      });

      this.shopEl.appendChild(item);
    }

    // Assign signals exactly ONCE to trigger the effects mapping over the new DOM
    this.totalCreditsSignal.value = credits;
    this.cartSignal.value = [];

    show(this.readyBtn);
    show(this.clearBtn);
    hide(this.waitingEl);
  }

  showWaiting(): void {
    hide(this.readyBtn);
    hide(this.clearBtn);
    show(this.waitingEl, 'block');
  }
}
