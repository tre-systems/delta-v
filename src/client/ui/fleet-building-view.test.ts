// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import type {
  FleetPurchase,
  GameState,
  ScenarioRules,
  Ship,
} from '../../shared/types/domain';
import { createFleetBuildingView } from './fleet-building-view';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'transport',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  lifecycle: 'active',
  control: 'own',
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createState = (
  credits: number,
  overrides: {
    scenarioRules?: ScenarioRules;
    ships?: Ship[];
  } = {},
): GameState => ({
  gameId: asGameId('FLEET'),
  scenario: 'biplanetary',
  scenarioRules: overrides.scenarioRules ?? {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'fleetBuilding',
  activePlayer: 0,
  ships: overrides.ships ?? [],
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
  outcome: null,
});

const installFixture = () => {
  document.body.innerHTML = `
    <div id="fleetShopList"></div>
    <div id="fleetCart"></div>
    <div id="fleetCredits"></div>
    <button id="fleetReadyBtn">Ready</button>
    <button id="fleetClearBtn">Clear</button>
    <div id="fleetWaiting" hidden>Waiting...</div>
  `;
};

describe('FleetBuildingView', () => {
  beforeEach(() => {
    installFixture();
  });

  it('renders the shop, adds a ship, and emits purchases when ready', () => {
    const onFleetReady = vi.fn<(purchases: FleetPurchase[]) => void>();
    const view = createFleetBuildingView({
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
    const view = createFleetBuildingView({
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
    const view = createFleetBuildingView({
      onFleetReady: vi.fn(),
    });
    const state = createState(25);
    const readyBtn = document.getElementById(
      'fleetReadyBtn',
    ) as HTMLButtonElement;
    const clearBtn = document.getElementById('fleetClearBtn') as HTMLElement;
    const waitingEl = document.getElementById('fleetWaiting') as HTMLElement;

    view.show(state, 0);
    view.showWaiting();

    expect(readyBtn.hasAttribute('hidden')).toBe(true);
    expect(clearBtn.hasAttribute('hidden')).toBe(true);
    expect(waitingEl.hasAttribute('hidden')).toBe(false);
    expect(waitingEl.style.display).toBe('block');

    view.show(state, 0);

    expect(readyBtn.hasAttribute('hidden')).toBe(false);
    expect(readyBtn.disabled).toBe(true);
    expect(clearBtn.hasAttribute('hidden')).toBe(false);
    expect(waitingEl.hasAttribute('hidden')).toBe(true);
  });

  it('keeps ready disabled until the resulting fleet contains a ship', () => {
    const onFleetReady = vi.fn<(purchases: FleetPurchase[]) => void>();
    const view = createFleetBuildingView({
      onFleetReady,
    });
    const readyBtn = document.getElementById(
      'fleetReadyBtn',
    ) as HTMLButtonElement;

    view.show(
      createState(400, {
        scenarioRules: { availableFleetPurchases: [] },
      }),
      0,
    );

    expect(readyBtn.disabled).toBe(true);

    readyBtn.click();

    expect(onFleetReady).not.toHaveBeenCalled();
  });

  it('enables ready immediately when the player already has a ship', () => {
    const view = createFleetBuildingView({
      onFleetReady: vi.fn(),
    });
    const readyBtn = document.getElementById(
      'fleetReadyBtn',
    ) as HTMLButtonElement;

    view.show(createState(0, { ships: [createShip({ owner: 0 })] }), 0);

    expect(readyBtn.disabled).toBe(false);
  });

  it('removes stale cart listeners when the cart rerenders', () => {
    const view = createFleetBuildingView({
      onFleetReady: vi.fn(),
    });

    view.show(createState(25), 0);
    document
      .querySelector<HTMLElement>('.fleet-shop-item:not(.disabled)')
      ?.click();

    const staleChip = document.querySelector('.fleet-cart-chip') as HTMLElement;
    const removeSpy = vi.spyOn(staleChip, 'removeEventListener');

    document.getElementById('fleetClearBtn')?.click();

    expect(removeSpy).toHaveBeenCalledWith(
      'click',
      expect.any(Function),
      undefined,
    );
    staleChip.click();
    expect(document.querySelectorAll('.fleet-cart-chip')).toHaveLength(0);
  });

  it('cleans up rendered state and controls on dispose', () => {
    const onFleetReady = vi.fn<(purchases: FleetPurchase[]) => void>();
    const view = createFleetBuildingView({
      onFleetReady,
    });

    view.show(createState(25), 0);
    document
      .querySelector<HTMLElement>('.fleet-shop-item:not(.disabled)')
      ?.click();

    view.dispose();
    document.getElementById('fleetReadyBtn')?.click();

    expect(onFleetReady).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.fleet-shop-item')).toHaveLength(0);
    expect(document.querySelectorAll('.fleet-cart-chip')).toHaveLength(0);
  });

  it('enables orbital base cargo when the player already has an eligible carrier', () => {
    const view = createFleetBuildingView({
      onFleetReady: vi.fn(),
    });

    view.show(
      createState(2000, {
        scenarioRules: {
          availableFleetPurchases: ['orbitalBaseCargo'],
        },
        ships: [createShip({ type: 'packet', owner: 0 })],
      }),
      0,
    );

    const shopItem = Array.from(
      document.querySelectorAll<HTMLElement>('.fleet-shop-item'),
    ).find((item) => item.textContent?.includes('Orbital Base Cargo'));

    expect(shopItem).not.toBeNull();
    expect(shopItem?.classList.contains('disabled')).toBe(false);
  });
});
