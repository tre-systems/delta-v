// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asShipId } from '../../shared/ids';
import type { Ship } from '../../shared/types/domain';
import { createShipListView } from './ship-list-view';

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
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const installFixture = () => {
  document.body.innerHTML = '<div id="shipList"></div>';
};

describe('ShipListView', () => {
  beforeEach(() => {
    installFixture();
  });

  it('renders selected details and emits select events for live ships', () => {
    const onSelectShip = vi.fn<(shipId: string) => void>();
    const view = createShipListView({ onSelectShip });

    view.update(
      [
        createShip({
          id: asShipId('selected'),
          type: 'packet',
          cargoUsed: 15,
          lifecycle: 'landed',
        }),
        createShip({
          id: asShipId('burning'),
          type: 'corvette',
        }),
      ],
      'selected',
      new Map([['burning', 1]]),
    );

    const entries = Array.from(
      document.querySelectorAll<HTMLElement>('#shipList .ship-entry'),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.classList.contains('active')).toBe(true);
    expect(entries[0]?.querySelector('.ship-details')?.textContent).toContain(
      'Landed',
    );
    expect(entries[1]?.querySelector('.burn-dot')).not.toBeNull();

    entries[1]?.click();
    expect(onSelectShip).toHaveBeenCalledWith('burning');
  });

  it('marks destroyed ships and does not emit clicks for them', () => {
    const onSelectShip = vi.fn<(shipId: string) => void>();
    const view = createShipListView({ onSelectShip });

    view.update(
      [
        createShip({
          id: asShipId('destroyed'),
          lifecycle: 'destroyed',
        }),
      ],
      null,
      new Map(),
    );

    const entry = document.querySelector<HTMLElement>('#shipList .ship-entry');

    expect(entry?.classList.contains('destroyed')).toBe(true);
    entry?.click();
    expect(onSelectShip).not.toHaveBeenCalled();
  });

  it('removes stale row listeners when the list rerenders', () => {
    const onSelectShip = vi.fn<(shipId: string) => void>();
    const view = createShipListView({ onSelectShip });

    view.update([createShip({ id: asShipId('ship-0') })], null, new Map());

    const staleEntry = document.querySelector<HTMLElement>(
      '#shipList .ship-entry',
    ) as HTMLElement;
    const removeSpy = vi.spyOn(staleEntry, 'removeEventListener');

    view.update([createShip({ id: asShipId('ship-1') })], null, new Map());

    expect(removeSpy).toHaveBeenCalledWith(
      'click',
      expect.any(Function),
      undefined,
    );
    staleEntry.click();
    expect(onSelectShip).not.toHaveBeenCalled();
  });

  it('disposes the reactive render pipeline cleanly', () => {
    const view = createShipListView({
      onSelectShip: vi.fn(),
    });

    view.update([createShip()], null, new Map());
    expect(document.querySelectorAll('#shipList .ship-entry')).toHaveLength(1);

    view.dispose();
    view.update([createShip({ id: asShipId('ship-1') })], 'ship-1', new Map());

    expect(document.querySelectorAll('#shipList .ship-entry')).toHaveLength(0);
  });
});
