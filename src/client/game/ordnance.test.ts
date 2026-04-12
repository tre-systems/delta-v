import { describe, expect, it } from 'vitest';
import { asShipId } from '../../shared/ids';
import { buildSolarSystemMap } from '../../shared/map-data';
import type { GameState, Ship } from '../../shared/types/domain';
import {
  getFirstLaunchableShipId,
  getFirstOrdnanceActionableShipId,
  getUnambiguousLaunchableShipId,
  resolveBaseEmplacementPlan,
  resolveOrdnanceLaunchPlan,
} from './ordnance';
import type { OrdnancePlanningSnapshot } from './planning';

const map = buildSolarSystemMap();

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-1'),
  type: 'packet',
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

const createState = (
  ships: Ship[],
  scenarioRules: GameState['scenarioRules'] = {},
  pendingAstrogationOrders: GameState['pendingAstrogationOrders'] = null,
): Pick<GameState, 'ships' | 'scenarioRules' | 'pendingAstrogationOrders'> => ({
  ships,
  scenarioRules,
  pendingAstrogationOrders,
});

const createPlanning = (
  overrides: Partial<
    Pick<
      OrdnancePlanningSnapshot,
      'selectedShipId' | 'torpedoAccel' | 'torpedoAccelSteps'
    >
  > = {},
) => ({
  selectedShipId: 'ship-1',
  torpedoAccel: null,
  torpedoAccelSteps: null,
  ...overrides,
});

