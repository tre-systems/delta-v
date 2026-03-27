import { describe, expect, it } from 'vitest';

import type { GameState, Ship } from '../../shared/types/domain';
import {
  getFirstLaunchableShipId,
  getUnambiguousLaunchableShipId,
  resolveBaseEmplacementPlan,
  resolveOrdnanceLaunchPlan,
} from './ordnance';
import type { PlanningState } from './planning';

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: 'ship-1',
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
    Pick<PlanningState, 'selectedShipId' | 'torpedoAccel' | 'torpedoAccelSteps'>
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
      createShip({ id: 'blocked', cargoUsed: 50 }),
      createShip({
        id: 'disabled',
        damage: { disabledTurns: 1 },
      }),
      createShip({ id: 'enemy', owner: 1 }),
      createShip({ id: 'launchable' }),
    ]);

    expect(getFirstLaunchableShipId(state, 0)).toBe('launchable');

    expect(getFirstLaunchableShipId(state, 1)).toBe('enemy');
  });

  it('skips ships that cannot launch any allowed ordnance this turn', () => {
    const state = createState(
      [
        createShip({
          id: 'corsair',
          type: 'corsair',
        }),
        createShip({
          id: 'packet',
          type: 'packet',
        }),
        createShip({
          id: 'resupplied',
          type: 'packet',
          resuppliedThisTurn: true,
        }),
      ],
      { allowedOrdnanceTypes: ['nuke'] },
    );

    expect(getFirstLaunchableShipId(state, 0)).toBe('packet');
    expect(getUnambiguousLaunchableShipId(state, 0)).toBe('packet');
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
        shipId: 'ship-1',
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
          { shipId: 'ship-1', burn: null, overload: null },
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
      message: 'Non-warships may carry only one nuke between resupplies',
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
    const state = createState([createShip({ baseStatus: 'carryingBase' })]);

    expect(resolveBaseEmplacementPlan(state, 'ship-1')).toEqual({
      ok: true,
      emplacements: [{ shipId: 'ship-1' }],
    });

    expect(resolveBaseEmplacementPlan(state, null)).toEqual({
      ok: false,
      message: 'Select a ship first',
      level: 'info',
    });

    expect(
      resolveBaseEmplacementPlan(createState([createShip()]), 'ship-1'),
    ).toEqual({
      ok: false,
      message: 'Ship is not carrying an orbital base',
      level: 'error',
    });
  });
});
