import { describe, expect, it } from 'vitest';

import { must } from '../../shared/assert';
import { hexKey } from '../../shared/hex';
import { asGameId, asShipId } from '../../shared/ids';
import { buildSolarSystemMap, findBaseHexes } from '../../shared/map-data';
import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { deriveHudViewModel } from './hud-view-model';
import { createPlanningStore } from './planning';

const map = buildSolarSystemMap();

const createShip = (overrides: Partial<Ship> = {}): Ship => ({
  id: asShipId('ship-0'),
  type: 'corvette',
  owner: 0,
  originalOwner: 0,
  position: { q: 0, r: 0 },
  velocity: { dq: 0, dr: 0 },
  fuel: 20,
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

const createPlayer = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  connected: true,
  ready: true,
  targetBody: 'Mars',
  homeBody: 'Venus',
  bases: [],
  escapeWins: false,
  ...overrides,
});

const createState = (
  ship: Ship,
  overrides: Partial<GameState> = {},
): GameState => ({
  gameId: asGameId('HUD'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [ship, createShip({ id: asShipId('enemy'), owner: 1 })],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [createPlayer(), createPlayer({ targetBody: 'Venus' })],
  outcome: null,
  ...overrides,
});

const createMarsOrbitShip = (overrides: Partial<Ship> = {}): Ship => {
  const marsBase = must(findBaseHexes(map, 'Mars')[0]);
  return createShip({
    position: { q: marsBase.q, r: marsBase.r + 1 },
    velocity: { dq: 0, dr: -1 },
    pendingGravityEffects: [
      {
        hex: { q: marsBase.q, r: marsBase.r + 1 },
        direction: 3,
        bodyName: 'Mars',
        strength: 'full',
        ignored: false,
      },
    ],
    ...overrides,
  });
};

describe('game-client-hud-view-model landing affordance', () => {
  it('shows landing only when the selected ship has a legal touchdown course', () => {
    const ship = createMarsOrbitShip();
    const planning = createPlanningStore();
    planning.selectShip(ship.id);

    const hud = deriveHudViewModel(createState(ship), 0, planning, map);

    expect(hud.selectedShipInOrbit).toBe(true);
  });

  it('hides landing for fuel-starved, disabled, and base-less orbiting ships', () => {
    const bases = findBaseHexes(map, 'Mars');

    for (const ship of [
      createMarsOrbitShip({ fuel: 0 }),
      createMarsOrbitShip({ damage: { disabledTurns: 2 } }),
      createMarsOrbitShip(),
    ]) {
      const planning = createPlanningStore();
      planning.selectShip(ship.id);
      const state =
        ship.fuel > 0 && ship.damage.disabledTurns === 0
          ? createState(ship, {
              destroyedBases: bases.map((base) => hexKey(base)),
            })
          : createState(ship);

      expect(
        deriveHudViewModel(state, 0, planning, map).selectedShipInOrbit,
      ).toBe(false);
    }
  });
});

describe('game-client-hud-view-model fleet progress', () => {
  it('reports orderable counts and fleet group size', () => {
    const ship = createShip();
    const planning = createPlanningStore();
    const state = createState(ship);

    let hud = deriveHudViewModel(state, 0, planning, map);
    // One own orderable ship, none ordered yet, no group.
    expect(hud.orderableTotal).toBe(1);
    expect(hud.orderableOrdered).toBe(0);
    expect(hud.fleetGroupSize).toBe(0);

    planning.acknowledgeShip(ship.id);
    planning.selectShips([ship.id, asShipId('enemy')]);
    hud = deriveHudViewModel(state, 0, planning, map);
    expect(hud.orderableOrdered).toBe(1);
    expect(hud.fleetGroupSize).toBe(2);
  });
});

describe('game-client-hud-view-model course summary', () => {
  it('keeps an unchanged landed course concise', () => {
    const ship = createShip({ lifecycle: 'landed' });
    const planning = createPlanningStore();
    planning.selectShip(ship.id);

    const hud = deriveHudViewModel(createState(ship), 0, planning, map);

    expect(hud.courseSummary).toBe('Stay landed · 0 fuel');
  });

  it('summarizes the selected burn using derived fuel and speed', () => {
    const ship = createShip({ velocity: { dq: 1, dr: 0 } });
    const planning = createPlanningStore();
    planning.selectShip(ship.id);
    planning.setShipBurn(ship.id, 0);

    const hud = deriveHudViewModel(createState(ship), 0, planning, map);

    expect(hud.courseSummary).toContain('Burn · −1 fuel · next speed 2');
  });

  it('calls out a plotted crash by body name', () => {
    const terra = must(map.bodies.find((body) => body.name === 'Terra'));
    const ship = createShip({
      position: { q: terra.center.q - 3, r: terra.center.r },
      velocity: { dq: 3, dr: 0 },
    });
    const planning = createPlanningStore();
    planning.selectShip(ship.id);

    const hud = deriveHudViewModel(createState(ship), 0, planning, map);

    expect(hud.courseSummary).toContain('CRASH: Terra');
  });
});

describe('game-client-hud-view-model combat guidance', () => {
  it('shows exact penalties and flags attacks that cannot damage', () => {
    const attacker = createShip({ position: { q: 0, r: 0 } });
    const target = createShip({
      id: asShipId('enemy'),
      owner: 1,
      originalOwner: 1,
      position: { q: 5, r: 0 },
    });
    const state = createState(attacker, {
      phase: 'combat',
      ships: [attacker, target],
    });
    const planning = createPlanningStore();
    planning.selectShip(attacker.id);
    planning.applyCombatPlanUpdate({
      combatTargetId: target.id,
      combatTargetType: 'ship',
      combatAttackerIds: [attacker.id],
      combatAttackStrength: 4,
    });

    const hud = deriveHudViewModel(state, 0, planning, map);

    expect(hud.combatTargetLabel).toBe(
      'Target: Corvette · 2:1 · range −5 · speed −0 · No damage possible',
    );
    expect(hud.combatAttackImpossible).toBe(true);
  });
});
