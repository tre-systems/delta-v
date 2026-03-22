import type { FleetPurchase, GameState } from '../../shared/types/domain';
import { byId, clearHTML, hide, listen, setTrustedHTML, show } from '../dom';
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

const EMPTY_CART_HTML =
  '<span style="color:#556;font-size:0.75rem;padding:0.2rem">Click ships above to add</span>';

export class FleetBuildingView {
  private readonly scope = createDisposalScope();
  private readonly cartSignal = signal<FleetPurchase[]>([]);
  private readonly totalCreditsSignal = signal(0);
  private readonly waitingSignal = signal(false);

  private readonly shopEl = byId('fleetShopList');
  private readonly cartEl = byId('fleetCart');
  private readonly creditsEl = byId('fleetCredits');
  private readonly readyBtn = byId('fleetReadyBtn');
  private readonly clearBtn = byId('fleetClearBtn');
  private readonly waitingEl = byId('fleetWaiting');

  constructor(private readonly deps: FleetBuildingViewDeps) {
    this.scope.add(
      listen(this.readyBtn, 'click', () => {
        this.deps.onFleetReady([...this.cartSignal.value]);
      }),
    );

    this.scope.add(
      listen(this.clearBtn, 'click', () => {
        this.cartSignal.value = [];
      }),
    );

    const cartViewSignal = this.scope.add(
      computed(() =>
        getFleetCartView(this.cartSignal.value, this.totalCreditsSignal.value),
      ),
    );
    const shopViewSignal = this.scope.add(
      computed(() =>
        getFleetShopView(this.cartSignal.value, this.totalCreditsSignal.value),
      ),
    );

    this.scope.add(
      effect(() => {
        const cartView = cartViewSignal.value;

        this.creditsEl.textContent = cartView.remainingLabel;
        clearHTML(this.cartEl);

        if (cartView.isEmpty) {
          setTrustedHTML(this.cartEl, EMPTY_CART_HTML);
          return;
        }

        for (const [index, itemView] of cartView.items.entries()) {
          const chip = document.createElement('div');
          chip.className = 'fleet-cart-chip';
          setTrustedHTML(
            chip,
            `${itemView.label} <span class="chip-remove">&times;</span>`,
          );

          chip.addEventListener('click', () => {
            const newCart = [...this.cartSignal.peek()];
            newCart.splice(index, 1);
            this.cartSignal.value = newCart;
          });

          this.cartEl.appendChild(chip);
        }
      }),
    );

    this.scope.add(
      effect(() => {
        const shopView = shopViewSignal.value;

        clearHTML(this.shopEl);

        for (const itemView of shopView) {
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
      }),
    );

    let lastCartLength = 0;
    this.scope.add(
      effect(() => {
        const currentLength = this.cartSignal.value.length;

        if (currentLength > lastCartLength) {
          this.cartEl.classList.remove('recoil-anim');
          void this.cartEl.offsetWidth;
          this.cartEl.classList.add('recoil-anim');
        }

        lastCartLength = currentLength;
      }),
    );

    this.scope.add(
      effect(() => {
        const waiting = this.waitingSignal.value;

        if (waiting) {
          hide(this.readyBtn);
          hide(this.clearBtn);
          show(this.waitingEl, 'block');
          return;
        }

        show(this.readyBtn);
        show(this.clearBtn);
        hide(this.waitingEl);
      }),
    );
  }

  show(state: GameState, playerId: number): void {
    const credits = state.players[playerId].credits ?? 0;

    batch(() => {
      this.totalCreditsSignal.value = credits;
      this.cartSignal.value = [];
      this.waitingSignal.value = false;
    });
  }

  showWaiting(): void {
    this.waitingSignal.value = true;
  }

  dispose(): void {
    this.scope.dispose();
    clearHTML(this.shopEl);
    clearHTML(this.cartEl);
  }
}
