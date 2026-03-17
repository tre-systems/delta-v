import { describe, expect, it } from 'vitest';
import { buildHUDView } from './hud';

describe('ui hud helpers', () => {
  it('builds astrogation HUD text and buttons for the active player', () => {
    expect(buildHUDView(3, 'astrogation', true, 8, 10, true)).toMatchObject({
      turnText: 'Turn 3',
      phaseText: 'ASTROGATION',
      fuelGaugeText: 'Fuel: 8/10',
      statusText: 'Select ship · Choose burn direction (1-6) · Confirm (Enter)',
      undoVisible: true,
      confirmVisible: true,
      skipCombatVisible: false,
    });
  });

  it('builds ordnance button states from cargo and ship capabilities', () => {
    const view = buildHUDView(4, 'ordnance', true, 6, 10, false, 10, 20, 'Hold Mars', false, true);

    expect(view).toMatchObject({
      phaseText: 'ORDNANCE',
      objectiveText: 'Hold Mars',
      fuelGaugeText: 'Cargo: 10/20',
      statusText: 'Launch ordnance or skip (Enter)',
      emplaceBaseVisible: true,
      skipOrdnanceVisible: true,
    });
    expect(view.launchMine).toMatchObject({ visible: true, disabled: false, opacity: '1' });
    expect(view.launchTorpedo).toMatchObject({ visible: true, disabled: true, opacity: '0.4', title: 'Warships only' });
    expect(view.launchNuke).toMatchObject({ visible: true, disabled: true, opacity: '0.4' });
  });

  it('shows combat controls only for the active player', () => {
    expect(buildHUDView(5, 'combat', true, 5, 10)).toMatchObject({
      phaseText: 'COMBAT',
      statusText: 'Click enemies to target · Fire All to attack (Enter)',
      skipCombatVisible: true,
    });

    expect(buildHUDView(5, 'combat', false, 5, 10)).toMatchObject({
      phaseText: "OPPONENT'S TURN",
      statusText: 'Waiting for opponent...',
      skipCombatVisible: false,
      confirmVisible: false,
    });
  });
});
