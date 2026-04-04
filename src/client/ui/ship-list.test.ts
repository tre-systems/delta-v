import { describe, expect, it } from 'vitest';
import { asShipId } from '../../shared/ids';
import type { Ship } from '../../shared/types/domain';
import { buildShipListView } from './ship-list';

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

describe('ui ship list helpers', () => {
  it('numbers repeated ship types and preserves unique names', () => {
    const view = buildShipListView(
      [
        createShip({ id: asShipId('a'), type: 'transport' }),
        createShip({ id: asShipId('b'), type: 'transport' }),
        createShip({ id: asShipId('c'), type: 'corvette' }),
      ],
      null,
      new Map(),
    );

    expect(view.map((entry) => entry.displayName)).toEqual([
      'Transport 1',
      'Transport 2',
      'Corvette',
    ]);
  });

  it('builds status and fuel labels for destroyed, captured, heroic, and burning ships', () => {
    const view = buildShipListView(
      [
        createShip({
          id: asShipId('a'),
          type: 'corvette',
          heroismAvailable: true,
          damage: { disabledTurns: 2 },
        }),
        createShip({
          id: asShipId('b'),
          control: 'captured',
        }),
        createShip({
          id: asShipId('c'),
          lifecycle: 'destroyed',
        }),
      ],
      null,
      new Map([['a', 1]]),
    );

    expect(view[0]).toMatchObject({
      statusText: 'D2 H',
      hasBurn: true,
      fuelText: '10/20',
    });

    expect(view[1]).toMatchObject({
      statusText: 'CAP',
      hasBurn: false,
      fuelText: '10/10',
    });

    expect(view[2]).toMatchObject({
      statusText: 'X',
      fuelText: '',
    });
  });

  it('includes expanded detail rows for the selected ship', () => {
    const view = buildShipListView(
      [
        createShip({
          id: asShipId('a'),
          type: 'packet',
          cargoUsed: 15,
          velocity: { dq: 2, dr: -1 },
          heroismAvailable: true,
          lifecycle: 'landed',
        }),
        createShip({ id: asShipId('b') }),
      ],
      'a',
      new Map(),
    );

    expect(view[0].detailRows).toEqual([
      { label: 'Combat', value: '2 ★', tone: null },
      { label: 'Cargo', value: '35/50', tone: null },
      { label: 'Velocity', value: '2, -1', tone: null },
      { label: 'Status', value: 'Landed', tone: 'success' },
    ]);

    expect(view[1].detailRows).toEqual([]);
  });

  it('uses minimal detail rows when compact (mobile)', () => {
    const view = buildShipListView(
      [
        createShip({
          id: asShipId('a'),
          type: 'packet',
          cargoUsed: 15,
          velocity: { dq: 0, dr: 0 },
          lifecycle: 'landed',
        }),
      ],
      'a',
      new Map(),
      true,
    );

    expect(view[0].detailRows).toEqual([
      { label: 'Combat', value: '2', tone: null },
      { label: 'Status', value: 'Landed', tone: 'success' },
    ]);
  });

  it('includes velocity in compact mode only when moving', () => {
    const view = buildShipListView(
      [
        createShip({
          id: asShipId('a'),
          type: 'corvette',
          velocity: { dq: 1, dr: -1 },
        }),
      ],
      'a',
      new Map(),
      true,
    );

    expect(view[0].detailRows).toEqual([
      { label: 'Combat', value: '2', tone: null },
      { label: 'Velocity', value: '1, -1', tone: null },
    ]);
  });

  it('shows disabled and captured detail rows for selected ships', () => {
    const view = buildShipListView(
      [
        createShip({
          id: asShipId('a'),
          control: 'captured',
          damage: { disabledTurns: 3 },
        }),
      ],
      'a',
      new Map(),
    );

    expect(view[0].detailRows).toEqual([
      { label: 'Combat', value: '1 (def)', tone: null },
      { label: 'Cargo', value: '50/50', tone: null },
      { label: 'Velocity', value: 'Stationary', tone: null },
      { label: 'Disabled', value: '3 turns', tone: 'warning' },
      { label: 'Status', value: 'Captured', tone: 'danger' },
    ]);
  });
});
