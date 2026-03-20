import { describe, expect, it } from 'vitest';

import type { AstrogationContext, HUDInput } from './hud';
import { buildHUDView } from './hud';

const defaultCtx: AstrogationContext = {
  selectedShipLanded: false,
  selectedShipDisabled: false,
  selectedShipHasBurn: false,
  allShipsHaveBurns: false,
  multipleShipsAlive: false,
  hasSelection: true,
};

const buildInput = (overrides: Partial<HUDInput> = {}): HUDInput => ({
  turn: 1,
  phase: 'astrogation',
  isMyTurn: true,
  fuel: 10,
  maxFuel: 10,
  hasBurns: false,
  cargoFree: 0,
  cargoMax: 0,
  objective: '',
  isWarship: false,
  canEmplaceBase: false,
  astrogationCtx: defaultCtx,
  speed: 0,
  fuelToStop: 0,
  ...overrides,
});

describe('ui hud helpers', () => {
  it('builds astrogation HUD text and buttons for the active player', () => {
    expect(
      buildHUDView(buildInput({ turn: 3, fuel: 8, hasBurns: true })),
    ).toMatchObject({
      turnText: 'Turn 3',
      phaseText: 'ASTROGATION',
      fuelGaugeText: 'Fuel: 8/10',
      statusText: 'Click adjacent hex to set burn direction',
      undoVisible: true,
      confirmVisible: true,
      skipCombatVisible: false,
    });
  });

  it('builds ordnance button states from cargo and ship capabilities', () => {
    const view = buildHUDView(
      buildInput({
        turn: 4,
        phase: 'ordnance',
        fuel: 6,
        cargoFree: 10,
        cargoMax: 20,
        objective: 'Hold Mars',
        canEmplaceBase: true,
      }),
    );

    expect(view).toMatchObject({
      phaseText: 'ORDNANCE',
      objectiveText: 'Hold Mars',
      fuelGaugeText: 'Cargo: 10/20',
      statusText: 'Launch ordnance or skip (Enter)',
      emplaceBaseVisible: true,
      skipOrdnanceVisible: true,
    });

    expect(view.launchMine).toMatchObject({
      visible: true,
      disabled: false,
      opacity: '1',
    });

    expect(view.launchTorpedo).toMatchObject({
      visible: true,
      disabled: true,
      opacity: '0.4',
      title: 'Warships only',
    });

    expect(view.launchNuke).toMatchObject({
      visible: true,
      disabled: true,
      opacity: '0.4',
    });
  });

  it('shows combat controls only for the active player', () => {
    expect(
      buildHUDView(buildInput({ turn: 5, phase: 'combat' })),
    ).toMatchObject({
      phaseText: 'COMBAT',
      statusText: 'Click enemies to target · Fire All to attack (Enter)',
      skipCombatVisible: true,
    });

    expect(
      buildHUDView(buildInput({ turn: 5, phase: 'combat', isMyTurn: false })),
    ).toMatchObject({
      phaseText: "OPPONENT'S TURN",
      statusText: null,
      skipCombatVisible: false,
      confirmVisible: false,
    });
  });

  it('shows contextual astrogation status for landed ships', () => {
    expect(
      buildHUDView(
        buildInput({
          astrogationCtx: {
            ...defaultCtx,
            selectedShipLanded: true,
            hasSelection: true,
          },
        }),
      ),
    ).toMatchObject({
      statusText: 'Click a direction to take off (costs 1 fuel)',
    });
  });

  it('shows select prompt when no ship selected in multi-ship', () => {
    expect(
      buildHUDView(
        buildInput({
          astrogationCtx: {
            ...defaultCtx,
            hasSelection: false,
            multipleShipsAlive: true,
          },
        }),
      ),
    ).toMatchObject({
      statusText: 'Select a ship to begin',
    });
  });

  it('shows all burns set when every ship has a burn', () => {
    expect(
      buildHUDView(
        buildInput({
          hasBurns: true,
          astrogationCtx: {
            ...defaultCtx,
            selectedShipHasBurn: true,
            allShipsHaveBurns: true,
          },
        }),
      ),
    ).toMatchObject({
      statusText: 'All burns set · Confirm (Enter)',
    });
  });

  it('shows speed and fuel-to-stop when ship is moving', () => {
    expect(
      buildHUDView(buildInput({ fuel: 8, speed: 3, fuelToStop: 3 })),
    ).toMatchObject({
      fuelGaugeText: 'Fuel: 8/10 · Speed 3 (3 to stop)',
    });
  });

  it('shows Landed in fuel gauge for landed ships', () => {
    expect(
      buildHUDView(
        buildInput({
          astrogationCtx: {
            ...defaultCtx,
            selectedShipLanded: true,
            hasSelection: true,
          },
        }),
      ),
    ).toMatchObject({
      fuelGaugeText: 'Fuel: 10/10 · Landed',
    });
  });
});
