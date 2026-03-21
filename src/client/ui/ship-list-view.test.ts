// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ship } from '../../shared/types/domain';
import { ShipListView } from './ship-list-view';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-0',
  type: 'transport',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 10,
  cargoUsed: 0,
  nukesLaunchedSinceResupply: 0,
  resuppliedThisTurn: false,
  landed: false,
  destroyed: false,
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
    const view = new ShipListView({ onSelectShip });

    view.update(
      [
        createShip({
          id: 'selected',
          type: 'packet',
          cargoUsed: 15,
          landed: true,
        }),
        createShip({
          id: 'burning',
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
    const view = new ShipListView({ onSelectShip });

    view.update(
      [
        createShip({
          id: 'destroyed',
          destroyed: true,
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
});
