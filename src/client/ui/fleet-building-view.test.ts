// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetPurchase, GameState } from '../../shared/types/domain';
import { FleetBuildingView } from './fleet-building-view';

const createState = (credits: number): GameState => ({
  gameId: 'FLEET',
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'fleetBuilding',
  activePlayer: 0,
  ships: [],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: false,
      targetBody: 'Mars',
      homeBody: 'Terra',
      bases: [],
      escapeWins: false,
      credits,
    },
    {
      connected: true,
      ready: false,
      targetBody: 'Terra',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
      credits,
    },
  ],
  winner: null,
  winReason: null,
});

const installFixture = () => {
  document.body.innerHTML = `
    <div id="fleetShopList"></div>
    <div id="fleetCart"></div>
    <div id="fleetCredits"></div>
    <button id="fleetReadyBtn">Ready</button>
    <button id="fleetClearBtn">Clear</button>
    <div id="fleetWaiting" style="display:none">Waiting...</div>
  `;
};

describe('FleetBuildingView', () => {
  beforeEach(() => {
    installFixture();
  });

  it('renders the shop, adds a ship, and emits purchases when ready', () => {
    const onFleetReady = vi.fn<(purchases: FleetPurchase[]) => void>();
    const view = new FleetBuildingView({
      onFleetReady,
    });

    view.show(createState(25), 0);

    const shopItem = document.querySelector<HTMLElement>(
      '.fleet-shop-item:not(.disabled)',
    );
    expect(shopItem).not.toBeNull();
    expect(document.getElementById('fleetCredits')?.textContent).toBe(
      '25 MC remaining',
    );

    shopItem?.click();

    expect(document.querySelectorAll('.fleet-cart-chip')).toHaveLength(1);
    expect(document.getElementById('fleetCredits')?.textContent).not.toBe(
      '25 MC remaining',
    );

    document.getElementById('fleetReadyBtn')?.click();

    expect(onFleetReady).toHaveBeenCalledTimes(1);
    expect(onFleetReady.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('clears the cart back to the empty prompt', () => {
    const view = new FleetBuildingView({
      onFleetReady: vi.fn(),
    });

    view.show(createState(25), 0);
    document
      .querySelector<HTMLElement>('.fleet-shop-item:not(.disabled)')
      ?.click();
    document.getElementById('fleetClearBtn')?.click();

    expect(document.querySelectorAll('.fleet-cart-chip')).toHaveLength(0);
    expect(document.getElementById('fleetCart')?.textContent).toContain(
      'Click ships above to add',
    );
    expect(document.getElementById('fleetCredits')?.textContent).toBe(
      '25 MC remaining',
    );
  });

  it('shows waiting state and restores controls when shown again', () => {
    const view = new FleetBuildingView({
      onFleetReady: vi.fn(),
    });
    const state = createState(25);
    const readyBtn = document.getElementById('fleetReadyBtn') as HTMLElement;
    const clearBtn = document.getElementById('fleetClearBtn') as HTMLElement;
    const waitingEl = document.getElementById('fleetWaiting') as HTMLElement;

    view.show(state, 0);
    view.showWaiting();

    expect(readyBtn.style.display).toBe('none');
    expect(clearBtn.style.display).toBe('none');
    expect(waitingEl.style.display).toBe('block');

    view.show(state, 0);

    expect(readyBtn.style.display).toBe('');
    expect(clearBtn.style.display).toBe('');
    expect(waitingEl.style.display).toBe('none');
  });
});
