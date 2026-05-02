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
