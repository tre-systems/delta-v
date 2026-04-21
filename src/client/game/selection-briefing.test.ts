import { describe, expect, it } from 'vitest';
import { asGameId, asShipId } from '../../shared/ids';
import type { GameState, PlayerState, Ship } from '../../shared/types/domain';
import { getScenarioBriefingLines } from './selection';

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

const createPlayers = (): [PlayerState, PlayerState] => [
  {
    connected: true,
    ready: true,
    targetBody: 'Venus',
    homeBody: 'Terra',
    bases: [],
    escapeWins: false,
  },
  {
    connected: true,
    ready: true,
    targetBody: 'Terra',
    homeBody: 'Mars',
    bases: [],
    escapeWins: false,
  },
];

const createState = (overrides: Partial<GameState> = {}): GameState => ({
  gameId: asGameId('BRIEF'),
  scenario: 'biplanetary',
  scenarioRules: {},
  escapeMoralVictoryAchieved: false,
  turnNumber: 1,
  phase: 'astrogation',
  activePlayer: 0,
  ships: [
    createShip({ id: asShipId('transport'), type: 'transport' }),
    createShip({
      id: asShipId('packet'),
      type: 'packet',
      position: { q: 1, r: 0 },
    }),
    createShip({
      id: asShipId('enemy'),
      owner: 1,
      originalOwner: 0,
      type: 'corsair',
      position: { q: 2, r: 0 },
    }),
  ],
  ordnance: [],
  pendingAstrogationOrders: null,
  pendingAsteroidHazards: [],
  destroyedAsteroids: [],
  destroyedBases: [],
  players: createPlayers(),
  outcome: null,
  ...overrides,
});

describe('getScenarioBriefingLines', () => {
  it('includes fleet for standard landing scenarios', () => {
    expect(getScenarioBriefingLines(createState(), 0)).toEqual([
      'Your fleet: Transport, Packet',
    ]);
  });

  it('classifies escape and hidden-identity briefing lines', () => {
    expect(
      getScenarioBriefingLines(
        createState({
          ships: [
            createShip({
              identity: { hasFugitives: true, revealed: false },
            }),
            createShip({ id: asShipId('enemy'), owner: 1 }),
          ],
        }),
        0,
      ),
    ).toEqual([
      'Your fleet: Transport',
      'Your \u2605 ship carries the fugitives',
    ]);

    expect(
      getScenarioBriefingLines(
        createState({
          scenarioRules: { hiddenIdentityInspection: true },
          players: [
            { ...createPlayers()[0], targetBody: '' },
            createPlayers()[1],
          ],
        }),
        0,
      ),
    ).toEqual([
      'Your fleet: Transport, Packet',
      'Inspect transports to find the fugitives',
    ]);
  });

  it('notes race-only for checkpoint scenarios', () => {
    expect(
      getScenarioBriefingLines(
        createState({
          scenarioRules: {
            checkpointBodies: ['Mars', 'Venus', 'Jupiter'],
          },
        }),
        0,
      ),
    ).toEqual(['Your fleet: Transport, Packet', 'No combat \u2014 race only']);
  });
});
