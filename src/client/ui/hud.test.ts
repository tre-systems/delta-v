import { describe, expect, it } from 'vitest';

import type { AstrogationContext, HUDInput } from './hud';
import { buildHUDView } from './hud';

const defaultLaunchState = {
  visible: false,
  disabled: true,
  title: '',
};

const defaultCtx: AstrogationContext = {
  selectedShipLanded: false,
  selectedShipDisabled: false,
  selectedShipHasBurn: false,
  allShipsAcknowledged: false,
  multipleShipsAlive: false,
  hasSelection: true,
};

const buildInput = (overrides: Partial<HUDInput> = {}): HUDInput => ({
  turn: 1,
  phase: 'astrogation',
  isMyTurn: true,
  isSpectator: false,
  activePlayer: 0,
  fuel: 10,
  maxFuel: 10,
  hasBurns: false,
  cargoFree: 0,
  cargoMax: 0,
  objective: '',
  objectiveBearingDeg: null,
  emplaceBaseState: defaultLaunchState,
  launchMineState: defaultLaunchState,
  launchTorpedoState: defaultLaunchState,
  launchNukeState: defaultLaunchState,
  torpedoAimingActive: false,
  torpedoAccelSteps: null,
  allOrdnanceShipsAcknowledged: false,
  queuedOrdnanceType: null,
  queuedLaunchCount: 0,
  queuedCombatAttackCount: 0,
  astrogationCtx: defaultCtx,
  speed: 0,
  fuelToStop: 0,
  isMobile: false,
  ...overrides,
});

