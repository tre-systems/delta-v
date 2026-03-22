import { describe, expect, it } from 'vitest';

import type {
  GameState,
  Ship,
  SolarSystemMap,
} from '../../shared/types/domain';
import { buildShipTooltipHtml } from './tooltip';

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
  lifecycle: 'active' as const,
  control: 'own' as const,
  heroismAvailable: false,
  overloadUsed: false,
  detected: true,
  damage: { disabledTurns: 0 },
  ...overrides,
});

const createState = (ships: Ship[]): GameState => ({
  gameId: 'TEST',
  scenario: 'test',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'combat',
  activePlayer: 0,
  ships,
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: [
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Terra',
      bases: [],
      escapeWins: false,
    },
    {
      connected: true,
      ready: true,
      targetBody: '',
      homeBody: 'Mars',
      bases: [],
      escapeWins: false,
    },
  ],
  winner: null,
  winReason: null,
});

const map: SolarSystemMap = {
  hexes: new Map(),
  bodies: [],
  bounds: { minQ: -1, maxQ: 1, minR: -1, maxR: 1 },
};

describe('buildShipTooltipHtml', () => {
  it('shows fuel and cargo details for the local player ship', () => {
    const ship = createShip({
      type: 'packet',
      fuel: 7,
      cargoUsed: 15,
    });

    const html = buildShipTooltipHtml(createState([ship]), ship, 0, map);

    expect(html).toContain('Packet');
    expect(html).toContain('Fuel: 7/10');
    expect(html).toContain('Cargo: 35/50');
    expect(html).not.toContain('R-');
  });

  it('shows combat odds for visible enemy ships', () => {
    const attacker = createShip({
      id: 'p0s0',
      type: 'corsair',
      owner: 0,
      originalOwner: 0,
      position: { q: 0, r: 0 },
    });
    const target = createShip({
      id: 'p1s0',
      type: 'frigate',
      owner: 1,
      originalOwner: 0,
      position: { q: 1, r: 0 },
    });

    const html = buildShipTooltipHtml(
      createState([attacker, target]),
      target,
      0,
      map,
    );

    expect(html).toContain('Frigate');
    expect(html).toContain('Combat: 8');
    expect(html).toContain('R-1');
    expect(html).toContain('V-0');
  });
});