describe('game-client-ordnance', () => {
  it('finds the first launchable ship for the active player', () => {
    const state = createState([
      createShip({ id: asShipId('blocked'), cargoUsed: 50 }),
      createShip({
        id: asShipId('disabled'),
        damage: { disabledTurns: 1 },
      }),
      createShip({ id: asShipId('enemy'), owner: 1 }),
      createShip({ id: asShipId('launchable') }),
    ]);

    expect(getFirstLaunchableShipId(state, 0)).toBe('launchable');

    expect(getFirstLaunchableShipId(state, 1)).toBe('enemy');
  });

  it('skips ships that cannot launch any allowed ordnance this turn', () => {
    const state = createState(
      [
        createShip({
          id: asShipId('corsair'),
          type: 'corsair',
        }),
        createShip({
          id: asShipId('packet'),
          type: 'packet',
        }),
        createShip({
          id: asShipId('resupplied'),
          type: 'packet',
          resuppliedThisTurn: true,
        }),
      ],
      { allowedOrdnanceTypes: ['nuke'] },
    );

    expect(getFirstLaunchableShipId(state, 0)).toBe('packet');
    expect(getUnambiguousLaunchableShipId(state, 0)).toBe('packet');
  });

  it('skips mine carriers without a committed burn when choosing launchable ships', () => {
    const state = createState(
      [
        createShip({
          id: asShipId('needs-burn'),
          type: 'frigate',
        }),
        createShip({
          id: asShipId('burn-committed'),
          type: 'frigate',
        }),
      ],
      { allowedOrdnanceTypes: ['mine'] },
      [{ shipId: asShipId('burn-committed'), burn: 0, overload: null }],
    );

    expect(getFirstLaunchableShipId(state, 0)).toBe('burn-committed');
    expect(getUnambiguousLaunchableShipId(state, 0)).toBe('burn-committed');
  });

  it('falls back to a base carrier when ordnance phase is for emplacement only', () => {
    const state = createState(
      [
        createShip({
          id: asShipId('base-carrier'),
          type: 'transport',
          position: { q: -9, r: -6 },
          velocity: { dq: 1, dr: 0 },
          cargoUsed: 50,
          baseStatus: 'carryingBase',
        }),
      ],
      { allowedOrdnanceTypes: [] },
    );

    expect(getFirstLaunchableShipId(state, 0)).toBeNull();
    expect(getFirstOrdnanceActionableShipId(state, 0, map)).toBe(
      'base-carrier',
    );
  });

  it('skips invalid base carriers when choosing the first emplacement ship', () => {
    const state = createState(
      [
        createShip({
          id: asShipId('invalid-base-carrier'),
          type: 'transport',
          cargoUsed: 50,
          baseStatus: 'carryingBase',
        }),
        createShip({
          id: asShipId('valid-base-carrier'),
          type: 'transport',
          position: { q: -9, r: -6 },
          velocity: { dq: 1, dr: 0 },
          cargoUsed: 50,
          baseStatus: 'carryingBase',
        }),
      ],
      { allowedOrdnanceTypes: [] },
    );

    expect(getFirstOrdnanceActionableShipId(state, 0, map)).toBe(
      'valid-base-carrier',
    );
  });

  it('builds a launch plan for torpedoes', () => {
    const state = createState([createShip({ type: 'frigate' })]);
    const planning = createPlanning({
      torpedoAccel: 2,
      torpedoAccelSteps: 2,
    });

    expect(resolveOrdnanceLaunchPlan(state, planning, 'torpedo')).toEqual({
      ok: true,
      shipName: 'Frigate',
      launch: {
        shipId: asShipId('ship-1'),
        ordnanceType: 'torpedo',
        torpedoAccel: 2,
        torpedoAccelSteps: 2,
      },
    });
  });

  it('rejects missing selection and invalid launch conditions', () => {
    const state = createState([createShip()]);

    expect(
      resolveOrdnanceLaunchPlan(
        state,
        createPlanning({ selectedShipId: null }),
        'mine',
      ),
    ).toEqual({
      ok: false,
      message: 'Select a ship first',
      level: 'info',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([createShip({ lifecycle: 'landed' })]),
        createPlanning(),
        'mine',
      ),
    ).toEqual({
      ok: false,
      message: 'Cannot launch ordnance while landed',
      level: 'error',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([createShip({ type: 'frigate' })], {}, [
          { shipId: asShipId('ship-1'), burn: null, overload: null },
        ]),
        createPlanning(),
        'mine',
      ),
    ).toEqual({
      ok: false,
      message: 'Ship must change course when launching a mine',
      level: 'error',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([createShip({ type: 'packet' })], {
          allowedOrdnanceTypes: ['nuke'],
        }),
        createPlanning(),
        'mine',
      ),
    ).toEqual({
      ok: false,
      message: 'This scenario does not allow mine launches',
      level: 'error',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([
          createShip({
            type: 'packet',
            resuppliedThisTurn: true,
          }),
        ]),
        createPlanning(),
        'nuke',
      ),
    ).toEqual({
      ok: false,
      message:
        'Ships cannot launch ordnance during a turn in which they resupply',
      level: 'error',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([
          createShip({
            damage: { disabledTurns: 2 },
          }),
        ]),
        createPlanning(),
        'mine',
      ),
    ).toEqual({
      ok: false,
      message: 'Ship is disabled',
      level: 'error',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([createShip({ type: 'packet' })]),
        createPlanning(),
        'torpedo',
      ),
    ).toEqual({
      ok: false,
      message: 'Only warships and orbital bases can launch torpedoes',
      level: 'error',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([
          createShip({
            type: 'packet',
            nukesLaunchedSinceResupply: 1,
          }),
        ]),
        createPlanning(),
        'nuke',
      ),
    ).toEqual({
      ok: false,
      message: 'Non-warships may launch only one nuke between resupplies',
      level: 'error',
    });

    expect(
      resolveOrdnanceLaunchPlan(
        createState([createShip({ cargoUsed: 50 })]),
        createPlanning(),
        'mine',
      ),
    ).toEqual({
      ok: false,
      message: 'Not enough cargo (need 10, have 0)',
      level: 'error',
    });
  });

  it('builds and validates orbital base emplacement plans', () => {
    const state = createState([
      createShip({
        baseStatus: 'carryingBase',
        position: { q: -9, r: -6 },
        velocity: { dq: 1, dr: 0 },
      }),
    ]);

    expect(resolveBaseEmplacementPlan(state, 'ship-1', map)).toEqual({
      ok: true,
      emplacements: [{ shipId: asShipId('ship-1') }],
    });

    expect(resolveBaseEmplacementPlan(state, null, map)).toEqual({
      ok: false,
      message: 'Select a ship first',
      level: 'info',
    });

    expect(
      resolveBaseEmplacementPlan(createState([createShip()]), 'ship-1', map),
    ).toEqual({
      ok: false,
      message: 'Ship is not carrying an orbital base',
      level: 'error',
    });

    expect(
      resolveBaseEmplacementPlan(
        createState([
          createShip({
            baseStatus: 'carryingBase',
            type: 'transport',
          }),
        ]),
        'ship-1',
        map,
      ),
    ).toEqual({
      ok: false,
      message:
        'Must be in orbit or on an open world hex side to emplace an orbital base',
      level: 'error',
    });
  });
});