describe('ui hud helpers', () => {
  it('shows objective compass rotation when a bearing is provided', () => {
    const view = buildHUDView(
      buildInput({ objectiveBearingDeg: 90, phase: 'astrogation' }),
    );
    expect(view.objectiveCompassDegrees).toBe(90);
  });

  it('hides objective compass during fleet building regardless of bearing', () => {
    const view = buildHUDView(
      buildInput({
        objectiveBearingDeg: 45,
        phase: 'fleetBuilding',
      }),
    );
    expect(view.objectiveCompassDegrees).toBeNull();
  });

  it('builds astrogation HUD text and buttons for the active player', () => {
    expect(
      buildHUDView(buildInput({ turn: 3, fuel: 8, hasBurns: true })),
    ).toMatchObject({
      turnText: 'Turn 3',
      phaseText: 'ASTROGATION',
      fuelGaugeText: 'Fuel: 8/10',
      statusText: 'Set burn or confirm (Enter)',
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
        emplaceBaseState: {
          visible: true,
          disabled: false,
          title: '',
        },
        launchMineState: {
          visible: true,
          disabled: false,
          title: '',
        },
        launchTorpedoState: {
          visible: true,
          disabled: true,
          title: 'Warships or bases only',
        },
        launchNukeState: {
          visible: true,
          disabled: true,
          title: 'Not enough cargo (need 20, have 10)',
        },
      }),
    );

    expect(view).toMatchObject({
      phaseText: 'ORDNANCE',
      objectiveText: 'Hold Mars',
      fuelGaugeText: 'Cargo: 10/20 (1M)',
      statusText:
        'Ready: Mine, Base · Blocked: Torpedo: warships or bases only; Nuke: not enough cargo (need 20, have 10)',
      nextOrdnance: {
        visible: true,
        disabled: false,
        label: 'SKIP SHIP',
      },
      confirmOrdnance: {
        visible: true,
        disabled: true,
        label: 'CONFIRM PHASE',
      },
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
      title: 'Warships or bases only',
    });

    expect(view.launchNuke).toMatchObject({
      visible: true,
      disabled: true,
      opacity: '0.4',
      title: 'Not enough cargo (need 20, have 10)',
    });
    expect(view.emplaceBase).toMatchObject({
      visible: true,
      disabled: false,
      opacity: '1',
    });
  });

  it('hides ordnance buttons that the scenario does not allow', () => {
    const view = buildHUDView(
      buildInput({
        phase: 'ordnance',
        launchMineState: {
          visible: false,
          disabled: true,
          title: '',
        },
        launchTorpedoState: {
          visible: false,
          disabled: true,
          title: '',
        },
        launchNukeState: {
          visible: true,
          disabled: false,
          title: '',
        },
      }),
    );

    expect(view.launchMine.visible).toBe(false);
    expect(view.launchTorpedo.visible).toBe(false);
    expect(view.launchNuke).toMatchObject({
      visible: true,
      disabled: false,
      opacity: '1',
    });
  });

  it('shows torpedo aiming guidance while boost selection is active', () => {
    expect(
      buildHUDView(
        buildInput({
          phase: 'ordnance',
          torpedoAimingActive: true,
          torpedoAccelSteps: 1,
          launchTorpedoState: {
            visible: true,
            disabled: false,
            title: '',
          },
        }),
      ),
    ).toMatchObject({
      statusText:
        'Torpedo ×1 selected · Click the same hex for ×2, or tap TORPEDO / press Enter to queue',
    });
  });

  it('shows disabled ordnance reasons when the selected ship has no legal actions', () => {
    expect(
      buildHUDView(
        buildInput({
          phase: 'ordnance',
          cargoMax: 20,
          launchMineState: {
            visible: true,
            disabled: true,
            title: 'Needs a course change',
          },
        }),
      ),
    ).toMatchObject({
      statusText: 'Blocked: Mine: needs a course change · Use Skip Ship (S)',
    });
  });

  it('shows combat controls only for the active player', () => {
    expect(
      buildHUDView(buildInput({ turn: 5, phase: 'combat' })),
    ).toMatchObject({
      phaseText: 'COMBAT',
      statusText:
        'Click highlighted enemies to target \u00b7 ATTACK or Enter fires \u00b7 END COMBAT when done \u00b7 [ ] Cycle targets \u00b7 { } Cycle attackers',
      skipCombatVisible: false,
    });

    expect(
      buildHUDView(
        buildInput({
          turn: 5,
          phase: 'combat',
          queuedCombatAttackCount: 2,
        }),
      ),
    ).toMatchObject({
      statusText:
        'Click highlighted enemies to target \u00b7 ATTACK or Enter fires \u00b7 END COMBAT when done \u00b7 2 attacks queued \u00b7 [ ] Cycle targets \u00b7 { } Cycle attackers',
    });

    expect(
      buildHUDView(buildInput({ turn: 5, phase: 'combat', isMyTurn: false })),
    ).toMatchObject({
      phaseText: "OPPONENT'S TURN",
      statusText: null,
      skipCombatVisible: false,
      confirmVisible: false,
    });

    expect(
      buildHUDView(
        buildInput({
          turn: 5,
          phase: 'astrogation',
          isMyTurn: false,
          isSpectator: true,
          activePlayer: 1,
        }),
      ),
    ).toMatchObject({
      phaseText: 'P2 ASTROGATION',
      fuelGaugeText: '',
    });

    expect(
      buildHUDView(
        buildInput({
          turn: 5,
          phase: 'combat',
          combatHudHint: 'Target: Frigate',
        }),
      ),
    ).toMatchObject({
      statusText:
        'Target: Frigate · Click highlighted enemies to target \u00b7 ATTACK or Enter fires \u00b7 END COMBAT when done \u00b7 [ ] Cycle targets \u00b7 { } Cycle attackers',
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
      statusText: 'Click a direction to burn (1 fuel)',
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

  it('shows all burns set when every ship has a burn in multi-ship', () => {
    expect(
      buildHUDView(
        buildInput({
          hasBurns: true,
          astrogationCtx: {
            ...defaultCtx,
            selectedShipHasBurn: true,
            allShipsAcknowledged: true,
            multipleShipsAlive: true,
          },
        }),
      ),
    ).toMatchObject({
      statusText: 'All ships set · Confirm (Enter)',
    });
  });

  it('shows burn set (not all burns set) for single ship', () => {
    expect(
      buildHUDView(
        buildInput({
          hasBurns: true,
          astrogationCtx: {
            ...defaultCtx,
            selectedShipHasBurn: true,
            allShipsAcknowledged: true,
            multipleShipsAlive: false,
          },
        }),
      ),
    ).toMatchObject({
      statusText: 'Burn set · Confirm (Enter)',
    });
  });

  it('shows crash warning when course hits a body', () => {
    expect(
      buildHUDView(
        buildInput({
          hasBurns: true,
          astrogationCtx: {
            ...defaultCtx,
            selectedShipHasBurn: true,
            allShipsAcknowledged: true,
            anyCrashed: true,
            crashBody: 'Mercury',
          },
        }),
      ),
    ).toMatchObject({
      statusText: 'Warning: course crashes into Mercury!',
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

  it('omits keyboard hints on mobile', () => {
    const mobile = buildInput({
      isMobile: true,
      hasBurns: true,
      astrogationCtx: {
        ...defaultCtx,
        selectedShipHasBurn: true,
        allShipsAcknowledged: true,
      },
    });

    expect(buildHUDView(mobile).statusText).toBe('Burn set \u00b7 Confirm');

    expect(
      buildHUDView(
        buildInput({
          isMobile: true,
          phase: 'ordnance',
          astrogationCtx: {
            ...defaultCtx,
            hasSelection: false,
          },
        }),
      ).statusText,
    ).toBe('Select a ship to review ordnance options');

    expect(
      buildHUDView(buildInput({ isMobile: true, phase: 'combat' })).statusText,
    ).toBe(
      'Tap highlighted enemies to target \u00b7 ATTACK fires \u00b7 END COMBAT when done',
    );

    expect(
      buildHUDView(
        buildInput({
          isMobile: true,
          phase: 'combat',
          queuedCombatAttackCount: 1,
        }),
      ).statusText,
    ).toBe(
      'Tap highlighted enemies to target \u00b7 ATTACK fires \u00b7 END COMBAT when done \u00b7 1 queued',
    );

    expect(
      buildHUDView(buildInput({ isMobile: true, phase: 'logistics' }))
        .statusText,
    ).toBe('Transfer fuel/cargo or skip');
  });

  it('uses Tap instead of Click on mobile', () => {
    expect(
      buildHUDView(
        buildInput({
          isMobile: true,
          astrogationCtx: {
            ...defaultCtx,
            selectedShipLanded: true,
            hasSelection: true,
          },
        }),
      ).statusText,
    ).toBe('Tap a direction to burn (1 fuel)');

    expect(
      buildHUDView(
        buildInput({
          isMobile: true,
          hasBurns: true,
        }),
      ).statusText,
    ).toBe('Set burn');
  });
});
