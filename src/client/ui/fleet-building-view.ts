import type { FleetPurchase, GameState } from '../../shared/types';
import { byId, hide, show } from '../dom';
import { canAddFleetShip, getFleetCartView, getFleetShopView } from './fleet';

export interface FleetBuildingViewDeps {
  onFleetReady: (purchases: FleetPurchase[]) => void;
}

const EMPTY_CART_HTML =
  '<span style="color:#556;font-size:0.75rem;padding:0.2rem">Click ships above to add</span>';

export class FleetBuildingView {
  private cart: FleetPurchase[] = [];
  private totalCredits = 0;

  private readonly shopEl = byId('fleetShopList');
  private readonly cartEl = byId('fleetCart');
  private readonly creditsEl = byId('fleetCredits');
  private readonly readyBtn = byId('fleetReadyBtn');
  private readonly clearBtn = byId('fleetClearBtn');
  private readonly waitingEl = byId('fleetWaiting');

  constructor(private readonly deps: FleetBuildingViewDeps) {
    this.readyBtn.addEventListener('click', () => {
      this.deps.onFleetReady([...this.cart]);
    });

    this.clearBtn.addEventListener('click', () => {
      this.cart = [];
      this.renderCart();
    });
  }

  show(state: GameState, playerId: number): void {
    this.cart = [];
    this.totalCredits = state.players[playerId].credits ?? 0;

    this.renderShop();
    this.renderCart();

    show(this.readyBtn);
    show(this.clearBtn);
    hide(this.waitingEl);
  }

  showWaiting(): void {
    hide(this.readyBtn);
    hide(this.clearBtn);
    show(this.waitingEl, 'block');
  }

  private renderShop(): void {
    this.shopEl.innerHTML = '';

    for (const itemView of getFleetShopView(this.cart, this.totalCredits)) {
      const item = document.createElement('div');
      item.className = 'fleet-shop-item';
      item.classList.toggle('disabled', itemView.disabled);

      item.innerHTML = `
        <div>
          <div class="fleet-shop-name">${itemView.name}</div>
          <div class="fleet-shop-stats">${itemView.statsText}</div>
        </div>
        <div class="fleet-shop-cost">${itemView.cost} MC</div>
      `;

      item.addEventListener('click', () => {
        if (canAddFleetShip(this.cart, this.totalCredits, itemView.shipType)) {
          this.cart.push({
            shipType: itemView.shipType,
          });
          this.renderCart();
          this.applyCartRecoil();
        }
      });

      this.shopEl.appendChild(item);
    }
  }

  private renderCart(): void {
    const cartView = getFleetCartView(this.cart, this.totalCredits);

    this.creditsEl.textContent = cartView.remainingLabel;
    this.cartEl.innerHTML = '';

    if (cartView.isEmpty) {
      this.cartEl.innerHTML = EMPTY_CART_HTML;
      this.updateShopDisabledStates();
      return;
    }

    for (const [index, itemView] of cartView.items.entries()) {
      const chip = document.createElement('div');
      chip.className = 'fleet-cart-chip';
      chip.innerHTML = `${itemView.label} <span class="chip-remove">&times;</span>`;

      chip.addEventListener('click', () => {
        this.cart.splice(index, 1);
        this.renderCart();
      });

      this.cartEl.appendChild(chip);
    }

    this.updateShopDisabledStates();
  }

  private updateShopDisabledStates(): void {
    const shopItems =
      this.shopEl.querySelectorAll<HTMLElement>('.fleet-shop-item');
    const shopView = getFleetShopView(this.cart, this.totalCredits);

    for (const [index, item] of Array.from(shopItems).entries()) {
      item.classList.toggle('disabled', shopView[index]?.disabled ?? false);
    }
  }

  private applyCartRecoil(): void {
    this.cartEl.classList.remove('recoil-anim');
    void this.cartEl.offsetWidth;
    this.cartEl.classList.add('recoil-anim');
  }
}
